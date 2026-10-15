/**
 * 命令式对话框 API（应用内弹窗，替代原生 confirm() / prompt()）。
 *
 *   if (!(await askConfirm({ title: '删除分支?', danger: true }))) return;
 *   const name = await askPrompt({ title: '新建分支', label: '分支名' });
 *
 * 渲染由 components/Dialog.tsx 的 <DialogHost /> 承担；本模块只维护请求队列，
 * 因此 store 可以调用它而不产生对组件层的依赖。
 */

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmText?: string;
  multiline?: boolean;
}

export type DialogRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void };

let pending: DialogRequest | null = null;
const listeners = new Set<(r: DialogRequest | null) => void>();

function emit() {
  for (const l of listeners) l(pending);
}

export function subscribeDialog(listener: (r: DialogRequest | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentDialog(): DialogRequest | null {
  return pending;
}

export function isDialogOpen(): boolean {
  return pending !== null;
}

function enqueue(req: DialogRequest) {
  // 没有 Host 挂载时没人能应答，直接按取消处理，避免调用方永久 await
  if (listeners.size === 0) {
    if (req.kind === 'confirm') req.resolve(false);
    else req.resolve(null);
    return;
  }
  if (pending) {
    // 同一时刻只显示一个；后来的请求按取消处理，避免队列堆积
    if (req.kind === 'confirm') req.resolve(false);
    else req.resolve(null);
    return;
  }
  pending = req;
  emit();
}

export function settleDialog(): void {
  pending = null;
  emit();
}

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => enqueue({ kind: 'confirm', options, resolve }));
}

export function askPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: 'prompt', options, resolve }));
}
