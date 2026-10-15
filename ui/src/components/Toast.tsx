import { useStore } from '../store';

const TOAST_STYLES: Record<string, { border: string; fg: string; icon: string; onIcon: string }> = {
  error: { border: 'var(--error)', fg: 'var(--error)', icon: '✗', onIcon: 'var(--bg)' },
  ok: { border: 'var(--success)', fg: 'var(--success)', icon: '✓', onIcon: 'var(--bg)' },
  warning: { border: 'var(--warn)', fg: 'var(--warn)', icon: '!', onIcon: 'var(--bg)' },
  info: { border: 'var(--accent)', fg: 'var(--fg)', icon: 'i', onIcon: 'var(--bg)' },
};

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;
  const isLong = toast.msg.length > 40;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(28px + var(--safe-bottom))',
        transform: 'translateX(-50%)',
        background: 'var(--bg-alt)',
        border: `1px solid ${style.border}`,
        borderLeft: `3px solid ${style.border}`,
        padding: isLong ? '9px 14px 9px 34px' : '8px 14px 8px 34px',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        lineHeight: 'var(--leading-normal)',
        zIndex: 'var(--z-toast)' as unknown as number,
        color: style.fg,
        minWidth: 140,
        maxWidth: '92vw',
        textAlign: 'left',
        boxShadow: 'var(--shadow)',
        pointerEvents: 'none',
        animation: 'slideUp .16s ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: style.border,
          color: style.onIcon,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-2xs)',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {style.icon}
      </span>
      {toast.msg}
    </div>
  );
}
