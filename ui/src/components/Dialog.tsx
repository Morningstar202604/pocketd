import { useEffect, useRef, useState } from 'react';
import {
  currentDialog,
  settleDialog,
  subscribeDialog,
  type DialogRequest,
  type PromptOptions,
} from '../lib/dialog';

/** 挂载一次即可（见 App.tsx）。渲染 lib/dialog.ts 排队的请求。 */
export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(currentDialog());
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeDialog((r) => {
      setReq(r);
      if (r?.kind === 'prompt') setText(r.options.value ?? '');
    });
  }, []);

  // 焦点必须落进对话框：确认框里没有可聚焦元素，不把焦点给容器的话
  // Escape/Enter 会分发给 body，键盘操作整体失效。
  useEffect(() => {
    if (!req) return;
    if (inputRef.current) inputRef.current.focus();
    else cardRef.current?.focus();
  }, [req]);

  if (!req) return null;

  const isConfirm = req.kind === 'confirm';
  const { title } = req.options;
  const body = req.kind === 'confirm' ? req.options.body : undefined;
  const danger = req.kind === 'confirm' ? req.options.danger : false;
  const cancelText = req.kind === 'confirm' ? req.options.cancelText : undefined;
  const promptOptions = req.kind === 'prompt' ? req.options : null;

  const close = (value: boolean | string | null) => {
    if (req.kind === 'confirm') req.resolve(value === true);
    else req.resolve(typeof value === 'string' ? value : null);
    settleDialog();
  };

  const submit = () => {
    if (isConfirm) close(true);
    else close(text.trim() ? text : null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(isConfirm ? false : null);
    } else if (e.key === 'Enter' && (isConfirm || !promptOptions?.multiline)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="scrim"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--z-modal)' as unknown as number,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(isConfirm ? false : null);
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{
          width: 400,
          maxWidth: '100%',
          background: 'var(--bg-alt)',
          boxShadow: 'var(--shadow)',
          borderRadius: 'var(--radius-lg)',
          animation: 'slideUp .16s ease',
          outline: 'none',
        }}
      >
        <div style={{ padding: '14px 16px 0' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>{title}</h2>
          {body && (
            <p
              style={{
                margin: '8px 0 0',
                fontSize: 'var(--text-xs)',
                color: 'var(--fg-muted)',
                lineHeight: 'var(--leading-relaxed)',
                whiteSpace: 'pre-wrap',
                maxHeight: 240,
                overflowY: 'auto',
              }}
            >
              {body}
            </p>
          )}
          {promptOptions && (
            <div style={{ marginTop: 10 }}>
              {promptOptions.label && (
                <label
                  htmlFor="pocketd-dialog-input"
                  style={{
                    display: 'block',
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--fg-muted)',
                    marginBottom: 5,
                  }}
                >
                  {promptOptions.label}
                </label>
              )}
              {promptOptions.multiline ? (
                <textarea
                  id="pocketd-dialog-input"
                  ref={inputRef as React.Ref<HTMLTextAreaElement>}
                  className="field"
                  rows={4}
                  value={text}
                  placeholder={promptOptions.placeholder}
                  onChange={(e) => setText(e.target.value)}
                  style={{ resize: 'vertical', fontFamily: 'var(--font-mono)' }}
                />
              ) : (
                <input
                  id="pocketd-dialog-input"
                  ref={inputRef as React.Ref<HTMLInputElement>}
                  className="field"
                  type="text"
                  value={text}
                  placeholder={promptOptions.placeholder}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 14 }}>
          <button type="button" className="btn" onClick={() => close(isConfirm ? false : null)}>
            {cancelText ?? '取消'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            style={danger ? { background: 'var(--error)', color: 'var(--fg-on-accent)' } : undefined}
          >
            {req.options.confirmText ?? (isConfirm ? '确定' : '保存')}
          </button>
        </div>
      </div>
    </div>
  );
}
