import type { ReactNode } from 'react';

/**
 * 状态提示的三件套。全应用唯一实现，替代此前 5 种各写一套的空态、
 * 5 种 loading 指示器和"失败只弹 toast 然后什么都不显示"的错误处理。
 */

const CENTER: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: 10,
  height: '100%',
  minHeight: 120,
  padding: '24px 20px',
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div style={compact ? { ...CENTER, height: 'auto', minHeight: 0, gap: 6, padding: '18px 16px' } : CENTER}>
      {icon != null && (
        <div
          aria-hidden="true"
          style={{ fontSize: 'var(--text-2xl)', lineHeight: 1, opacity: 0.45, marginBottom: 2 }}
        >
          {icon}
        </div>
      )}
      <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--fg)' }}>{title}</div>
      {description != null && (
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--fg-dim)',
            lineHeight: 'var(--leading-relaxed)',
            maxWidth: 320,
          }}
        >
          {description}
        </div>
      )}
      {action != null && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}

/**
 * 骨架屏：内容形状已知时用它占位，比转圈更接近「马上就有东西了」。
 * 宽度带一点错落，避免看起来像加载失败的灰条。
 */
export function Skeleton({ rows = 6, height = 26 }: { rows?: number; height?: number }) {
  return (
    <div
      role="status"
      aria-label="加载中"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 4px' }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height, width: `${52 + ((i * 23) % 42)}%` }}
        />
      ))}
    </div>
  );
}

export function LoadingState({ label = '加载中', compact }: { label?: string; compact?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={compact ? { ...CENTER, height: 'auto', minHeight: 0, flexDirection: 'row', gap: 8, padding: '14px 16px' } : CENTER}
    >
      <span className="spinner spinner-lg" aria-hidden="true" />
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = '出错了',
  message,
  onRetry,
  compact,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      style={compact ? { ...CENTER, height: 'auto', minHeight: 0, gap: 6, padding: '14px 16px' } : CENTER}
    >
      <div aria-hidden="true" style={{ fontSize: 'var(--text-2xl)', lineHeight: 1, opacity: 0.8, color: 'var(--error)' }}>
        ⚠
      </div>
      <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--error)' }}>{title}</div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--fg-muted)',
          lineHeight: 'var(--leading-relaxed)',
          maxWidth: 340,
          wordBreak: 'break-word',
        }}
      >
        {message}
      </div>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry} style={{ marginTop: 4 }}>
          重试
        </button>
      )}
    </div>
  );
}

/** 列表内的行级空态（比整块空态更轻，用于面板下半部分） */
export function InlineNotice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error';
  children: ReactNode;
}) {
  const color = tone === 'error' ? 'var(--error)' : tone === 'warn' ? 'var(--warn)' : 'var(--fg-dim)';
  const bg =
    tone === 'error' ? 'var(--error-soft)' : tone === 'warn' ? 'var(--warn-soft)' : 'var(--bg-overlay)';
  return (
    <div
      role={tone === 'info' ? undefined : 'status'}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        padding: '7px 10px',
        borderRadius: 'var(--radius-sm)',
        background: bg,
        color,
        fontSize: 'var(--text-xs)',
        lineHeight: 'var(--leading-normal)',
        wordBreak: 'break-word',
      }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0 }}>
        {tone === 'error' ? '⚠' : tone === 'warn' ? '!' : 'ℹ'}
      </span>
      <span>{children}</span>
    </div>
  );
}
