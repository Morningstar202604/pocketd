import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore, ChatMessage, ToolCallView, ApprovalView } from '../store';
import { QUICK_PROMPTS } from '../lib/presets';
import { Markdown } from './Markdown';
import { EmptyState, InlineNotice, LoadingState } from './StateView';
import type { ServerSessionSummary } from '../lib/api';

const SLASH_COMMANDS = [
  { cmd: '/help', desc: '显示所有命令帮助' },
  { cmd: '/clear', desc: '清空当前对话' },
  { cmd: '/reset', desc: '新建会话' },
  { cmd: '/save', desc: '保存当前文件' },
  { cmd: '/run <cmd>', desc: '让 agent 执行命令' },
  { cmd: '/export', desc: '导出当前会话' },
  { cmd: '/model <name>', desc: '切换 AI 模型' },
  { cmd: '/import', desc: '导入会话 JSON' },
  { cmd: '/approve <模式>', desc: '切换审批策略 auto|edits|strict' },
];

export function ChatPanel() {
  const {
    sessions, curSession, chatLoading,
    sendChat, stopChat, newSession, clearChat, apiConfig, restoreServerSession,
    attachLost, attachActiveRun,
  } = useStore();

  const [input, setInput] = useState('');
  const [showPrompts, setShowPrompts] = useState(true);
  const [attachments, setAttachments] = useState<{ name: string; type: string; data: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [slashHint, setSlashHint] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const handleImportSession = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = useStore.getState().importSession(reader.result as string);
      if (ok) {
        useStore.getState().showToast('会话已导入', 'ok');
      } else {
        useStore.getState().showToast('导入失败：无效文件', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const session = sessions[curSession];
  const messages = session?.messages || [];

  /* ── 服务端历史：清本地缓存 / 换设备后的恢复入口 ── */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [serverList, setServerList] = useState<ServerSessionSummary[]>([]);

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next) return;
    setHistoryState('loading');
    void useStore
      .getState()
      .serverSessionList()
      .then((list) => {
        setServerList(list);
        setHistoryState('ready');
      })
      .catch(() => setHistoryState('error'));
  };

  useEffect(() => {
    // Show slash command hint when input starts with "/"
    setSlashHint(input.startsWith('/') && input.length > 0 && !input.includes(' '));
  }, [input]);

  // 流式输出时不要抢用户的滚动位置：只有他本来就贴着底部才跟随，
  // 否则显示「回到底部」。之前是无条件滚到底，一边读一边被拽走。
  const [pinned, setPinned] = useState(true);
  const [unread, setUnread] = useState(false);

  const handleScroll = useCallback(() => {
    const el = msgsRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setPinned(nearBottom);
    if (nearBottom) setUnread(false);
  }, []);

  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return;
    if (pinned) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else setUnread(true);
  }, [messages, pinned]);

  const jumpToBottom = () => {
    const el = msgsRef.current;
    if (!el) return;
    setPinned(true);
    setUnread(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const handleFileAdd = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result as string;
        const base64 = data.split(',')[1] || '';
        setAttachments((prev) => [...prev, { name: file.name, type: file.type, data: base64 }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const data = reader.result as string;
          const base64 = data.split(',')[1] || '';
          setAttachments((prev) => [...prev, { name: '剪贴板图片', type: file.type, data: base64 }]);
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  }, []);

  /* ── Slash commands ── */
  const runSlash = async (cmd: string): Promise<boolean> => {
    const parts = cmd.slice(1).trim().split(/\s+/);
    const name = parts[0]?.toLowerCase();
    const args = parts.slice(1).join(' ');
    const S = useStore.getState();
    switch (name) {
      case 'help':
        S.addSystemMessage('📖 可用命令：\n`/help` 显示帮助\n`/clear` 清空对话\n`/reset` 新建会话\n`/save` 保存当前文件\n`/run <cmd>` 让 agent 执行命令\n`/export` 导出会话\n`/import` 导入会话 JSON\n`/model <name>` 切换模型\n`/approve auto|edits|strict` 切换审批策略');
        return true;
      case 'clear':
        clearChat();
        return true;
      case 'reset':
        newSession();
        return true;
      case 'save':
        S.saveActive();
        S.showToast('已保存', 'ok');
        return true;
      case 'run':
        if (!args) {
          S.setRightTab('terminal');
          S.showToast('请在终端手动执行命令', 'info');
          return true;
        }
        // 交给 agent 执行：走 bash 工具，因此受审批策略约束
        sendChat(`执行这条命令并汇报结果：\n\`\`\`\n${args}\n\`\`\``);
        return true;
      case 'approve': {
        const mode = args.trim();
        if (mode === 'auto' || mode === 'edits' || mode === 'strict') {
          S.setApprovalMode(mode);
        } else {
          S.showToast(`当前审批策略: ${S.agentPolicy?.mode ?? '未知'}`, 'info');
        }
        return true;
      }
      case 'export':
        S.exportSession();
        return true;
      case 'model':
        if (args) {
          S.updateConfig({ apiModel: args });
          S.showToast(`模型已切换至 ${args}`, 'ok');
        } else {
          S.showToast(`当前模型: ${S.apiConfig.apiModel}`, 'info');
        }
        return true;
      case 'import':
        importRef.current?.click();
        return true;
      default:
        return false;
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || chatLoading) return;
    // Slash command interception
    if (text.startsWith('/')) {
      runSlash(text).then((handled) => {
        if (handled) {
          setInput('');
          setAttachments([]);
        } else {
          // Not a known command — send as regular message
          sendChat(text, attachments);
          setInput('');
          setAttachments([]);
        }
      }).catch(() => {});
      return;
    }
    sendChat(text, attachments);
    setInput('');
    setAttachments([]);
    inputRef.current?.focus();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
        borderBottom: "1px solid var(--border)", background: "var(--bg-alt)", flexShrink: 0,
        minHeight: 48,
      }}>
        <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 600 }}>
          AI 对话
          <small style={{ fontWeight: 400, color: "var(--fg-dim)", fontSize: 'var(--text-xs)', marginLeft: 4 }}>
            {apiConfig.apiModel}
          </small>
        </span>
        <span style={{ fontSize: 'var(--text-2xs)', background: "var(--bg-overlay)", padding: '2px 6px', borderRadius: 'var(--radius-lg)', color: "var(--fg-muted)" }}>
          会话 {curSession + 1}
        </span>
        <button type="button" className="icon-btn" onClick={newSession} title="新建会话" aria-label="新建会话">
          <span aria-hidden="true">✚</span>
        </button>
        <button type="button" className="icon-btn" onClick={clearChat} title="清空" aria-label="清空当前会话">
          <span aria-hidden="true">🗑</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={toggleHistory}
          title="服务端历史"
          aria-label="查看服务端保存的历史"
          aria-expanded={historyOpen}
        >
          <span aria-hidden="true">☁</span>
        </button>
      </div>

      {attachLost && (
        <div
          style={{
            padding: '6px 8px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <InlineNotice tone="warn">与任务的连接中断了，任务仍在服务端继续运行</InlineNotice>
          <button type="button" className="btn-xs" onClick={() => void attachActiveRun()}>
            重新接回
          </button>
        </div>
      )}

      {historyOpen && (
        <div
          role="region"
          aria-label="服务端历史"
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-alt)',
            maxHeight: 240,
            overflowY: 'auto',
            flexShrink: 0,
            padding: 6,
          }}
        >
          <div style={{ display: 'flex', gap: 6, padding: '2px 2px 6px' }}>
            <button
              type="button"
              className="btn-xs"
              onClick={() => importRef.current?.click()}
              aria-label="从文件导入会话"
            >
              <span aria-hidden="true">📥</span> 从文件导入
            </button>
            <button
              type="button"
              className="btn-xs"
              onClick={toggleHistory}
              style={{ marginLeft: 'auto' }}
              aria-label="关闭历史面板"
            >
              收起
            </button>
          </div>
          {historyState === 'loading' && <LoadingState label="读取服务端历史" compact />}
          {historyState === 'error' && (
            <InlineNotice tone="error">无法读取服务端历史，本地对话不受影响</InlineNotice>
          )}
          {historyState === 'ready' && serverList.length === 0 && (
            <EmptyState
              icon="☁"
              title="服务端还没有保存的会话"
              description="对话进行中会自动同步一份到服务端，清掉浏览器缓存或换设备后可从这里恢复"
              compact
            />
          )}
          {historyState === 'ready' &&
            serverList.map((s) => (
              <button
                key={s.id}
                type="button"
                className="row-btn touch-row"
                onClick={() => restoreServerSession(s.id)}
                aria-label={`恢复会话 ${s.title}`}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.title || '(无标题)'}
                </span>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', flexShrink: 0 }}>
                  {s.messageCount} 条 · {relativeTime(s.updatedAt)}
                </span>
              </button>
            ))}
        </div>
      )}

      <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          ref={msgsRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
          role="log"
          aria-live="polite"
          aria-busy={chatLoading}
        >
          {/* 空会话时把快捷指令放进主区域：这才是「把位置留给展示」——
              有内容时它们是底部的窄条，没内容时它们就是内容本身 */}
          {messages.length === 0 && !chatLoading && (
            <EmptyState
              icon="🤖"
              title="说一句话，让 agent 去干活"
              description="它会读写工作区、执行命令、调用 MCP——危险操作会先请你批准。手机锁屏也不会中断。"
              action={
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 320 }}>
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="chip"
                      onClick={() => sendChat(p.text)}
                      aria-label={`快捷指令: ${p.label}`}
                      title={p.text}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              }
            />
          )}
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              sessionIdx={curSession}
              msgIdx={i}
              isStreaming={chatLoading && i === messages.length - 1}
            />
          ))}
          {chatLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 4 }}>
              <button
                type="button"
                onClick={stopChat}
                style={{
                  fontSize: 'var(--text-xs)', background: 'var(--bg-alt)', border: '1px solid var(--border)',
                  color: 'var(--fg-muted)', padding: '3px 14px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                }}
                aria-label="停止 AI 生成"
              >
                <span aria-hidden="true">■</span> 停止生成
              </button>
            </div>
          )}
        </div>

        {!pinned && (
          <button
            type="button"
            className="scroll-bottom"
            onClick={jumpToBottom}
            aria-label={unread ? '有新的输出，回到底部' : '回到底部'}
          >
            <span aria-hidden="true">↓</span>
            {unread && <span className="pip" aria-hidden="true" />}
          </button>
        )}
      </div>

      {/* 快捷指令只在「有内容」时作为底部窄条出现；空会话时它们已经在主区域里了 */}
      {showPrompts && messages.length > 0 && (
        <div
          className="prompt-strip"
          role="toolbar"
          aria-label="快捷指令"
        >
          <div className="prompt-strip-scroll">
            {QUICK_PROMPTS.map((p) => (
              <button
                type="button"
                key={p.label}
                className="chip"
                onClick={() => sendChat(p.text)}
                aria-label={`快捷指令: ${p.label}`}
                title={p.text}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowPrompts(false)}
            style={{ minWidth: 28, minHeight: 28 }}
            aria-label="隐藏快捷指令"
            title="隐藏快捷指令"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      {/* Slash command hint dropdown */}
      {slashHint && (
        <div role="listbox" aria-label="命令提示" style={{
          borderTop: '1px solid var(--border)', background: "var(--bg-alt)", flexShrink: '0',
          maxHeight: 200, overflowY: 'auto', padding: '4px 0',
        }}>
          {SLASH_COMMANDS.filter((sc) => input === '/' || sc.cmd.toLowerCase().startsWith(input.toLowerCase())).map((sc) => (
            <button
              key={sc.cmd}
              onClick={() => { setInput(sc.cmd + ' '); setSlashHint(false); inputRef.current?.focus(); }}
              role="option"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
                background: 'transparent', border: 'none', width: '100%', textAlign: 'left',
                cursor: 'pointer', minHeight: 32,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              aria-label={`${sc.cmd} — ${sc.desc}`}
            >
              <code style={{
                fontSize: 'var(--text-xs)', color: "var(--accent)", fontFamily: "var(--font-mono)",
                background: "var(--accent-soft)", padding: '1px 6px', borderRadius: 'var(--radius-xs)',
                minWidth: 90,
              }}>{sc.cmd}</code>
              <span style={{ fontSize: 'var(--text-xs)', color: "var(--fg-dim)" }}>{sc.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 10px',
          borderTop: '1px solid var(--border)', background: "var(--bg-alt)", flexShrink: 0,
        }}>
          {attachments.map((a, i) => (
            <span key={i} style={{
              fontSize: 'var(--text-2xs)', padding: '2px 8px', borderRadius: 'var(--radius-lg)',
              background: "var(--accent-soft)", color: "var(--accent)",
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {a.type.startsWith('image/') ? '🖼' : '📎'} {a.name}
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`移除附件 ${a.name}`}
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: '0 2px' }}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* Input area with drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileAdd(e.dataTransfer.files); }}
        style={{
          display: 'flex', padding: 8, gap: 6, flexShrink: 0, alignItems: 'flex-end',
          borderTop: `1px solid ${dragOver ? "var(--accent)" : "var(--border)"}`,
          background: dragOver ? "var(--accent-soft)" : 'transparent',
          transition: 'all .15s',
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          onPaste={handlePaste}
          placeholder="Enter 发送 · Shift+Enter 换行 · 粘贴或拖放附件"
          rows={2}
          aria-label="AI 对话输入框 (Enter 发送, Shift+Enter 换行)"
          style={{
            flex: 1, background: "var(--bg-alt)", color: "var(--fg)",
            border: `1px solid ${dragOver ? "var(--accent)" : "var(--border)"}`, borderRadius: 'var(--radius-md)', padding: 8,
            resize: 'none', fontSize: 'var(--text-base)', maxHeight: 120, outline: 'none',
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.json,.ts,.js,.py,.java"
          style={{ display: 'none' }}
          onChange={(e) => handleFileAdd(e.target.files)}
        />
        {/* Mobile camera capture + generic file picker */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => handleFileAdd(e.target.files)}
          id="mobile-camera-input"
        />
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleImportSession}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label="添加附件"
          title="添加附件"
          style={{
            background: "var(--bg-alt)", border: "1px solid var(--border)",
            borderRadius: 'var(--radius-md)', padding: '0 10px', height: 34, fontSize: 'var(--text-lg)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          <span aria-hidden="true">📎</span>
        </button>
        <button
          onClick={() => {
            const inp = document.getElementById('mobile-camera-input') as HTMLInputElement;
            inp?.click();
          }}
          aria-label="拍照上传"
          title="拍照上传"
          style={{
            background: "var(--bg-alt)", border: "1px solid var(--border)",
            borderRadius: 'var(--radius-md)', padding: '0 10px', height: 34, fontSize: 'var(--text-lg)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          <span aria-hidden="true">📷</span>
        </button>
        <button
          onClick={handleSend}
          disabled={chatLoading || (!input.trim() && attachments.length === 0)}
          aria-label={chatLoading ? '正在生成中' : '发送消息'}
          style={{
            background: "var(--accent)", color: 'var(--fg-on-accent)', border: 'none',
            borderRadius: 'var(--radius-md)', padding: '0 16px', height: 34, fontSize: 'var(--text-base)',
            opacity: (chatLoading || (!input.trim() && attachments.length === 0)) ? 0.5 : 1, flexShrink: 0,
            minWidth: 60,
          }}
        >
          {chatLoading ? '...' : '发送'}
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  sessionIdx,
  msgIdx,
  isStreaming,
}: {
  msg: ChatMessage;
  sessionIdx: number;
  msgIdx: number;
  isStreaming?: boolean;
}) {
  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';
  const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  const isEmpty = !isUser && !isError && contentStr.length === 0;
  const { chatLoading, toggleMessageThinking, respondApproval } = useStore();

  const bg = isUser ? "var(--accent)" : isError ? "var(--error-soft)" : "var(--bg-alt)";
  const fg = isUser ? 'var(--fg-on-accent)' : isError ? 'var(--error)' : 'var(--fg)';
  const align: 'flex-end' | 'center' | 'flex-start' = isUser ? 'flex-end' : isError ? 'center' : 'flex-start';
  const border = isUser ? 'none' : isError ? '1px solid var(--error)' : '1px solid var(--border)';

  const hasThinking = !!msg.thinking && msg.thinking.length > 0;
  const toolCalls = msg.toolCalls || [];
  const approvals = msg.approvals || [];
  const pendingApproval = approvals.find((a) => !a.resolved);

  return (
    <div style={{ alignSelf: align, maxWidth: '92%', width: toolCalls.length > 0 ? '92%' : undefined }} role={isError ? 'alert' : isUser ? 'status' : undefined}>
      {hasThinking && (
        <div style={{
          marginBottom: 6, borderRadius: 'var(--radius-md)', border: '1px solid var(--thinking-border, var(--border))',
          background: 'var(--thinking-bg, rgba(79,140,255,0.06))', overflow: 'hidden',
        }}>
          <button
            onClick={() => toggleMessageThinking(sessionIdx, msgIdx)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, width: '100%',
              padding: '5px 10px', fontSize: 'var(--text-xs)', color: "var(--fg-muted)",
              background: 'transparent', border: 'none', textAlign: 'left', minHeight: 28,
            }}
            aria-label={msg.thinkingOpen ? '收起思考过程' : '展开思考过程'}
            aria-expanded={!!msg.thinkingOpen}
          >
            <span style={{
              transform: msg.thinkingOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s', fontSize: 'var(--text-2xs)',
            }} aria-hidden="true">▶</span>
            <span aria-hidden="true">💭</span>
            <span>思考过程</span>
          </button>
          {msg.thinkingOpen && (
            <div style={{
              padding: '0 10px 8px', fontSize: 'var(--text-xs)', lineHeight: 1.6,
              color: "var(--fg-dim)", whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              borderTop: '1px solid var(--border)',
            }}>
              {msg.thinking}
            </div>
          )}
        </div>
      )}

      {toolCalls.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {toolCalls.map((tc) => (
            <ToolCallRow key={tc.id} call={tc} msgIdx={msgIdx} />
          ))}
        </div>
      )}

      {pendingApproval && (
        <ApprovalCard
          approval={pendingApproval}
          onDecide={(approved, remember) => respondApproval(msgIdx, pendingApproval.id, approved, remember)}
        />
      )}
      {approvals.filter((a) => a.resolved).map((a) => {
        const expired = a.resolved === 'expired';
        const icon = expired ? '–' : a.resolved === 'approved' ? '✓' : '✕';
        const label = expired ? '已失效' : a.resolved === 'approved' ? '已批准' : '已拒绝';
        return (
          <div
            key={a.id}
            style={{
              fontSize: 'var(--text-2xs)',
              color: expired ? 'var(--warn)' : 'var(--fg-dim)',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span aria-hidden="true">{icon}</span>
            <span>
              {label} {a.tool}
              {expired && '（任务已结束或服务端已重启）'}
            </span>
          </div>
        );
      })}
      {(!isEmpty || !chatLoading) && (
        <div style={{
          padding: '8px 12px', borderRadius: isUser ? '8px 8px 3px 8px' : isError ? '8px' : '8px 8px 8px 3px',
          fontSize: 'var(--text-base)', lineHeight: 1.6, wordBreak: 'break-word', background: bg, color: fg, border,
          animation: 'fadeIn .2s ease',
        }}>
          {isEmpty && chatLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: "var(--fg-dim)", fontSize: 'var(--text-sm)' }}>
              思考中
              <span style={{ animation: 'blink 1.2s infinite' }}>·</span>
              <span style={{ animation: 'blink 1.2s infinite', animationDelay: '.2s' }}>·</span>
              <span style={{ animation: 'blink 1.2s infinite', animationDelay: '.4s' }}>·</span>
            </div>
          ) : isUser || isError ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{contentStr}</div>
          ) : (
            <>
              <Markdown content={contentStr} />
              {isStreaming && <span className="stream-cursor" aria-hidden="true" />}
            </>
          )}
        </div>
      )}

      {/* 消息操作：复制是最常用的一个，放在气泡下方而不是挡住内容 */}
      {!isStreaming && contentStr.length > 0 && (
        <div className="msg-actions" style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
          <button
            type="button"
            className="icon-btn"
            style={{ minWidth: 26, minHeight: 26, fontSize: 'var(--text-2xs)' }}
            onClick={() => {
              navigator.clipboard?.writeText(contentStr).then(
                () => useStore.getState().showToast('已复制', 'ok'),
                () => useStore.getState().showToast('复制失败', 'error'),
              );
            }}
            aria-label="复制这条消息"
            title="复制"
          >
            <span aria-hidden="true">⧉</span>
          </button>
        </div>
      )}
    </div>
  );
}

const DANGER_COLOR: Record<string, string> = {
  low: 'var(--fg-dim)',
  medium: 'var(--warn)',
  high: 'var(--error)',
};

function ToolCallRow({ call, msgIdx }: { call: ToolCallView; msgIdx: number }) {
  const toggleToolCall = useStore((s) => s.toggleToolCall);
  const statusIcon = call.status === 'running' ? '◌' : call.status === 'ok' ? '✓' : '✕';
  const statusColor =
    call.status === 'running' ? 'var(--fg-dim)' : call.status === 'ok' ? 'var(--ok)' : 'var(--error)';
  const isMcp = call.name.startsWith('mcp__');
  const summary = summarizeInput(call.input);

  return (
    <div style={{
      borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-alt)',
      overflow: 'hidden', fontSize: 'var(--text-xs)',
    }}>
      <button
        onClick={() => toggleToolCall(msgIdx, call.id)}
        aria-expanded={!!call.open}
        aria-label={`${call.open ? '收起' : '展开'}工具调用 ${call.name}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '5px 10px', background: 'transparent', border: 'none',
          textAlign: 'left', color: 'var(--fg-muted)',
        }}
        className="touch-row"
      >
        <span
          className={call.status === 'running' ? 'tool-running' : undefined}
          style={{ color: statusColor, fontSize: 'var(--text-2xs)' }}
          aria-hidden="true"
        >
          {statusIcon}
        </span>
        <span aria-hidden="true">{isMcp ? '🔌' : '🛠'}</span>
        <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 'var(--text-xs)' }}>{call.name}</code>
        <span style={{
          flex: 1, color: 'var(--fg-dim)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{summary}</span>
        <span style={{ transform: call.open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 'var(--text-2xs)' }} aria-hidden="true">▶</span>
      </button>
      {call.open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 10px' }}>
          <div style={{ color: 'var(--fg-dim)', marginBottom: 4 }}>入参</div>
          <pre style={preStyle}>{JSON.stringify(call.input, null, 2)}</pre>
          {call.output !== undefined && (
            <>
              <div style={{ color: 'var(--fg-dim)', margin: '6px 0 4px' }}>结果</div>
              <pre style={preStyle}>{call.output}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: ApprovalView;
  onDecide: (approved: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  return (
    <div
      role="alertdialog"
      aria-label={`需要批准: ${approval.tool}`}
      style={{
        marginBottom: 6, borderRadius: 'var(--radius-md)', border: `1px solid ${DANGER_COLOR[approval.danger]}`,
        background: 'var(--bg-overlay, var(--bg-alt))', overflow: 'hidden',
      }}
    >
      <div style={{ padding: '7px 10px', fontSize: 'var(--text-xs)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span aria-hidden="true">🔐</span>
          <strong style={{ fontSize: 'var(--text-xs)' }}>需要批准</strong>
          <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 'var(--text-xs)' }}>{approval.tool}</code>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: DANGER_COLOR[approval.danger] }}>
            {approval.danger === 'high' ? '高风险' : approval.danger === 'medium' ? '中风险' : '低风险'}
          </span>
        </div>
        <div style={{ color: 'var(--fg-dim)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>{approval.reason}</div>
        <pre style={preStyle}>{JSON.stringify(approval.args, null, 2)}</pre>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderTop: '1px solid var(--border)',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)' }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ width: 14, height: 14 }}
          />
          记住选择
        </label>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn"
          onClick={() => onDecide(false, false)}
          style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
        >
          拒绝
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => onDecide(true, remember)}
        >
          批准
        </button>
      </div>
    </div>
  );
}

function summarizeInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input.slice(0, 80);
  const obj = input as Record<string, unknown>;
  for (const key of ['path', 'command', 'query', 'pattern', 'name', 'text']) {
    const v = obj[key];
    if (typeof v === 'string') return v.slice(0, 80);
  }
  try {
    return JSON.stringify(input).slice(0, 80);
  } catch {
    return '';
  }
}

const preStyle: React.CSSProperties = {
  margin: 0, padding: 6, borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-2xs)', lineHeight: 1.5,
  background: 'var(--code-bg, var(--code-bg))', color: 'var(--fg-muted)',
  overflowX: 'auto', maxHeight: 260, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.round(hour / 24)} 天前`;
}

