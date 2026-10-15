import { create } from 'zustand';
import {
  api,
  ApiConfig,
  AgentPolicy,
  ApprovalMode,
  FileItem,
  GitResult,
  McpServerInfo,
  ServerSessionSummary,
  SearchHit,
  ReplaceResponse,
} from './lib/api';
import { askConfirm, askPrompt } from './lib/dialog';
import { readStored, writeStored, removeStored, STORAGE_KEYS } from './lib/brand';
import { isBinaryPreview } from './lib/fileKind';
import { consumeRunStream, type RunStreamHandlers } from './lib/chatStream';

/* ── 类型 ── */
export interface OpenFile {
  path: string;
  content: string;
  modified: boolean;
}

export interface ToolCallView {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  status: 'running' | 'ok' | 'error';
  open?: boolean;
}

export interface ApprovalView {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  danger: 'low' | 'medium' | 'high';
  reason: string;
  /** expired：卡片背后没有活着的运行（服务端重启 / 运行已被回收 / 来自恢复的旧会话） */
  resolved?: 'approved' | 'denied' | 'expired';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'error' | 'system';
  content: string | any[];
  thinking?: string;
  thinkingOpen?: boolean;
  toolCalls?: ToolCallView[];
  approvals?: ApprovalView[];
  /** 产生这条消息的 agent 运行 id；断连后重连靠它找回对应消息 */
  runId?: string;
}

/** 正在服务端运行的 agent 任务。关页/锁屏后靠它重连回放。 */
export interface ActiveRun {
  runId: string;
  sessionIdx: number;
  /** 已收到的最新事件序号，-1 表示尚未收到事件 */
  lastSeq: number;
}

/**
 * 判断异常是否属于「中止」语义。
 * 浏览器在页面卸载/切后台时中断 fetch，抛出的可能是 AbortError，也可能是
 * TypeError: Failed to fetch —— 两者都不代表运行本身失败。
 */
function isAbortError(e: unknown): boolean {
  const err = e as Error;
  return err?.name === 'AbortError' || /aborted|Failed to fetch|NetworkError/i.test(err?.message ?? '');
}

/** 上游返回的真实用量 */
export interface UsagePayload {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 单次运行在客户端累积的流式状态 */
interface RunStreamState {
  text: string;
  thinking: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export interface ChatSession {
  id: number;
  label: string;
  messages: ChatMessage[];
}

export type RightTab = 'chat' | 'terminal' | 'git' | 'stats' | 'knowledge' | 'search';
export type MobileView = 'editor' | 'panel';
export type AppStatus = 'loading' | 'ok' | 'warn' | 'error';
export type ThemeMode = 'dark' | 'light';

export interface GitBranch {
  name: string;
  fullName?: string;
  current: boolean;
  remote?: string;
  lastCommit?: string;
  subject?: string;
  ahead: number;
  behind: number;
  isRemote?: boolean;
}

export interface UsageStats {
  totalCalls: number;
  totalTokens: number;
  todayCalls: number;
  todayTokens: number;
  ctxChars: number;
  maxCtxChars: number;
  lastPromptTokens: number;
  lastCompletionTokens: number;
  history: { date: string; calls: number; tokens: number }[];
}

interface AppState {
  // api 配置
  apiConfig: ApiConfig;
  status: AppStatus;
  statusText: string;
  // 后端已配置 Key（GET /api/config 返回 "***"），此时前端无需持有明文
  serverHasKey: boolean;

  // 主题
  theme: ThemeMode;

  // 文件
  curPath: string;
  files: FileItem[];
  filesLoading: boolean;
  filesError: string | null;
  fileFilter: string;
  openFiles: OpenFile[];
  activeFile: string | null;
  activeFileError: { path: string; message: string } | null;

  // 右侧面板
  rightTab: RightTab;
  // 窄屏（手机）下编辑器与面板互斥显示，宽屏由 CSS 忽略
  mobileView: MobileView;
  filesPanelOpen: boolean;

  // 聊天
  sessions: ChatSession[];
  curSession: number;
  chatLoading: boolean;
  chatAbort: AbortController | null;
  activeRun: ActiveRun | null;
  /** 接回中途断了但任务仍在服务端跑：界面要给出「重新接回」入口，
      而不是让用户以为任务没了 */
  attachLost: boolean;

  // 用量统计
  usage: UsageStats;

  // Git
  gitOut: string;
  gitLoading: boolean;
  gitError: string | null;
  gitBranches: GitBranch[];
  gitBranchLoading: boolean;
  gitBranchError: string | null;

  // 知识库
  knowledgeDoc: string | null;
  knowledgeLoading: boolean;
  knowledgeError: string | null;

  // 全局搜索
  searchResults: SearchHit[];
  searchLoading: boolean;
  searchQuery: string;
  searchExt: string;
  searchScanned: number;
  searchError: string | null;

  // MCP (与后端 REST /api/mcp/servers 同步)
  mcpServers: McpServerInfo[];

  // agent 审批策略（以后端为准）
  agentPolicy: AgentPolicy | null;

  // ui
  cmdPalOpen: boolean;
  settingsOpen: boolean;
  modelDropOpen: boolean;
  onboardOpen: boolean;
  toast: { msg: string; type: string } | null;

  // ── actions ──
  init: () => Promise<void>;
  loadFiles: (path?: string) => Promise<void>;
  loadFile: (path: string) => Promise<void>;
  createFile: () => Promise<void>;
  saveActive: () => Promise<void>;
  deleteFile: (path: string) => Promise<void>;

  setRightTab: (tab: RightTab) => void;
  setMobileView: (v: MobileView) => void;
  toggleFilesPanel: () => void;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  /** 文件树是否显示隐藏文件（点开头），持久化 */
  showHidden: boolean;
  toggleShowHidden: () => void;
  toggleMessageThinking: (sessionIdx: number, msgIdx: number) => void;
  toggleToolCall: (msgIdx: number, toolId: string) => void;

