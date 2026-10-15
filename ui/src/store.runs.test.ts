import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from './store';
import { api } from './lib/api';

vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      chatStream: vi.fn(),
      attachRun: vi.fn(),
      getRun: vi.fn(),
      cancelRun: vi.fn(),
      search: vi.fn(),
      listFiles: vi.fn(),
      getFile: vi.fn(),
      replace: vi.fn(),
      respondApproval: vi.fn(),
    },
  };
});

const chatStream = vi.mocked(api.chatStream);
const attachRun = vi.mocked(api.attachRun);
const getRun = vi.mocked(api.getRun);
const cancelRun = vi.mocked(api.cancelRun);
const respondApproval = vi.mocked(api.respondApproval);

const ACTIVE_RUN_KEY = "pocketd-active-run";

function sseResponse(body: string, runId = 'run-1'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'x-pocketd-run-id': runId },
  });
}

function resetStore() {
  localStorage.clear();
  useStore.setState({
    sessions: [{ id: 0, label: '会话 1', messages: [] }],
    curSession: 0,
    chatLoading: false,
    chatAbort: null,
    activeRun: null,
    serverHasKey: true,
    apiConfig: { apiKey: 'k', apiBase: 'http://x/v1', apiModel: 'm' },
    usage: {
      totalCalls: 0, totalTokens: 0, todayCalls: 0, todayTokens: 0,
      ctxChars: 0, maxCtxChars: 200_000, lastPromptTokens: 0, lastCompletionTokens: 0, history: [],
    },
    showToast: vi.fn(),
  } as never);
}

beforeEach(() => {
  resetStore();
  // 未显式设定的 vi.fn 返回 undefined，而调用方按 Promise 处理，会炸
  cancelRun.mockResolvedValue({ ok: true });
  respondApproval.mockResolvedValue({ ok: true });
});

describe('sendChat 与运行的存活契约', () => {
  it('正常收到 [DONE] 后清掉 activeRun（任务已结束，无需重连）', async () => {
    chatStream.mockResolvedValueOnce(
      sseResponse(
        'event: run-start\ndata: {"runId":"run-1","sessionId":"ui-0","tools":[]}\n\n' +
          'event: message\ndata: {"content":"完成"}\n\n' +
          'data: [DONE]\n\n',
      ),
    );

    await useStore.getState().sendChat('做点事');

    expect(useStore.getState().activeRun).toBeNull();
    expect(localStorage.getItem(ACTIVE_RUN_KEY)).toBeNull();
    const msgs = useStore.getState().sessions[0].messages;
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: '完成' });
  });

  it('流在未收 [DONE] 时中断 → 保留 activeRun 并提示任务仍在服务端', async () => {
    const showToast = vi.fn();
    useStore.setState({ showToast } as never);
    chatStream.mockResolvedValueOnce(
      sseResponse(
        'event: run-start\ndata: {"runId":"run-1","sessionId":"ui-0","tools":[]}\n\n' +
          'event: message\ndata: {"content":"写了一半"}\n\n' +
          'event: approval-request\ndata: {"id":"a1","tool":"bash","args":{"command":"rm -rf build"},"danger":"high","reason":"删除"}\n\n',
      ),
    );

    await useStore.getState().sendChat('删掉构建产物');

    const st = useStore.getState();
    expect(st.activeRun?.runId).toBe('run-1');
    // 必须落盘，否则刷新页面就找不回来了
    expect(JSON.parse(localStorage.getItem(ACTIVE_RUN_KEY)!).runId).toBe('run-1');
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('服务端继续'),
      'warning',
    );
    // 消息上记录了 runId，重连时按它找回这条消息
    expect(st.sessions[0].messages.at(-1)?.runId).toBe('run-1');
    // 待批的审批卡片留在界面上，用户回来还能点
    expect(st.sessions[0].messages.at(-1)?.approvals?.[0].id).toBe('a1');
  });

  it('请求直接失败时不留 activeRun（没有运行可接回）', async () => {
    chatStream.mockResolvedValueOnce(new Response('缺少 API Key', { status: 400 }));

    await useStore.getState().sendChat('你好');

    expect(useStore.getState().activeRun).toBeNull();
    expect(useStore.getState().sessions[0].messages.at(-1)?.role).toBe('error');
  });
});

