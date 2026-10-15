import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from './StateView';

describe('StateView 状态原语', () => {
  it('空态渲染标题、说明与操作按钮', () => {
    render(
      <EmptyState
        icon="📂"
        title="空目录"
        description="用左上角的 ＋ 新建文件"
        action={<button type="button">新建</button>}
      />,
    );
    expect(screen.getByText('空目录')).toBeInTheDocument();
    expect(screen.getByText('用左上角的 ＋ 新建文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
  });

  it('空态在无图标/说明时只渲染标题，不渲染装饰元素', () => {
    const { container } = render(<EmptyState title="没有匹配结果" />);
    expect(screen.getByText('没有匹配结果')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('加载态以 status 角色暴露给辅助技术', () => {
    render(<LoadingState label="读取目录" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('读取目录');
  });

  it('错误态以 alert 角色暴露，并提供可点击的重试', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="无法读取目录" message="路径不存在: nope" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('路径不存在: nope')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('错误态在未给 onRetry 时不渲染重试按钮', () => {
    render(<ErrorState message="出错了" />);
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('行内提示按语气区分角色与颜色', () => {
    const { rerender } = render(<InlineNotice tone="error">失败了</InlineNotice>);
    expect(screen.getByRole('status')).toHaveTextContent('失败了');

    rerender(<InlineNotice tone="info">仅告知</InlineNotice>);
    // info 是纯信息，不该触发 assertive 播报
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('仅告知')).toBeInTheDocument();
  });
});
