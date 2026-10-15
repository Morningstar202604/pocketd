/* ── API 调用层 ── */
export interface ApiConfig {
  apiKey: string;
  apiBase: string;
  apiModel: string;
  temperature?: number;
  workspace?: string;
}

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  /** 命中 .gitignore/.pocketdignore：仍可打开，但不会被搜索收录 */
  ignored?: boolean;
}

export interface FileListResult {
  items: FileItem[];
  path: string;
}

export interface FileContent {
  path: string;
  content: string;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
  lastCommit?: string;
  ahead: number;
  behind: number;
}

export interface McpServerInfo {
  name: string;
  type: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  toolCount: number;
}

export type ApprovalMode = 'auto' | 'edits' | 'strict';

export interface AgentPolicy {
  mode: ApprovalMode;
  alwaysAllow: string[];
  pendingApprovals: number;
}

export interface AgentToolInfo {
  name: string;
  description: string;
  source: 'builtin' | 'mcp';
}

export interface TrashEntry {
  name: string;
  originalPath: string;
  deletedAt: string;
}

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchResponse {
  results: SearchHit[];
  filesScanned: number;
  truncated: boolean;
  /** 有值表示搜索失败；results 此时为空。区分「无匹配」与「请求失败」 */
  error?: string;
}

export interface ReplaceResponse {
  ok: boolean;
  filesAffected: number;
  totalMatches: number;
  changed: { path: string; matches: number }[];
}

export interface AgentRunSnapshot {
  runId: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  eventCount: number;
  lastSeq: number;
  sessionId?: string;
  steps: number;
  toolCalls: number;
  textLength: number;
  pendingApprovals: Array<{
    id: string;
    tool: string;
    args: Record<string, unknown>;
    danger: 'low' | 'medium' | 'high';
    reason: string;
  }>;
  error?: string;
}

export interface ServerSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** 服务端以 {role, payload} 形式存消息；payload 就是客户端的 ChatMessage */
export interface ServerStoredMessage {
  seq?: number;
  role: string;
  payload: unknown;
  createdAt?: string;
}

export interface RunReplay {
  events: Array<{ seq: number; event: string; data: unknown }>;
  truncated: boolean;
  snapshot: AgentRunSnapshot;
}

const BASE = '/api';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return null as T;
  return res.json();
}

