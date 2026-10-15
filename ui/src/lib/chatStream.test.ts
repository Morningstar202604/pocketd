import { describe, expect, it, vi } from 'vitest';
import { consumeRunStream, type RunStreamHandlers } from './chatStream';

function sse(...events: Array<{ event: string; data: unknown } | string>): Response {
  const body = events
    .map((e) =>
      typeof e === 'string'
        ? e
        : `id: 1\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`,
    )
    .join('');
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

function collector() {
  const calls: Array<[string, unknown]> = [];
  const h: RunStreamHandlers & { calls: typeof calls } = {
    calls,
    onMessage: (t) => calls.push(['message', t]),
    onThinking: (t) => calls.push(['thinking', t]),
    onToolCall: (c) => calls.push(['tool-call', c.name]),
    onToolResult: (id, out, err) => calls.push(['tool-result', { id, out, err }]),
    onApproval: (a) => calls.push(['approval', { id: a.id, tool: a.tool, danger: a.danger }]),
    onUsage: (u) => calls.push(['usage', u.totalTokens]),
    onStatus: (s) => calls.push(['status', s.status]),
    onTruncated: () => calls.push(['truncated', null]),
    onError: (m) => calls.push(['error', m]),
    onWarning: (m) => calls.push(['warning', m]),
    onAborted: (r) => calls.push(['aborted', r]),
    onStart: (i) => calls.push(['start', i.tools]),
  };
  return h;
}

describe('consumeRunStream 事件契约', () => {
  it('按顺序分发各类事件，并在 [DONE] 时返回 sawDone', async () => {
    const h = collector();
    const { sawDone } = await consumeRunStream(
      sse(
        { event: 'run-start', data: { runId: 'r1', sessionId: 's1', tools: ['bash', 'grep'] } },
        { event: 'step', data: { index: 1 } },
        { event: 'message', data: { content: '你好' } },
        { event: 'thinking', data: { content: '思考中' } },
        { event: 'tool-call', data: { id: 't1', name: 'bash', input: { command: 'ls' } } },
        { event: 'tool-result', data: { id: 't1', name: 'bash', output: 'a.txt' } },
        {
          event: 'approval-request',
          data: { id: 'a1', tool: 'bash', args: { command: 'rm x' }, danger: 'high', reason: '删除' },
        },
        { event: 'usage', data: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
        { event: 'run-finish', data: { runId: 'r1', steps: 1 } },
        'data: [DONE]\n\n',
      ),
      h,
    );

    expect(sawDone).toBe(true);
    expect(h.calls).toEqual([
      ['start', ['bash', 'grep']],
      ['message', '你好'],
      ['thinking', '思考中'],
      ['tool-call', 'bash'],
      ['tool-result', { id: 't1', out: 'a.txt', err: false }],
      ['approval', { id: 'a1', tool: 'bash', danger: 'high' }],
      ['usage', 15],
    ]);
  });

  it('流在未收到 [DONE] 时中断，sawDone 为 false（调用方据此保留 activeRun）', async () => {
    const h = collector();
    const { sawDone } = await consumeRunStream(
      sse({ event: 'message', data: { content: '半句话' } }),
      h,
    );
    expect(sawDone).toBe(false);
    expect(h.calls).toEqual([['message', '半句话']]);
  });

  it('被服务端拒绝的工具结果标记为错误态', async () => {
    const h = collector();
    await consumeRunStream(
      sse(
        { event: 'tool-result', data: { id: 't1', name: 'bash', output: '「已拒绝」用户未批准' } },
        { event: 'tool-result', data: { id: 't2', name: 'edit_file', output: '「失败」未找到' } },
        { event: 'tool-result', data: { id: 't3', name: 'read_file', output: 'ok', isError: true } },
        { event: 'tool-result', data: { id: 't4', name: 'read_file', output: '正常内容' } },
        'data: [DONE]\n\n',
      ),
      h,
    );
    expect(h.calls.map((c) => (c[1] as { err: boolean }).err)).toEqual([true, true, true, false]);
  });

  it('run-status 携带待批项，供重连后恢复审批卡片', async () => {
    const h = collector();
    await consumeRunStream(
      sse(
        {
          event: 'run-status',
          data: {
            runId: 'r1',
            status: 'running',
            lastSeq: 7,
            steps: 1,
            toolCalls: 0,
            textLength: 3,
            pendingApprovals: [
              { id: 'a1', tool: 'bash', args: {}, danger: 'high', reason: 'x' },
            ],
          },
        },
        'data: [DONE]\n\n',
      ),
      h,
    );
    expect(h.calls).toEqual([['status', 'running']]);
  });

  it('truncated 事件被单独暴露，便于客户端重建消息', async () => {
    const h = collector();
    await consumeRunStream(sse({ event: 'truncated', data: { from: 0, oldest: 900 } }), h);
    expect(h.calls).toEqual([['truncated', null]]);
  });

  it('忽略 SSE 心跳注释与坏 JSON，不影响后续事件', async () => {
    const h = collector();
    await consumeRunStream(
      new Response(': ping\n\nevent: message\ndata: {坏JSON\n\nevent: message\ndata: {"content":"好的"}\n\ndata: [DONE]\n\n'),
      h,
    );
    expect(h.calls).toEqual([['message', '好的']]);
  });

  it('error / warning / aborted 都以文本形式并入消息流', async () => {
    const h = collector();
    await consumeRunStream(
      sse(
        { event: 'error', data: { message: '上游 502' } },
        { event: 'warning', data: { message: '会话持久化失败' } },
        { event: 'aborted', data: { reason: '用户取消' } },
        'data: [DONE]\n\n',
      ),
      h,
    );
    expect(h.calls).toEqual([
      ['error', '上游 502'],
      ['warning', '会话持久化失败'],
      ['aborted', '用户取消'],
    ]);
  });

  it('分块到达的事件也能正确拼接（跨 chunk 的事件不丢）', async () => {
    const h = collector();
    const payload = 'event: message\ndata: {"content":"跨块"}\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(payload);
        // 故意在每个字节边界切分，模拟网络分片
        for (let i = 0; i < bytes.length; i += 7) {
          controller.enqueue(bytes.slice(i, i + 7));
        }
        controller.close();
      },
    });
    const { sawDone } = await consumeRunStream(new Response(stream), h);
    expect(sawDone).toBe(true);
    expect(h.calls).toEqual([['message', '跨块']]);
  });

  it('未知事件类型且带 content 时按文本处理（向前兼容）', async () => {
    const h = collector();
    await consumeRunStream(
      sse({ event: 'future-thing', data: { content: '新事件' } }, 'data: [DONE]\n\n'),
      h,
    );
    expect(h.calls).toEqual([['message', '新事件']]);
  });
});