describe('工具调用展开状态', () => {
  const sseWithTool = (resultOutput: string, isError = false) =>
    sseResponse(
      [
        'event: run-start',
        'data: {"runId":"run-t","tools":["bash"]}',
        '',
        'event: tool-call',
        'data: {"id":"tc-1","name":"bash","input":{"command":"ls"}}',
        '',
        'event: tool-result',
        `data: ${JSON.stringify({ id: 'tc-1', name: 'bash', output: resultOutput, ...(isError ? { isError: true } : {}) })}`,
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
      'run-t',
    );

  it('成功的工具调用保持收起（不抢位置）', async () => {
    chatStream.mockResolvedValueOnce(sseWithTool('a.txt'));
    await useStore.getState().sendChat('看一眼');
    const call = useStore.getState().sessions[0].messages.at(-1)?.toolCalls?.[0];
    expect(call?.status).toBe('ok');
    expect(call?.open).toBe(false);
  });

  it('失败的工具调用自动展开：错误必须一眼可见，不该让用户逐个点开去找', async () => {
    chatStream.mockResolvedValueOnce(sseWithTool('「失败」未找到目标', true));
    await useStore.getState().sendChat('改一下');
    const call = useStore.getState().sessions[0].messages.at(-1)?.toolCalls?.[0];
    expect(call?.status).toBe('error');
    expect(call?.open).toBe(true);
  });

  it('被拒绝的工具调用也算错误态，同样自动展开', async () => {
    chatStream.mockResolvedValueOnce(sseWithTool('「已拒绝」用户未批准: 删除文件'));
    await useStore.getState().sendChat('删掉它');
    const call = useStore.getState().sessions[0].messages.at(-1)?.toolCalls?.[0];
    expect(call?.status).toBe('error');
    expect(call?.open).toBe(true);
  });
});

describe('页面卸载时的断连（真实浏览器行为）', () => {
  it('中途抛 Failed to fetch（不是 AbortError）也必须保留 activeRun', async () => {
    // 真实事故：浏览器卸载页面时中断 fetch，抛的是 TypeError: Failed to fetch。
    // 旧代码把它当成运行失败，顺手清掉恢复标记，导致「服务端还在跑但用户永远
    // 看不到结果」——而且是在最需要这个标记的时候把它销毁。
    useStore.setState({ showToast: vi.fn() } as never);
    chatStream.mockImplementationOnce(async () => {
      // 先返回一个正常响应头，让客户端记录 runId，然后流读取时抛错
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              ['event: run-start', 'data: {"runId":"run-x","tools":[]}', '', ''].join('\n'),
            ),
          );
          controller.error(new TypeError('Failed to fetch'));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'x-pocketd-run-id': 'run-x' },
      });
    });

    await useStore.getState().sendChat('干活');

    const st = useStore.getState();
    expect(st.activeRun?.runId).toBe('run-x');
    expect(localStorage.getItem(ACTIVE_RUN_KEY)).not.toBeNull();
    // 不该把断连渲染成对话里的错误气泡
    expect(st.sessions[0].messages.some((m) => m.role === 'error')).toBe(false);
  });

  it('请求被服务端拒绝（未拿到 runId）时才写入错误并清标记', async () => {
    useStore.setState({ showToast: vi.fn() } as never);
    chatStream.mockResolvedValueOnce(new Response('服务端 500', { status: 500 }));

    await useStore.getState().sendChat('干活');

    const st = useStore.getState();
    expect(st.activeRun).toBeNull();
    expect(st.sessions[0].messages.at(-1)?.role).toBe('error');
  });
});