  sendChat: (text: string, attachments?: { name: string; type: string; data: string }[]) => Promise<void>;
  /** 页面重新打开后接回仍在服务端运行的任务 */
  attachActiveRun: () => Promise<void>;
  /** 服务端保存的会话（跨设备/清缓存后的恢复来源） */
  serverSessionList: () => Promise<ServerSessionSummary[]>;
  /** 把服务端的某个会话恢复成一个本地会话 */
  restoreServerSession: (serverId: string) => Promise<boolean>;
  stopChat: () => void;
  newSession: () => void;
  clearChat: () => void;
  addSystemMessage: (content: string) => void;
  exportSession: () => void;
  importSession: (json: string) => boolean;

  // 审批策略
  loadPolicy: () => Promise<void>;
  setApprovalMode: (mode: ApprovalMode) => Promise<void>;
  respondApproval: (msgIdx: number, approvalId: string, approved: boolean, remember: boolean) => Promise<void>;
  clearAlwaysAllow: (key?: string) => Promise<void>;

  setCmdPal: (v: boolean) => void;
  setSettings: (v: boolean) => void;
  setModelDrop: (v: boolean) => void;
  setOnboard: (v: boolean) => void;
  updateConfig: (cfg: Partial<ApiConfig>) => Promise<void>;
  checkApi: () => Promise<void>;
  showToast: (msg: string, type?: string) => void;

  setFileFilter: (f: string) => void;
  setActiveFile: (p: string | null) => void;
  updateActiveContent: (content: string) => void;
  closeTab: (path: string) => void;

  // git
  runGit: (fn: () => Promise<{ stdout: string; code: number }>) => Promise<void>;
  loadGitBranches: () => Promise<void>;
  gitCheckout: (branch: string) => Promise<void>;
  gitBranch: (name: string) => Promise<GitResult>;
  gitDeleteBranch: (name: string) => Promise<GitResult | void>;
  gitMerge: (branch: string) => Promise<void>;
  gitPush: (remote?: string, branch?: string) => Promise<void>;
  gitPull: (remote?: string, branch?: string) => Promise<void>;
  gitFetch: (remote?: string) => Promise<void>;

  // knowledge
  generateKnowledge: () => Promise<void>;
  regenerateKnowledge: () => Promise<void>;
  search: (q: string, ext?: string) => Promise<void>;
  replace: (query: string, replacement: string, dryRun: boolean, ext?: string) => Promise<ReplaceResponse>;

