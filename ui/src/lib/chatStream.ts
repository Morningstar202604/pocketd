import type { ApprovalView, ToolCallView } from '../store';
import type { AgentRunSnapshot } from './api';

/**
 * 消费 agent 运行的 SSE 事件流。
 *
 * 两条路径共用这段解析：首次发起的直播，以及客户端回来后的重连回放。
 * 事件契约见 docs/ARCHITECTURE.md；这里的解析是客户端唯一实现。
 */

export interface RunStreamHandlers {
  onStart?: (info: { runId: string; sessionId: string | null; tools: string[] }) => void;
  onStep?: (index: number) => void;
  onMessage: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (call: ToolCallView) => void;
  onToolResult?: (id: string, output: string, isError: boolean) => void;
  onApproval?: (approval: ApprovalView) => void;
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  /** 运行状态快照（含待批项）。重连时一定会收到一次 */
  onStatus?: (snapshot: AgentRunSnapshot) => void;
  /** 服务端环形缓冲已丢弃请求的起点，客户端需要重建消息而不是追加 */
  onTruncated?: () => void;
  onError?: (message: string) => void;
  onWarning?: (message: string) => void;
  onAborted?: (reason: string) => void;
}

/** 逐个事件解析；返回时表示流已结束（收到 [DONE] 或连接关闭）。 */
export async function consumeRunStream(
  resp: Response,
  handlers: RunStreamHandlers,
): Promise<{ sawDone: boolean }> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      // 流结束时把残留缓冲也解析掉：最后一个事件如果没跟空行，
      // 按 SSE 规范仍应派发，否则「已完成」会被误判成「中断」
      buf += decoder.decode();
      break;
    }
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      if (raw.startsWith(':')) continue; // 心跳注释

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      const data = dataLines.join('\n');
      if (data === '[DONE]') return { sawDone: true };

      let json: Record<string, any>;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      switch (event) {
        case 'run-start':
          handlers.onStart?.({
            runId: String(json.runId ?? ''),
            sessionId: (json.sessionId as string | null) ?? null,
            tools: Array.isArray(json.tools) ? (json.tools as string[]) : [],
          });
          break;
        case 'step':
          handlers.onStep?.(Number(json.index) || 0);
          break;
        case 'message':
          if (typeof json.content === 'string') handlers.onMessage(json.content);
          break;
        case 'thinking':
          if (typeof json.content === 'string') handlers.onThinking?.(json.content);
          break;
        case 'tool-call':
          handlers.onToolCall?.({
            id: String(json.id),
            name: String(json.name),
            input: json.input,
            status: 'running',
            open: false,
          });
          break;
        case 'tool-result': {
          const output =
            typeof json.output === 'string' ? json.output : JSON.stringify(json.output);
          const denied = output.startsWith('「已拒绝」') || output.startsWith('「失败」');
          handlers.onToolResult?.(String(json.id), output, Boolean(json.isError) || denied);
          break;
        }
        case 'approval-request':
          handlers.onApproval?.({
            id: String(json.id),
            tool: String(json.tool),
            args: (json.args || {}) as Record<string, unknown>,
            danger: (json.danger || 'medium') as ApprovalView['danger'],
            reason: String(json.reason ?? ''),
          });
          break;
        case 'usage':
          handlers.onUsage?.({
            promptTokens: Number(json.promptTokens) || 0,
            completionTokens: Number(json.completionTokens) || 0,
            totalTokens: Number(json.totalTokens) || 0,
          });
          break;
        case 'run-status':
          handlers.onStatus?.(json as AgentRunSnapshot);
          break;
        case 'truncated':
          handlers.onTruncated?.();
          break;
        case 'error':
          handlers.onError?.(String(json.message ?? '上游请求失败'));
          break;
        case 'warning':
          handlers.onWarning?.(String(json.message ?? ''));
          break;
        case 'aborted':
          handlers.onAborted?.(String(json.reason ?? ''));
          break;
        default:
          if (typeof json.content === 'string') handlers.onMessage(json.content);
          break;
      }
    }
  }
  // 残留（无结尾空行）的最后一段仍按事件处理
  if (buf.trim().length > 0) {
    const last = buf.split(/\r?\n/).find((l) => l.startsWith('data:'));
    if (last && last.slice(5).trim() === '[DONE]') return { sawDone: true };
  }
  return { sawDone: false };
}
