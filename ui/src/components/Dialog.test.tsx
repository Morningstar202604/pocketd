import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogHost } from './Dialog';
import { askConfirm, askPrompt, isDialogOpen } from '../lib/dialog';

/**
 * askConfirm/askPrompt 是命令式的：它们在 React 之外同步 push 状态。
 * 直接调用会让更新落在任何 act() 之外（React 19 下警告更明确），
 * 所以统一用 act 包裹「发起请求」这一步，让 React 认为这是一次受控更新。
 */
function ask<T>(fn: () => Promise<T>): Promise<T> {
  let p!: Promise<T>;
  act(() => {
    p = fn();
  });
  return p;
}

describe('Dialog 应用内对话框', () => {
  it('确认框：点确定 resolve true，点取消 resolve false', async () => {
    render(<DialogHost />);

    const first = ask(() => askConfirm({ title: '删除分支', body: '未合并的提交会丢失。', danger: true }));
    expect(await screen.findByRole('dialog', { name: '删除分支' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确定' }));
    await expect(first).resolves.toBe(true);

    const second = ask(() => askConfirm({ title: '再来一次' }));
    await screen.findByRole('dialog', { name: '再来一次' });
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await expect(second).resolves.toBe(false);
  });

  it('输入框：回车提交返回文本', async () => {
    render(<DialogHost />);

    const ok = ask(() => askPrompt({ title: '新建文件', label: '文件名', value: 'main.js', confirmText: '创建' }));
    await screen.findByRole('dialog', { name: '新建文件' });
    const input = screen.getByLabelText('文件名');
    await userEvent.clear(input);
    await userEvent.type(input, 'src/app.ts{Enter}');
    await expect(ok).resolves.toBe('src/app.ts');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Escape 取消输入', async () => {
    render(<DialogHost />);

    const cancelled = ask(() => askPrompt({ title: '分支名', label: '名称' }));
    await screen.findByRole('dialog', { name: '分支名' });
    await userEvent.type(screen.getByLabelText('名称'), 'feature/x');
    await userEvent.keyboard('{Escape}');
    await expect(cancelled).resolves.toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Escape 取消确认框', async () => {
    render(<DialogHost />);

    const cancelled = ask(() => askConfirm({ title: '危险操作', danger: true }));
    await screen.findByRole('dialog', { name: '危险操作' });
    await userEvent.keyboard('{Escape}');
    await expect(cancelled).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('输入为空时不返回空串，按取消处理', async () => {
    render(<DialogHost />);
    const result = ask(() => askPrompt({ title: '空输入', value: '   ' }));
    await screen.findByRole('dialog', { name: '空输入' });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await expect(result).resolves.toBeNull();
  });

  it('自定义按钮文案生效', async () => {
    render(<DialogHost />);
    const result = ask(() => askConfirm({ title: '批量替换', confirmText: '替换', cancelText: '再想想' }));
    await screen.findByRole('dialog', { name: '批量替换' });
    expect(screen.getByRole('button', { name: '替换' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再想想' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '再想想' }));
    await expect(result).resolves.toBe(false);
  });

  it('同一时刻只显示一个：后续请求直接按取消处理，不排队堆积', async () => {
    render(<DialogHost />);
    const first = ask(() => askConfirm({ title: '第一个' }));
    await screen.findByRole('dialog', { name: '第一个' });

    const second = ask(() => askConfirm({ title: '第二个' }));
    await expect(second).resolves.toBe(false);
    expect(screen.queryByRole('dialog', { name: '第二个' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '确定' }));
    await expect(first).resolves.toBe(true);
  });

  it('关闭后 isDialogOpen 复位', async () => {
    render(<DialogHost />);
    const p = ask(() => askConfirm({ title: '复位检查' }));
    await screen.findByRole('dialog', { name: '复位检查' });
    expect(isDialogOpen()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '确定' }));
    await p;
    await waitFor(() => expect(isDialogOpen()).toBe(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