export const api = {
  getConfig: () => request<ApiConfig>('/config'),

  saveConfig: (cfg: Partial<ApiConfig>) =>
    request('/config', { method: 'POST', body: JSON.stringify(cfg) }),

  listFiles: (path = '.') =>
    request<FileListResult>(`/files?path=${encodeURIComponent(path)}`),

  getFile: (path: string) =>
    request<FileContent>(`/file?path=${encodeURIComponent(path)}`),

  saveFile: (path: string, content: string) =>
    request('/file', { method: 'POST', body: JSON.stringify({ path, content }) }),

  createFile: (path: string) =>
    request('/file', { method: 'PUT', body: JSON.stringify({ path, content: '' }) }),

  deleteFile: (path: string) =>
    request(`/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),

  gitStatus: () => request<GitResult>('/git/status'),
  gitDiff: () => request<GitResult>('/git/diff'),
  gitLog: () => request<GitResult>('/git/log'),
  gitAdd: (files: string[]) =>
    request<GitResult>('/git/add', { method: 'POST', body: JSON.stringify({ files }) }),
  gitCommit: (message: string) =>
    request<GitResult>('/git/commit', { method: 'POST', body: JSON.stringify({ message }) }),
  gitInit: () => request<GitResult>('/git/init', { method: 'POST' }),
  gitBranches: (): Promise<GitBranch[]> =>
    request<GitBranch[]>('/git/branches'),
  gitCheckout: (branch: string) =>
    request<GitResult>('/git/checkout', { method: 'POST', body: JSON.stringify({ branch }) }),
  gitCreateBranch: (name: string) =>
    request<GitResult>('/git/branch', { method: 'POST', body: JSON.stringify({ name }) }),
  gitDeleteBranch: (name: string) =>
    request<GitResult>('/git/branch', { method: 'DELETE', body: JSON.stringify({ name }) }),
  gitMerge: (branch: string) =>
    request<GitResult>('/git/merge', { method: 'POST', body: JSON.stringify({ branch }) }),
  gitPush: (remote?: string, branch?: string) =>
    request<GitResult>('/git/push', { method: 'POST', body: JSON.stringify({ remote, branch }) }),
  gitPull: (remote?: string, branch?: string) =>
    request<GitResult>('/git/pull', { method: 'POST', body: JSON.stringify({ remote, branch }) }),
  gitFetch: (remote?: string) =>
    request<GitResult>('/git/fetch', { method: 'POST', body: JSON.stringify({ remote }) }),
  gitRemotes: () => request<GitResult>('/git/remotes'),

  generateKnowledge: (): Promise<string> =>
    request<{ doc: string }>('/knowledge/generate').then((r) => r.doc),

  /* ── Agent 会话与审批 ── */
  getStatus: () =>
    request<{
      workspace: string;
      host: string;
      model: string;
      apiBase: string;
      hasApiKey: boolean;
      builtinTools: string[];
      mcpServers: { name: string; type: string; enabled: boolean; toolCount: number }[];
      mcpErrors: { name: string; error: string }[];
    }>('/status'),

  getToken: (): Promise<{ token: string }> => request('/auth/token'),

  getPolicy: (): Promise<AgentPolicy> => request('/agent/policy'),

  setPolicy: (mode: ApprovalMode) =>
    request<{ ok: boolean; mode: ApprovalMode }>('/agent/policy', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  clearAlwaysAllow: (key?: string) =>
    request<{ ok: boolean; alwaysAllow: string[] }>('/agent/policy/always-allow', {
      method: 'DELETE',
      body: JSON.stringify({ key }),
    }),

  respondApproval: (id: string, approved: boolean, remember = false) =>
    request<{ ok: boolean }>('/agent/approval', {
      method: 'POST',
      body: JSON.stringify({ id, approved, remember }),
    }),

  listTools: (): Promise<{ tools: AgentToolInfo[] }> => request('/agent/tools'),

  /* ── Agent 运行（断连后可重连回放） ── */
  listRuns: (): Promise<{ runs: AgentRunSnapshot[] }> => request('/agent/runs'),

  getRun: (runId: string, from = 0): Promise<RunReplay> =>
    request<RunReplay>(`/agent/runs/${encodeURIComponent(runId)}?from=${from}`),

  /** 重连到一次运行：先回放 from 之后的事件，再继续直播 */
  attachRun: (runId: string, from: number, signal: AbortSignal): Promise<Response> =>
    fetch(`${BASE}/agent/runs/${encodeURIComponent(runId)}/stream?from=${from}`, { signal }),

  cancelRun: (runId: string) =>
    request<{ ok: boolean }>(`/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }),

  listTrash: (): Promise<{ items: TrashEntry[] }> => request('/trash'),

  restoreTrash: (name: string) =>
    request<{ ok: boolean; restoredTo: string }>('/trash/restore', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  serverSessions: () =>
    request<ServerSessionSummary[]>('/agent/sessions'),

  getServerSession: (id: string) =>
    request<{ id: string; messages: ServerStoredMessage[] }>(
      `/agent/sessions/${encodeURIComponent(id)}`,
    ),

  /** 把完整显示历史推给服务端：服务端只追加助手轮次，不足以重建对话 */
  putServerSession: (id: string, title: string, messages: ServerStoredMessage[]) =>
    request<{ ok: boolean }>(`/agent/sessions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ title, messages }),
    }),

  deleteServerSession: (id: string) =>
    request<{ ok: boolean }>(`/agent/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  chatStream: (
    messages: { role: string; content: unknown }[],
    signal: AbortSignal,
    options?: {
      apiKey?: string;
      apiBase?: string;
      model?: string;
      sessionId?: string;
    },
  ): Promise<Response> => {
    return fetch(`${BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...options }),
      signal,
    });
  },

  testEndpoint: (cfg: { apiBase?: string; apiKey?: string; apiModel?: string }): Promise<{ ok: boolean; status: number; error?: string }> =>
    request('/config/test', { method: 'POST', body: JSON.stringify(cfg) }),

  search: async (q: string, ext = ''): Promise<SearchResponse> => {
    try {
      const params = new URLSearchParams({ q });
      if (ext) params.set('ext', ext);
      const res = await fetch(`${BASE}/search?${params}`);
      if (!res.ok) {
        return { results: [], filesScanned: 0, truncated: false, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as Partial<SearchResponse> & { error?: string };
      if (data.error) {
        return { results: [], filesScanned: 0, truncated: false, error: data.error };
      }
      return {
        results: data.results ?? [],
        filesScanned: data.filesScanned ?? 0,
        truncated: data.truncated ?? false,
      };
    } catch (e: unknown) {
      return { results: [], filesScanned: 0, truncated: false, error: (e as Error).message };
    }
  },

  replace: (query: string, replacement: string, dryRun: boolean, include = ''): Promise<ReplaceResponse> =>
    request<ReplaceResponse>('/replace', {
      method: 'POST',
      body: JSON.stringify({ query, replacement, dryRun, ext: include || undefined }),
    }),

  /* ── MCP 管理 API (后端 REST: /api/mcp/servers) ── */
  mcpList: (): Promise<McpServerInfo[]> => request('/mcp/servers'),

  mcpAdd: (cfg: {
    name: string;
    type: 'http' | 'stdio';
    url?: string;
    command?: string;
    args?: string[];
  }) => request<{ ok: boolean; name: string; tools: number; error?: string }>('/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(cfg),
  }),

  mcpRemove: (name: string) =>
    request(`/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(() => true),

  mcpToggle: (name: string) =>
    request<{ ok: boolean; enabled: boolean }>(`/mcp/servers/${encodeURIComponent(name)}/toggle`, { method: 'POST' }),

  mcpReload: () =>
    request<{ name: string; tools: number; error?: string }[]>('/mcp/reload', { method: 'POST' }),
};