  // MCP
  addMcpServer: (cfg: {
    name: string;
    type: 'http' | 'stdio';
    url?: string;
    command?: string;
    args?: string[];
  }) => Promise<void>;
  toggleMcpServer: (name: string) => Promise<void>;
  removeMcpServer: (name: string) => Promise<void>;
  reloadMcpServers: () => Promise<void>;
  syncMcpServers: () => Promise<void>;
}

const THEME_KEY = STORAGE_KEYS.theme;
const SESSIONS_KEY = STORAGE_KEYS.sessions;
const ACTIVE_RUN_KEY = STORAGE_KEYS.activeRun;
const SHOW_HIDDEN_KEY = STORAGE_KEYS.showHidden;

/**
 * 是否显示隐藏文件（点开头）。
 * 默认关：工作区根目录里 .git、回收站之类占位太多。
 * 但用户要改 .gitignore / .pocketdignore 时必须看得到，所以给开关而不是永久隐藏。
 */
function loadShowHidden(): boolean {
  return readStored(SHOW_HIDDEN_KEY) === '1';
}

/** 从 localStorage 恢复未完成的运行；损坏或过期就直接丢弃 */
function loadActiveRun(): ActiveRun | null {
  try {
    const raw = readStored(ACTIVE_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveRun;
    if (!parsed?.runId || typeof parsed.sessionIdx !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadSessions() {
  try {
    const saved = readStored(SESSIONS_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      if (Array.isArray(data.sessions) && data.sessions.length) {
        return { sessions: data.sessions, curSession: data.curSession || 0 };
      }
    }
  } catch {}
  return null;
}

function loadTheme(): ThemeMode {
  const saved = readStored(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export const useStore = create<AppState>((set, get) => {
  /* 内部辅助：闭包持有 set/get，避免把实现细节暴露成 action */
  /* ── 内部辅助（闭包，不暴露到 state） ── */

  /** 附件里的文本内容：base64 解码后拼成一段可读文本 */
  const decodeAttachmentText = (tf: { name: string; data: string }): string => {
    try {
      return `\n\n[文件: ${tf.name}]\n${atob(tf.data)}`;
    } catch {
      return `\n\n[附件: ${tf.name}]`;
    }
  };

  /** 消息内容的字符数（多模态只算文本 part），用于上下文体积估算 */
  const contentLength = (content: ChatMessage['content']): number => {
    if (typeof content === 'string') return content.length;
    if (!Array.isArray(content)) return 0;
    return content.reduce((acc: number, part: unknown) => {
      const p = part as { type?: string; text?: string };
      return p?.type === 'text' && typeof p.text === 'string' ? acc + p.text.length : acc;
    }, 0);
  };

  const appendMessage = (sessionIdx: number, msg: ChatMessage): void =>
    set((s) => ({
      sessions: s.sessions.map((x, i) =>
        i === sessionIdx ? { ...x, messages: [...x.messages, msg] } : x,
      ),
    }));

  const patchMessage = (
    sessionIdx: number,
    msgIdx: number,
    patch: (m: ChatMessage) => ChatMessage,
  ): void =>
    set((s) => ({
      sessions: s.sessions.map((x, i) =>
        i === sessionIdx
          ? { ...x, messages: x.messages.map((m, j) => (j === msgIdx ? patch(m) : m)) }
          : x,
      ),
    }));

  /** 重连时需要按 runId 找到消息；findLastIndex 在 ES2020 lib 里没有，手写一遍 */
  const findLastIndexByRunId = (messages: ChatMessage[], runId: string): number => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].runId === runId) return i;
    }
    return -1;
  };

  const bindRunIdToLastMessage = (sessionIdx: number, runId: string): void =>
    set((s) => ({
      sessions: s.sessions.map((x, i) =>
        i === sessionIdx
          ? {
              ...x,
              messages: x.messages.map((m, j) =>
                j === x.messages.length - 1 ? { ...m, runId } : m,
              ),
            }
          : x,
      ),
    }));

  /** 实时更新这次运行对应的消息（永远作用于倒数第一条） */
  const patchRunMessage = (
    sessionIdx: number,
    patch: (m: ChatMessage) => ChatMessage,
  ): void =>
    set((s) => ({
      sessions: s.sessions.map((x, i) =>
        i === sessionIdx
          ? {
              ...x,
              messages: x.messages.map((m, j) => (j === x.messages.length - 1 ? patch(m) : m)),
            }
          : x,
      ),
    }));

  /**
   * 把 SSE 事件翻译成 store 变更。直播与重连共用，保证两条路径的渲染结果一致。
   */
  const buildRunHandlers = (
    sessionIdx: number,
    state: RunStreamState,
  ): RunStreamHandlers => ({
    onStep: () => {},
    onMessage: (t) => {
      state.text += t;
      patchRunMessage(sessionIdx, (m) => ({ ...m, content: state.text, thinking: state.thinking }));
    },
    onThinking: (t) => {
      state.thinking += t;
      patchRunMessage(sessionIdx, (m) => ({ ...m, content: state.text, thinking: state.thinking }));
    },
    onToolCall: (call) =>
      patchRunMessage(sessionIdx, (m) => ({ ...m, toolCalls: [...(m.toolCalls || []), call] })),
    onToolResult: (id, output, isError) =>
      patchRunMessage(sessionIdx, (m) => ({
        ...m,
        toolCalls: (m.toolCalls || []).map((t) =>
          // 失败/被拒时自动展开：错误必须一眼可见，不该让用户逐个点开去找
          t.id === id ? { ...t, output, status: isError ? 'error' : 'ok', open: t.open || isError } : t,
        ),
        // tool-result 带的是这次调用之后的完整快照语义，这里顺带把文本同步一次
        content: state.text,
      })),
    onApproval: (approval) =>
      patchRunMessage(sessionIdx, (m) => ({ ...m, approvals: [...(m.approvals || []), approval] })),
    onUsage: (u) => {
      state.usage = u;
    },
    onStatus: (snap) => {
      // 服务端认为仍待批的项，本地若已标记为已解决就不再重复呈现（用户已作答）
      const pending = new Set(snap.pendingApprovals.map((a) => a.id));
      patchRunMessage(sessionIdx, (m) => ({
        ...m,
        approvals: (m.approvals || []).map((a) =>
          !a.resolved && !pending.has(a.id) ? { ...a, resolved: 'approved' as const } : a,
        ),
      }));
    },
    onTruncated: () => {
      // 起点已被环形缓冲丢弃，重建而不是追加
      state.text = '';
      state.thinking = '';
      patchRunMessage(sessionIdx, (m) => ({
        ...m,
        content: '',
        thinking: '',
        toolCalls: [],
      }));
    },
    onError: (msg) => {
      state.text += `${state.text ? '\n' : ''}[错误] ${msg}`;
      patchRunMessage(sessionIdx, (m) => ({ ...m, content: state.text }));
    },
    onWarning: (msg) => {
      state.text += `${state.text ? '\n' : ''}[警告] ${msg}`;
      patchRunMessage(sessionIdx, (m) => ({ ...m, content: state.text }));
    },
    onAborted: (reason) => {
      state.text += `${state.text ? '\n' : ''}[已中止] ${reason}`;
      patchRunMessage(sessionIdx, (m) => ({ ...m, content: state.text }));
    },
  });

  const recordUsage = (
    state: RunStreamState,
    ctxChars: number,
  ): void => {
    const promptTokens = state.usage?.promptTokens ?? 0;
    const completionTokens = state.usage?.completionTokens ?? 0;
    const hasReal = promptTokens > 0 || completionTokens > 0;
    // 有真实 usage 就用真实的，否则用字符数粗估
    const tokens = hasReal
      ? promptTokens + completionTokens
      : Math.round(ctxChars / 4 + state.text.length / 4);
    const today = new Date().toISOString().slice(0, 10);
    set((st) => {
      const usage: UsageStats = { ...st.usage };
      usage.totalCalls += 1;
      usage.totalTokens += tokens;
      usage.ctxChars = 0;
      usage.lastPromptTokens = promptTokens;
      usage.lastCompletionTokens = completionTokens;
      const last = usage.history[usage.history.length - 1];
      if (last && last.date === today) {
        last.calls += 1;
        last.tokens += tokens;
      } else {
        usage.history.push({ date: today, calls: 1, tokens });
      }
      if (usage.history.length > 30) usage.history = usage.history.slice(-30);
      usage.todayCalls = usage.history.filter((h) => h.date === today).reduce((s2, h) => s2 + h.calls, 0);
      usage.todayTokens = usage.history.filter((h) => h.date === today).reduce((s2, h) => s2 + h.tokens, 0);
      // 必须落盘：只读不写的话，刷新一次用量历史就清零
      writeStored(STORAGE_KEYS.usage, JSON.stringify(usage.history));
      return { usage };
    });
  };

  const setActiveRun = (run: ActiveRun): void => {
    set({ activeRun: run });
    try {
      writeStored(ACTIVE_RUN_KEY, JSON.stringify(run));
    } catch {
      /* 隐私模式下写不进去，不影响本次会话 */
    }
  };

  const clearActiveRun = (): void => {
    set({ activeRun: null });
    try {
      removeStored(ACTIVE_RUN_KEY);
    } catch {
      /* 同上 */
    }
  };

  return {

  apiConfig: { apiKey: '', apiBase: 'https://api.openai.com/v1', apiModel: 'gpt-4o' },
  status: 'loading',
  statusText: '连接中...',
  serverHasKey: false,
  theme: loadTheme(),
  showHidden: loadShowHidden(),
  curPath: '.',
  files: [],
  filesLoading: false,
  filesError: null,
  fileFilter: '',
  openFiles: [],
  activeFile: null,
  activeFileError: null,
  rightTab: 'chat',
  // 手机上先给对话：这个应用的定位是「指挥 agent 干活」，不是在小屏上敲代码。
  // 宽屏由 CSS 忽略 data-mobile-view，不受影响。
  mobileView: 'panel',
  // 窄屏下文件树是覆盖式抽屉，默认必须关着——否则一进来就盖住对话，
  // 「手机落地到对话」这个设计就白做了。宽屏下它是常驻侧栏，可见由 CSS 决定。
  filesPanelOpen: typeof window === 'undefined' || window.innerWidth > 768,
  sessions: [{ id: 0, label: '会话 1', messages: [] }],
  curSession: 0,
  chatLoading: false,
  chatAbort: null,
  activeRun: loadActiveRun(),
  attachLost: false,
  usage: {
    totalCalls: 0, totalTokens: 0,
    todayCalls: 0, todayTokens: 0,
    ctxChars: 0, maxCtxChars: 200_000,
    lastPromptTokens: 0, lastCompletionTokens: 0,
    history: JSON.parse(readStored(STORAGE_KEYS.usage) || '[]'),
  },
  gitOut: '',
  gitLoading: false,
  gitError: null,
  gitBranches: [],
  gitBranchLoading: false,
  gitBranchError: null,
  knowledgeDoc: null,
  knowledgeLoading: false,
  knowledgeError: null,
  searchResults: [],
  searchLoading: false,
  searchQuery: '',
  searchExt: '',
  searchScanned: 0,
  searchError: null,
  mcpServers: [],
  agentPolicy: null,
  cmdPalOpen: false,
  settingsOpen: false,
  modelDropOpen: false,
  onboardOpen: false,
  toast: null,

  init: async () => {
    // Restore sessions from localStorage
    const saved = loadSessions();
    if (saved) set(saved);
    try {
      const cfg = await api.getConfig();
      const localKey = get().apiConfig.apiKey;
      set({
        serverHasKey: cfg.apiKey === '***',
        apiConfig: {
          // 后端对已配置的 key 返回 "***" 掩码，本地值才是可用于回传的那一个
          apiKey: cfg.apiKey && cfg.apiKey !== '***' ? cfg.apiKey : localKey,
          apiBase: cfg.apiBase || 'https://api.openai.com/v1',
          apiModel: cfg.apiModel || 'gpt-4o',
        },
      });
    } catch {
      const saved = readStored(STORAGE_KEYS.config);
      if (saved) {
        try {
          const cfg = JSON.parse(saved);
          set({ apiConfig: { ...get().apiConfig, ...cfg } });
        } catch {}
      }
    }
    // apply theme
    document.documentElement.setAttribute('data-theme', get().theme);
    await get().loadFiles('.');
    get().checkApi();
    get().loadGitBranches();
    get().syncMcpServers();
    get().loadPolicy();
    // 上次可能有关页/锁屏时未结束的运行，接回来
    void get().attachActiveRun();
    // 本地没有任何历史（首次打开 / 清了缓存 / 换了浏览器）时，
    // 从服务端自动恢复最近一份——否则用户会以为记录丢了
    void (async () => {
      const local = get().sessions;
      if (local.some((s) => s.messages.length > 0)) return;
      const remote = await get().serverSessionList();
      const newest = remote
        .filter((s) => s.messageCount > 0)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (newest) await get().restoreServerSession(newest.id);
    })();
  },

  setTheme: (t) => {
    set({ theme: t });
    writeStored(THEME_KEY, t);
    document.documentElement.setAttribute('data-theme', t);
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },

  toggleShowHidden: () => {
    const next = !get().showHidden;
    writeStored(SHOW_HIDDEN_KEY, next ? '1' : '0');
    set({ showHidden: next });
    void get().loadFiles(get().curPath);
  },

  toggleMessageThinking: (sessionIdx, msgIdx) => {
    set((s) => ({
      sessions: s.sessions.map((session, i) =>
        i === sessionIdx
          ? {
              ...session,
              messages: session.messages.map((m, j) =>
                j === msgIdx ? { ...m, thinkingOpen: !m.thinkingOpen } : m,
              ),
            }
          : session,
      ),
    }));
  },

  toggleToolCall: (msgIdx, toolId) => {
    set((s) => ({
      sessions: s.sessions.map((session, i) =>
        i === s.curSession
          ? {
              ...session,
              messages: session.messages.map((m, j) =>
                j === msgIdx
                  ? {
                      ...m,
                      toolCalls: (m.toolCalls || []).map((t) =>
                        t.id === toolId ? { ...t, open: !t.open } : t,
                      ),
                    }
                  : m,
              ),
            }
          : session,
      ),
    }));
  },

  loadPolicy: async () => {
    try {
      set({ agentPolicy: await api.getPolicy() });
    } catch {
      /* 后端未就绪时保持现状 */
    }
  },

  setApprovalMode: async (mode) => {
    try {
      await api.setPolicy(mode);
      await get().loadPolicy();
      get().showToast(`审批策略: ${mode}`, 'ok');
    } catch (e: unknown) {
      get().showToast(`设置失败: ${(e as Error).message}`, 'error');
    }
  },

  clearAlwaysAllow: async (key) => {
    try {
      await api.clearAlwaysAllow(key);
      await get().loadPolicy();
      get().showToast(key ? `已撤销 ${key}` : '已清空免审批列表', 'ok');
    } catch (e: unknown) {
      get().showToast(`撤销失败: ${(e as Error).message}`, 'error');
    }
  },

  respondApproval: async (msgIdx, approvalId, approved, remember) => {
    const markResolved = (resolved: 'approved' | 'denied' | 'expired') =>
      set((s) => ({
        sessions: s.sessions.map((session, i) =>
          i === s.curSession
            ? {
                ...session,
                messages: session.messages.map((m, j) =>
                  j === msgIdx
                    ? {
                        ...m,
                        approvals: (m.approvals || []).map((a) =>
                          a.id === approvalId ? { ...a, resolved } : a,
                        ),
                      }
                    : m,
                ),
              }
            : session,
        ),
      }));
    markResolved(approved ? 'approved' : 'denied');
    try {
      await api.respondApproval(approvalId, approved, remember);
    } catch (e: unknown) {
      // 卡片可能来自恢复出来的旧会话，其背后的运行早已结束/被回收。
      // 这时把它标成「已失效」，否则用户会一直看到一个点不动的按钮。
      if (/404/.test((e as Error).message)) {
        markResolved('expired');
        get().showToast('该审批已失效（任务早已结束或服务端已重启）', 'warning');
      } else {
        get().showToast(`审批响应失败: ${(e as Error).message}`, 'error');
      }
    }
  },

  loadFiles: async (path = '.') => {
    set({ filesLoading: true, filesError: null });
    try {
      const data = await api.listFiles(path);
      const showHidden = get().showHidden;
      set({
        files: data.items.filter((i) => showHidden || !i.name.startsWith('.')),
        curPath: path,
        filesLoading: false,
      });
    } catch (e: unknown) {
      set({ filesLoading: false, filesError: (e as Error).message });
    }
  },

  loadFile: async (path: string) => {
    const { openFiles } = get();
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      set({ activeFile: path, activeFileError: null });
      return;
    }
    // 图片类不读成文本：编辑器直接用 raw 端点显示。
    // 走文本读取只会得到「二进制文件，拒绝以文本读取」——等于打不开图片。
    if (isBinaryPreview(path)) {
      set({
        openFiles: [...openFiles, { path, content: '', modified: false }],
        activeFile: path,
        activeFileError: null,
      });
      return;
    }
    try {
      const data = await api.getFile(path);
      set({
        openFiles: [...openFiles, { path, content: data.content, modified: false }],
        activeFile: path,
        activeFileError: null,
      });
    } catch (e: unknown) {
      set({ activeFileError: { path, message: (e as Error).message } });
    }
  },

  createFile: async () => {
    const name = await askPrompt({
      title: '新建文件',
      label: '文件名（可含路径）',
      value: 'main.js',
      confirmText: '创建',
    });
    if (!name) return;
    const { curPath } = get();
    const full = curPath === '.' ? name : `${curPath.replace(/\/+$/, '')}/${name}`;
    try {
      await api.createFile(full);
      await get().loadFiles(curPath);
      get().showToast(`已创建 ${name}`, 'ok');
    } catch (e: unknown) {
      get().showToast(`创建失败: ${(e as Error).message}`, 'error');
    }
  },

  saveActive: async () => {
    const { activeFile, openFiles } = get();
    if (!activeFile) return;
    const f = openFiles.find((x) => x.path === activeFile);
    if (!f) return;
    try {
      await api.saveFile(f.path, f.content);
      set({ openFiles: openFiles.map((x) => (x.path === f.path ? { ...x, modified: false } : x)) });
      get().showToast('✓ 已保存', 'ok');
    } catch (e: unknown) {
      get().showToast(`保存失败: ${(e as Error).message}`, 'error');
    }
  },

  deleteFile: async (path: string) => {
    const ok = await askConfirm({
      title: '删除文件',
      body: `${path}\n\n会移入工作区的回收站，可恢复。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteFile(path);
      const { openFiles, activeFile, curPath } = get();
      const newOpen = openFiles.filter((f) => f.path !== path);
      const newActive = activeFile === path ? (newOpen[0]?.path || null) : activeFile;
      set({ openFiles: newOpen, activeFile: newActive, activeFileError: null });
      await get().loadFiles(curPath);
      get().showToast('已移入回收站', 'ok');
    } catch (e: unknown) {
      get().showToast(`删除失败: ${(e as Error).message}`, 'error');
    }
  },

  setRightTab: (tab) => set({ rightTab: tab, mobileView: 'panel' }),
  setMobileView: (v) => set({ mobileView: v }),
  toggleFilesPanel: () => set((s) => ({ filesPanelOpen: !s.filesPanelOpen })),

  sendChat: async (text: string, attachments?: { name: string; type: string; data: string }[]) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!get().apiConfig.apiKey && !get().serverHasKey) {
      get().showToast('请先填写 API Key', 'error');
      return;
    }
    const { sessions, curSession, apiConfig } = get();
    const sess = sessions[curSession];

    // 构建用户消息（支持多模态）
    // 如果有图片附件，content 变成 OpenAI vision 数组格式
    // 文本文件则直接拼接到文本
    let userMessage: ChatMessage;
    const images = (attachments || []).filter((a) => a.type.startsWith('image/'));
    const textFiles = (attachments || []).filter((a) => !a.type.startsWith('image/'));

    if (images.length > 0) {
      const contentParts: any[] = [{ type: 'text', text }];
      for (const img of images) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:${img.type};base64,${img.data}` },
        });
      }
      for (const tf of textFiles) {
        contentParts.push({ type: 'text', text: decodeAttachmentText(tf) });
      }
      userMessage = { role: 'user', content: contentParts };
    } else {
      let fullText = text;
      for (const tf of textFiles) fullText += decodeAttachmentText(tf);
      userMessage = { role: 'user', content: fullText };
    }

    const ctxChars =
      sess.messages.reduce((sum, m) => sum + contentLength(m.content), 0) + text.length;
    const newMsgs: ChatMessage[] = [...sess.messages, userMessage];
    set({
      sessions: sessions.map((s, i) => (i === curSession ? { ...s, messages: newMsgs } : s)),
      chatLoading: true,
      usage: { ...get().usage, ctxChars },
    });

    const abort = new AbortController();
    set({ chatAbort: abort });

    // 先落一个空的 assistant 消息占位；runId 由响应头回填，用于断连后重连
    const placeholder: ChatMessage = {
      role: 'assistant',
      content: '',
      thinking: '',
      thinkingOpen: false,
      toolCalls: [],
      approvals: [],
    };
    appendMessage(curSession, placeholder);

    const state = { text: '', thinking: '', usage: null as UsagePayload | null };
    const handlers = buildRunHandlers(curSession, state);
    /** 服务端是否已经接受了这次运行（收到过 x-pocketd-run-id） */
    let runAccepted = false;

    try {
      const res = await api.chatStream(newMsgs, abort.signal, {
        // 掩码或空值都不回传，否则会把后端已配置的 key 覆盖掉
        ...(apiConfig.apiKey && apiConfig.apiKey !== '***' ? { apiKey: apiConfig.apiKey } : {}),
        apiBase: apiConfig.apiBase,
        model: apiConfig.apiModel,
        sessionId: `ui-${sess.id}`,
      });
      if (!res.ok) throw new Error(await res.text());

      const runId = res.headers.get('x-pocketd-run-id');
      if (runId) {
        runAccepted = true;
        setActiveRun({ runId, sessionIdx: curSession, lastSeq: -1 });
        bindRunIdToLastMessage(curSession, runId);
      }

      const { sawDone } = await consumeRunStream(res, handlers);
      if (!sawDone) {
        // 连接断了但运行很可能还在跑（手机锁屏、切应用就是这样）。保留 activeRun，
        // 下次打开页面会自动重连回放。
        get().showToast('连接中断，任务仍在服务端继续', 'warning');
      } else {
        clearActiveRun();
      }
    } catch (e: unknown) {
      // 关键区分：请求被服务端接受之前失败 ≠ 运行中途断连。
      // 后者才是手机上的常态（页面卸载时浏览器抛的往往是 TypeError: Failed to
      // fetch 而不是 AbortError），这时绝不能清 activeRun —— 那正好在需要恢复
      // 标记的时候把它销毁，任务会变成「服务端还在跑，但用户永远看不到结果」。
      if (runAccepted) {
        get().showToast('与任务的连接中断，服务端仍在继续', 'warning');
      } else if (!isAbortError(e)) {
        appendMessage(curSession, { role: 'error', content: `❌ ${(e as Error).message}` });
        clearActiveRun();
      }
    } finally {
      recordUsage(state, ctxChars);
      set({ chatLoading: false, chatAbort: null });
    }
  },

  /**
   * 页面重新打开后接回仍在服务端运行的 run。
   * 从 seq 0 重建而不是增量续接：回放是幂等的，重建不会与旧状态漂移。
   */
  attachActiveRun: async () => {
    const active = get().activeRun;
    if (!active || get().chatLoading) return;

    // 先确认运行是否还在（可能已被回收）
    let snapshot;
    try {
      const replay = await api.getRun(active.runId, 0);
      snapshot = replay.snapshot;
    } catch (e: unknown) {
      // 服务端重启或运行已被回收。必须告诉用户，否则「任务莫名消失了」
      get().showToast(`无法接回上次的任务：${(e as Error).message}`, 'warning');
      clearActiveRun();
      return;
    }

    const isFinished = snapshot.status !== 'running';

    set({ curSession: active.sessionIdx, rightTab: 'chat', mobileView: 'panel', chatLoading: !isFinished });
    get().showToast(
      isFinished ? '上次的任务已结束，已恢复结果' : '接回正在运行的任务…',
      'info',
    );

    // 找到这条 run 对应的消息并清空重建（找不到就新建）
    const session = get().sessions[active.sessionIdx];
    if (!session) {
      clearActiveRun();
      return;
    }
    const existing = findLastIndexByRunId(session.messages, active.runId);
    if (existing >= 0) {
      patchMessage(active.sessionIdx, existing, () => ({
        role: 'assistant',
        content: '',
        thinking: '',
        thinkingOpen: false,
        toolCalls: [],
        approvals: [],
        runId: active.runId,
      }));
    } else {
      appendMessage(active.sessionIdx, {
        role: 'assistant',
        content: '',
        thinking: '',
        thinkingOpen: false,
        toolCalls: [],
        approvals: [],
        runId: active.runId,
      });
    }

    const abort = new AbortController();
    set({ chatAbort: abort });
    const state = { text: '', thinking: '', usage: null as UsagePayload | null };
    const handlers = buildRunHandlers(active.sessionIdx, state);

    try {
      const resp = await api.attachRun(active.runId, 0, abort.signal);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      set({ attachLost: false });
      const { sawDone } = await consumeRunStream(resp, handlers);
      // 只有确认跑完（收到 [DONE]）才注销；流再次中断就留着下次继续接
      if (sawDone) {
        clearActiveRun();
      } else {
        // 任务还在服务端跑，但这条连接断了：明确告知并给重试入口
        set({ attachLost: true });
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        appendMessage(active.sessionIdx, {
          role: 'error',
          content: `❌ 无法接回任务: ${(e as Error).message}`,
        });
        clearActiveRun();
      }
    } finally {
      recordUsage(state, 0);
      set({ chatLoading: false, chatAbort: null });
    }
  },

  serverSessionList: async () => {
    try {
      return await api.serverSessions();
    } catch {
      return [];
    }
  },

  restoreServerSession: async (serverId: string) => {
    try {
      const data = await api.getServerSession(serverId);
      const messages: ChatMessage[] = [];
      for (const m of data.messages) {
        const payload = m.payload as ChatMessage | null;
        // 只接受形状正确的记录；服务端自动追加的紧凑记录形状不同，跳过
        if (!payload || typeof payload !== 'object' || typeof payload.role !== 'string') continue;
        if (payload.content === undefined) continue;
        // 服务端副本里可能残留别的、早已结束的运行留下的待批卡片。
        // 那些卡片背后没有连接，点不动；恢复时先标记为失效。
        const restored: ChatMessage = {
          ...payload,
          approvals: (payload.approvals || []).map((a) =>
            a.resolved ? a : { ...a, resolved: 'expired' as const },
          ),
        };
        messages.push(restored);
      }
      if (messages.length === 0) {
        get().showToast('该会话在服务端没有可恢复的消息', 'warning');
        return false;
      }
      const sessions = get().sessions;
      const id = sessions.length;
      set({
        sessions: [
          ...sessions,
          { id, label: `恢复 · ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, messages },
        ],
        curSession: id,
        rightTab: 'chat',
        mobileView: 'panel',
      });
      get().showToast(`已恢复 ${messages.length} 条消息`, 'ok');
      return true;
    } catch (e: unknown) {
      get().showToast(`恢复失败: ${(e as Error).message}`, 'error');
      return false;
    }
  },

  stopChat: () => {
    const active = get().activeRun;
    // 取消是运行级的：即使这次连接已经断了，也要让服务端停下来
    if (active) {
      api.cancelRun(active.runId).catch(() => {});
    }
    get().chatAbort?.abort();
    clearActiveRun();
    set({ chatLoading: false, chatAbort: null });
  },

  newSession: () => {
    const { sessions } = get();
    const id = sessions.length;
    set({
      sessions: [...sessions, { id, label: `会话 ${id + 1}`, messages: [] }],
      curSession: id,
    });
    get().showToast('已新建会话', 'ok');
  },

  clearChat: async () => {
    const ok = await askConfirm({
      title: '清空当前会话',
      body: '将删除本会话的全部消息，不可撤销。',
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    set((s) => ({
      sessions: s.sessions.map((ss, i) => (i === s.curSession ? { ...ss, messages: [] } : ss)),
    }));
  },

  addSystemMessage: (content: string) => {
    set((s) => ({
      sessions: s.sessions.map((ss, i) =>
        i === s.curSession ? { ...ss, messages: [...ss.messages, { role: 'system', content }] } : ss
      ),
    }));
  },

  exportSession: () => {
    const { sessions, curSession } = get();
    const session = sessions[curSession];
    if (!session) return;
    const data = JSON.stringify(session, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${curSession + 1}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    get().showToast('会话已导出', 'ok');
  },

  importSession: (json: string) => {
    try {
      const data = JSON.parse(json);
      if (!data || !Array.isArray(data.messages)) return false;
      const sessions = get().sessions;
      const newSession: ChatSession = {
        id: sessions.length,
        label: data.label || data.name || `导入 ${new Date().toLocaleString()}`,
        messages: data.messages,
      };
      set({ sessions: [...sessions, newSession], curSession: sessions.length });
      return true;
    } catch {
      return false;
    }
  },

  setCmdPal: (v) => set({ cmdPalOpen: v }),
  setSettings: (v) => set({ settingsOpen: v }),
  setModelDrop: (v) => set({ modelDropOpen: v }),
  setOnboard: (v) => set({ onboardOpen: v }),

  updateConfig: async (cfg) => {
    const newCfg = { ...get().apiConfig, ...cfg };
    set({ apiConfig: newCfg });
    writeStored(STORAGE_KEYS.config, JSON.stringify(newCfg));
    try {
      await api.saveConfig(newCfg);
    } catch {}
  },

  checkApi: async () => {
    const { apiConfig, serverHasKey } = get();
    if (!apiConfig.apiKey && !serverHasKey) {
      set({ status: 'warn', statusText: '未配置' });
      return;
    }
    try {
      const res = await api.testEndpoint({
        apiBase: apiConfig.apiBase,
        apiModel: apiConfig.apiModel,
        ...(apiConfig.apiKey && apiConfig.apiKey !== '***' ? { apiKey: apiConfig.apiKey } : {}),
      });
      if (res.ok) set({ status: 'ok', statusText: '已连接' });
      else set({ status: 'error', statusText: `API ${res.status || '错误'}` });
    } catch {
      set({ status: 'error', statusText: '离线' });
    }
  },

  showToast: (msg, type = '') => {
    set({ toast: { msg, type } });
    setTimeout(() => set({ toast: null }), 2500);
  },

  setFileFilter: (f) => {
    set({ fileFilter: f });
    get().loadFiles(get().curPath);
  },

  setActiveFile: (p) => set({ activeFile: p }),

  updateActiveContent: (content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === s.activeFile ? { ...f, content, modified: true } : f,
      ),
    }));
  },

  closeTab: (path) => {
    const { openFiles, activeFile } = get();
    const newOpen = openFiles.filter((f) => f.path !== path);
    const newActive = activeFile === path ? (newOpen[0]?.path || null) : activeFile;
    set({ openFiles: newOpen, activeFile: newActive });
  },

  runGit: async (fn) => {
    set({ gitLoading: true, gitError: null, rightTab: 'git', mobileView: 'panel' });
    try {
      const result = await fn();
      const failed = typeof result.code === 'number' && result.code !== 0;
      set({
        gitOut: result.stdout || (failed ? '' : '(无输出)'),
        gitError: failed ? result.stdout || '命令以非零状态退出' : null,
        gitLoading: false,
      });
    } catch (e: unknown) {
      set({ gitError: (e as Error).message, gitOut: '', gitLoading: false });
    }
  },

  loadGitBranches: async () => {
    set({ gitBranchLoading: true, gitBranchError: null });
    try {
      const branches = await api.gitBranches();
      set({ gitBranches: branches, gitBranchLoading: false });
    } catch (e: unknown) {
      set({ gitBranchLoading: false, gitBranchError: (e as Error).message });
    }
  },

  gitCheckout: async (branch: string) => {
    await get().runGit(async () => {
      const r = await api.gitCheckout(branch);
      await get().loadGitBranches();
      return r;
    });
    get().showToast(`已切换到 ${branch}`, 'ok');
  },

  gitBranch: async (name: string): Promise<GitResult> => {
    const r = await api.gitCreateBranch(name);
    await get().loadGitBranches();
    get().showToast(`已创建分支 ${name}`, 'ok');
    return r;
  },

  gitDeleteBranch: async (name: string) => {
    const ok = await askConfirm({
      title: '删除分支',
      body: `git branch -D ${name}\n\n未合并的提交会丢失。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    const r = await api.gitDeleteBranch(name);
    await get().loadGitBranches();
    get().showToast(`已删除 ${name}`, 'ok');
    return r;
  },

  gitMerge: async (branch: string) => {
    await get().runGit(async () => {
      const r = await api.gitMerge(branch);
      await get().loadGitBranches();
      return r;
    });
    get().showToast(`已合并 ${branch}`, 'ok');
  },

  gitPush: async (remote, branch) => {
    await get().runGit(async () => {
      const r = await api.gitPush(remote, branch);
      await get().loadGitBranches();
      return r;
    });
    get().showToast('Push 完成', 'ok');
  },

  gitPull: async (remote, branch) => {
    await get().runGit(async () => {
      const r = await api.gitPull(remote, branch);
      await get().loadGitBranches();
      return r;
    });
    get().showToast('Pull 完成', 'ok');
  },

  gitFetch: async (remote) => {
    await get().runGit(async () => {
      const r = await api.gitFetch(remote);
      await get().loadGitBranches();
      return r;
    });
    get().showToast('Fetch 完成', 'ok');
  },

  generateKnowledge: async () => {
    set({ knowledgeLoading: true, knowledgeError: null });
    try {
      const doc = await api.generateKnowledge();
      set({ knowledgeDoc: doc, knowledgeLoading: false, rightTab: 'knowledge', mobileView: 'panel' });
    } catch (e: unknown) {
      set({ knowledgeLoading: false, knowledgeError: (e as Error).message });
    }
  },

  regenerateKnowledge: async () => {
    set({ knowledgeDoc: null, knowledgeError: null });
    await get().generateKnowledge();
  },

  search: async (q: string, ext = '') => {
    if (!q.trim()) {
      set({ searchResults: [], searchQuery: '', searchScanned: 0, searchError: null });
      return;
    }
    set({ searchLoading: true, searchQuery: q, searchExt: ext, searchError: null });
    const res = await api.search(q, ext);
    set({
      searchResults: res.results,
      searchLoading: false,
      searchScanned: res.filesScanned,
      searchError: res.error ?? null,
    });
    if (res.truncated) get().showToast('结果过多，已截断', 'info');
  },

  replace: async (query: string, replacement: string, dryRun: boolean, ext = '') => {
    const result = await api.replace(query, replacement, dryRun, ext);
    if (!dryRun && get().searchQuery) {
      await get().search(get().searchQuery, get().searchExt);
    }
    return result;
  },

  addMcpServer: async (cfg) => {
    try {
      const res = await api.mcpAdd(cfg);
      if (res.error) {
        get().showToast(`已保存，但连接失败: ${res.error}`, 'error');
      } else {
        get().showToast(`已连接 ${cfg.name}，发现 ${res.tools} 个工具`, 'ok');
      }
      const servers = await api.mcpList();
      set({ mcpServers: servers });
    } catch (e: unknown) {
      get().showToast(`MCP 添加失败: ${(e as Error).message}`, 'error');
    }
  },

  toggleMcpServer: async (name) => {
    try {
      await api.mcpToggle(name);
      const servers = await api.mcpList();
      set({ mcpServers: servers });
    } catch (e: unknown) {
      get().showToast(`MCP 切换失败: ${(e as Error).message}`, 'error');
      await get().syncMcpServers();
    }
  },

  removeMcpServer: async (name) => {
    try {
      await api.mcpRemove(name);
      const servers = await api.mcpList();
      set({ mcpServers: servers });
    } catch (e: unknown) {
      get().showToast(`MCP 移除失败: ${(e as Error).message}`, 'error');
    }
  },

  reloadMcpServers: async () => {
    try {
      await api.mcpReload();
      await get().syncMcpServers();
      get().showToast('MCP 服务器已刷新', 'ok');
    } catch (e: unknown) {
      get().showToast(`MCP 刷新失败: ${(e as Error).message}`, 'error');
    }
  },

  // 从后端同步 MCP 服务器列表 (启动时调用)
  syncMcpServers: async () => {
    try {
      const servers = await api.mcpList();
      set({ mcpServers: servers });
    } catch {
      // 后端可能未就绪, 保持现状
    }
  },
};
});

/* ── Session persistence ──
   原来每次 state 变化都全量序列化整个会话树，在手机上（搜索框每敲一个字）
   会造成明显卡顿。改成尾随节流：只在静止 800ms 后写一次。 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersisted = '';

function persistSessions(sessions: ChatSession[], curSession: number): void {
  const payload = JSON.stringify({ sessions, curSession });
  if (payload === lastPersisted) return;
  lastPersisted = payload;
  try {
    writeStored(SESSIONS_KEY, payload);
  } catch {
    /* 配额满或隐私模式：丢掉这次写，不影响运行 */
  }
  // 同时推一份到服务端：localStorage 会被清、换浏览器就没了，
  // 而服务端的副本是唯一能跨设备/跨清缓存恢复的来源。
  void pushSessionsToServer(sessions);
}

/** 服务端以 {role, payload} 存消息，payload 直接用客户端的 ChatMessage，恢复时无损 */
/**
 * 把会话推到服务端。只推内容变过的：原来每次都把所有会话全量 PUT 一遍，
 * 会话一多就是每个节流周期 N 个请求、每个都带完整消息体，纯浪费。
 * 用 JSON 串做指纹，相同就跳过。
 */
const pushedSessionDigest = new Map<string, string>();

async function pushSessionsToServer(sessions: ChatSession[]): Promise<void> {
  for (const s of sessions) {
    if (s.messages.length === 0) continue;
    const key = `ui-${s.id}`;
    const payload = s.messages.map((m) => ({ role: m.role, payload: m }));
    const digest = JSON.stringify([s.label, payload]);
    if (pushedSessionDigest.get(key) === digest) continue;
    try {
      await api.putServerSession(key, s.label, payload);
      pushedSessionDigest.set(key, digest);
    } catch {
      // 服务端不可用不该影响本地使用；不记指纹，下次再试
    }
  }
}

useStore.subscribe((state) => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistSessions(state.sessions, state.curSession), 800);
});

/* 关页/切后台时立刻落盘，避免节流窗口内丢最后一段 */
window.addEventListener('pagehide', () => {
  const s = useStore.getState();
  persistSessions(s.sessions, s.curSession);
});