describe('attachActiveRun 断连重连', () => {
  it('从 seq 0 重建消息，不追加（避免与旧状态漂移）', async () => {
    // 先制造一个"半成品"消息，模拟断连时界面上的残留
    useStore.setState({
      sessions: [
        {
          id: 0,
          label: '会话 1',
          messages: [
            { role: 'user', content: '删掉构建产物' },
            {
              role: 'assistant',
              content: '写了一半',
              runId: 'run-1',
              toolCalls: [{ id: 'old', name: 'stale', input: {}, status: 'running' }],
            },
          ],
        },
      ],
      activeRun: { runId: 'run-1', sessionIdx: 0, lastSeq: 3 },
    } as never);
    useStore.setState({ showToast: vi.fn() } as never);

    getRun.mockResolvedValueOnce({
      events: [],
      truncated: false,
      snapshot: {
        runId: 'run-1', status: 'running', createdAt: 0, updatedAt: 0, eventCount: 5,
        lastSeq: 5, steps: 2, toolCalls: 1, textLength: 20, pendingApprovals: [],
      },
    });

    attachRun.mockResolvedValueOnce(
      sseResponse(
        'event: run-start\ndata: {"runId":"run-1","sessionId":"ui-0","tools":[]}\n\n' +
          'event: message\ndata: {"content":"完整"}\n\n' +
          'event: message\ndata: {"content":"结果"}\n\n' +
          'data: [DONE]\n\n',
      ),
    );

    await useStore.getState().attachActiveRun();

    const msg = useStore.getState().sessions[0].messages.at(-1)!;
    expect(msg.content).toBe('完整结果');
    // 重建：旧的 stale 工具调用必须被清掉
    expect(msg.toolCalls).toEqual([]);
    expect(useStore.getState().sessions[0].messages).toHaveLength(2);
    // 接回用的是全量回放
    expect(attachRun).toHaveBeenCalledWith('run-1', 0, expect.anything());
    // 结束后清掉 activeRun
    expect(useStore.getState().activeRun).toBeNull();
  });

  it('运行没有对应消息时新建一条，而不是污染别的消息', async () => {
    useStore.setState({ activeRun: { runId: 'run-9', sessionIdx: 0, lastSeq: 0 } } as never);
    useStore.setState({ showToast: vi.fn() } as never);

    getRun.mockResolvedValueOnce({
      events: [],
      truncated: false,
      snapshot: {
        runId: 'run-9', status: 'running', createdAt: 0, updatedAt: 0, eventCount: 1,
        lastSeq: 1, steps: 1, toolCalls: 0, textLength: 0, pendingApprovals: [],
      },
    });
    attachRun.mockResolvedValueOnce(
      sseResponse('event: message\ndata: {"content":"结果"}\n\ndata: [DONE]\n\n', 'run-9'),
    );

    await useStore.getState().attachActiveRun();

    const msgs = useStore.getState().sessions[0].messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: 'assistant', content: '结果', runId: 'run-9' });
  });

  it('运行已被服务端回收（404）时放弃，并明确告知用户而不是静默消失', async () => {
    useStore.setState({ activeRun: { runId: 'gone', sessionIdx: 0, lastSeq: 0 } } as never);
    const showToast = vi.fn();
    useStore.setState({ showToast } as never);
    getRun.mockRejectedValueOnce(new Error('404'));

    await useStore.getState().attachActiveRun();

    expect(useStore.getState().activeRun).toBeNull();
    expect(useStore.getState().sessions[0].messages).toHaveLength(0);
    // 「任务莫名消失」比报错更糟，所以这里必须有提示
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('无法接回上次的任务'),
      'warning',
    );
  });

  it('运行在页面关闭期间完成：重开后回放一次并展示结果', async () => {
    useStore.setState({
      sessions: [{ id: 0, label: '会话 1', messages: [{ role: 'user', content: '做点事' }] }],
      activeRun: { runId: 'run-1', sessionIdx: 0, lastSeq: 4 },
    } as never);
    useStore.setState({ showToast: vi.fn() } as never);

    getRun.mockResolvedValueOnce({
      events: [],
      truncated: false,
      snapshot: {
        runId: 'run-1', status: 'done', createdAt: 0, updatedAt: 0, eventCount: 9,
        lastSeq: 9, steps: 2, toolCalls: 1, textLength: 10, pendingApprovals: [],
      },
    });
    attachRun.mockResolvedValueOnce(
      sseResponse(
        [
          'event: message',
          'data: {"content":"任务已完成"}',
          '',
          'event: run-finish',
          'data: {"runId":"run-1","steps":2}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      ),
    );

    await useStore.getState().attachActiveRun();

    // 关页期间跑完的任务，重开后必须能看到结果
    expect(useStore.getState().sessions[0].messages.at(-1)?.content).toBe('任务已完成');
    // 拿到结果就注销，避免每次加载都白跑一次查询
    expect(useStore.getState().activeRun).toBeNull();
  });
});

