import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '../store';
import { ChatPanel } from './ChatPanel';
import { api } from '../lib/api';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      respondApproval: vi.fn().mockResolvedValue({ ok: true }),
      getPolicy: vi.fn().mockResolvedValue({ mode: 'edits', alwaysAllow: [], pendingApprovals: 0 }),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      mcpList: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue({ apiKey: '***', apiBase: 'x', apiModel: 'test-model' }),
    },
  };
});

const APPROVAL = {
  id: 'apr-1',
  tool: 'bash',
  args: { command: 'rm -rf build' },
  danger: 'high' as const,
  reason: '删除或移动文件',
};

function seedWithApproval() {
  useStore.setState({
    sessions: [
      {
        id: 0,
        label: '会话 1',
        messages: [
          { role: 'user', content: '清一下构建产物' },
          {
            role: 'assistant',
            content: '好的，我来删除。',
            toolCalls: [
              { id: 'tc-1', name: 'bash', input: { command: 'rm -rf build' }, status: 'running' as const },
            ],
            approvals: [APPROVAL],
          },
        ],
      },
    ],
    curSession: 0,
    chatLoading: true,
    apiConfig: { apiKey: '', apiBase: 'http://x/v1', apiModel: 'test-model' },
    agentPolicy: null,
  } as never);
}

describe('流式滚动契约', () => {
  /** jsdom 不会真的滚动，所以断言的是「有没有命令它滚」——这恰好就是契约本身 */
  function fakeScrollGeometry(log: HTMLElement, { height, client, top }: { height: number; client: number; top: number }) {
    Object.defineProperty(log, 'scrollHeight', { value: height, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: client, configurable: true });
    log.scrollTop = top;
  }

  it('用户往上翻时，新输出不抢走滚动位置', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    seedWithApproval();
    render(<ChatPanel />);
    const log = screen.getByRole('log') as HTMLElement;

    // 内容比视口高，且用户已经翻到中间
    fakeScrollGeometry(log, { height: 1000, client: 300, top: 0 });
    act(() => {
      log.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /回到底部/ })).toBeInTheDocument());
    scrollTo.mockClear();

    // 新消息到达：不应把它拉回底部
    act(() => {
      useStore.setState((s) => ({
        sessions: s.sessions.map((x, i) =>
          i === 0 ? { ...x, messages: [...x.messages, { role: 'assistant' as const, content: '新内容' }] } : x,
        ),
      }) as never);
    });
    await waitFor(() => expect(screen.getByText('新内容')).toBeInTheDocument());

    expect(scrollTo).not.toHaveBeenCalled();
    // 并且提示「有新的输出」
    expect(screen.getByRole('button', { name: /有新的输出/ })).toBeInTheDocument();
    scrollTo.mockRestore();
  });

  it('本来就贴底时才跟随，并且不显示回到底部', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    seedWithApproval();
    render(<ChatPanel />);
    const log = screen.getByRole('log') as HTMLElement;

    fakeScrollGeometry(log, { height: 1000, client: 300, top: 700 });
    act(() => {
      log.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /回到底部/ })).toBeNull());
    scrollTo.mockClear();

    act(() => {
      useStore.setState((s) => ({
        sessions: s.sessions.map((x, i) =>
          i === 0 ? { ...x, messages: [...x.messages, { role: 'assistant' as const, content: '继续输出' }] } : x,
        ),
      }) as never);
    });
    await waitFor(() => expect(screen.getByText('继续输出')).toBeInTheDocument());

    expect(scrollTo).toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it('点「回到底部」会滚到底并收起按钮', async () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    seedWithApproval();
    render(<ChatPanel />);
    const log = screen.getByRole('log') as HTMLElement;

    fakeScrollGeometry(log, { height: 1000, client: 300, top: 0 });
    act(() => {
      log.dispatchEvent(new Event('scroll'));
    });
    const btn = await screen.findByRole('button', { name: /回到底部/ });
    scrollTo.mockClear();

    await userEvent.click(btn);

    expect(scrollTo).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: /回到底部/ })).toBeNull());
    scrollTo.mockRestore();
  });
});

describe('ChatPanel 工具调用与审批', () => {
  beforeEach(() => {
    seedWithApproval();
  });

  it('渲染工具调用卡片，并显示工具名与关键入参', () => {
    render(<ChatPanel />);
    expect(screen.getByRole('button', { name: /展开工具调用 bash/ })).toBeInTheDocument();
    expect(screen.getByText('rm -rf build')).toBeInTheDocument();
  });

  it('待批准的工具以 alertdialog 呈现，含风险等级与原因', () => {
    render(<ChatPanel />);
    const dialog = screen.getByRole('alertdialog', { name: '需要批准: bash' });
    expect(dialog).toHaveTextContent('高风险');
    expect(dialog).toHaveTextContent('删除或移动文件');
  });

  it('点批准 → 调用 respondApproval(id, true) 并把卡片标记为已批准', async () => {
    render(<ChatPanel />);
    await userEvent.click(screen.getByRole('button', { name: '批准' }));

    await waitFor(() =>
      expect(vi.mocked(api.respondApproval)).toHaveBeenCalledWith('apr-1', true, false),
    );
    await waitFor(() => expect(screen.getByText(/已批准 bash/)).toBeInTheDocument());
  });

  it('点拒绝 → 调用 respondApproval(id, false)，且不勾选记住时 remember 为 false', async () => {
    render(<ChatPanel />);
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }));

    await waitFor(() =>
      expect(vi.mocked(api.respondApproval)).toHaveBeenCalledWith('apr-1', false, false),
    );
    await waitFor(() => expect(screen.getByText(/已拒绝 bash/)).toBeInTheDocument());
  });

  it('勾选「记住选择」后批准会把 remember 传为 true', async () => {
    render(<ChatPanel />);
    await userEvent.click(screen.getByRole('checkbox', { name: '记住选择' }));
    await userEvent.click(screen.getByRole('button', { name: '批准' }));

    await waitFor(() =>
      expect(vi.mocked(api.respondApproval)).toHaveBeenCalledWith('apr-1', true, true),
    );
  });

  it('展开工具调用后显示入参 JSON', async () => {
    render(<ChatPanel />);
    await userEvent.click(screen.getByRole('button', { name: /展开工具调用 bash/ }));

    expect(screen.getByRole('button', { name: /收起工具调用 bash/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // 入参同时出现在工具卡片与审批卡片里，所以按「至少一处」断言
    expect(screen.getAllByText(/"command": "rm -rf build"/).length).toBeGreaterThan(0);
  });

  it('已解决的审批不再显示为待批（避免重复点击）', async () => {
    render(<ChatPanel />);
    await userEvent.click(screen.getByRole('button', { name: '批准' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});