describe('stopChat 取消是运行级的', () => {
  it('即使连接已断，也向服务端发出取消', async () => {
    useStore.setState({ activeRun: { runId: 'run-1', sessionIdx: 0, lastSeq: 2 } } as never);
    cancelRun.mockResolvedValueOnce({ ok: true });

    useStore.getState().stopChat();

    expect(cancelRun).toHaveBeenCalledWith('run-1');
    expect(useStore.getState().activeRun).toBeNull();
    expect(useStore.getState().chatLoading).toBe(false);
  });

  it('没有活动运行时点停止不会报错', () => {
    expect(() => useStore.getState().stopChat()).not.toThrow();
    expect(cancelRun).not.toHaveBeenCalled();
  });
});

describe('接回流使用服务端的真实形状', () => {
  it('回放含 run-status 与心跳注释时，仍保持连接并保留 activeRun', async () => {
    useStore.setState({
      sessions: [
        {
          id: 0,
          label: '会话 1',
          messages: [
            { role: 'user', content: '做点事' },
            { role: 'assistant', content: '', runId: 'run-r', toolCalls: [], approvals: [] },
          ],
        },
      ],
      activeRun: { runId: 'run-r', sessionIdx: 0, lastSeq: -1 },
    } as never);
    useStore.setState({ showToast: vi.fn() } as never);

    getRun.mockResolvedValueOnce({
      events: [],
      truncated: false,
      snapshot: {
        runId: 'run-r', status: 'running', createdAt: 0, updatedAt: 0, eventCount: 9,
        lastSeq: 8, steps: 2, toolCalls: 1, textLength: 27, sessionId: 'ui-0',
        pendingApprovals: [
          { id: 'ap-1', tool: 'bash', args: { command: 'cat x' }, danger: 'medium', reason: '执行 shell 命令' },
        ],
      },
    });

    // 服务端真实发出的字节序列：事件 + 心跳注释 + 仍在运行时流不关闭
    const serverShaped = [
      'id: 0',
      'event: run-start',
      'data: {"runId":"run-r","sessionId":"ui-0","tools":["bash"]}',
      '',
      'id: 1',
      'event: step',
      'data: {"index":1}',
      '',
      'id: 4',
      'event: tool-call',
      'data: {"id":"tc-1","name":"bash","input":{"command":"cat x"}}',
      '',
      'id: 5',
      'event: approval-request',
      'data: {"id":"ap-1","tool":"bash","args":{"command":"cat x"},"danger":"medium","reason":"执行 shell 命令"}',
      '',
      'id: 9',
      'event: run-status',
      'data: {"runId":"run-r","status":"running","lastSeq":8,"steps":2,"toolCalls":1,"textLength":27,"pendingApprovals":[{"id":"ap-1","tool":"bash","args":{"command":"cat x"},"danger":"medium","reason":"执行 shell 命令"}]}',
      '',
      ': ping',
      '',
    ].join('\n');

    // 流不关闭（模拟等审批中的真实状态），用可取消的 ReadableStream
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(serverShaped));
      },
      cancel() {
        cancelled = true;
      },
    });
    attachRun.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'x-pocketd-run-id': 'run-r' } }),
    );

    const attachPromise = useStore.getState().attachActiveRun();
    // 给回放处理留出时间
    await new Promise((r) => setTimeout(r, 300));

    const st = useStore.getState();
    // 运行还在跑：客户端必须仍然持有 activeRun，否则以后的输出全收不到
    expect(st.activeRun?.runId).toBe('run-r');
    // 待批卡片必须渲染出来
    const msg = st.sessions[0].messages.at(-1)!;
    expect(msg.approvals?.some((a) => a.id === 'ap-1' && !a.resolved)).toBe(true);
    // 回放的工具调用也在
    expect(msg.toolCalls?.some((t) => t.id === 'tc-1')).toBe(true);
    expect(cancelled).toBe(false);

    // 清理：取消这次接回。注意不能 await attachPromise —— 流在运行结束前
    // 一直开着（这正是设计目标），那个 promise 本就不该 settle。
    useStore.getState().stopChat();
    void attachPromise;
  });
});
