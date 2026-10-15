import './monaco-setup';
import React, { Component, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/* ── 轻量 ErrorBoundary ── */
interface EBProps { children: ReactNode }
interface EBState { err: Error | null }

class RootErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { err: null };
  static getDerivedStateFromError(err: Error) { return { err }; }

  render() {
    if (this.state.err) {
      return (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          background: 'var(--bg)', color: 'var(--fg)', padding: 24, textAlign: 'center',
          fontFamily: 'var(--font-sans)',
        }}>
          <div style={{ fontSize: 'var(--text-3xl)' }} aria-hidden="true">💥</div>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-lg)' }}>pocketd 发生了错误</div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--error)', maxWidth: '80%', wordBreak: 'break-all' }}>
            {this.state.err.message || this.state.err.name}
          </div>
          <code style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', maxWidth: '90%', overflow: 'auto', background: 'var(--bg-alt)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', maxHeight: 120, whiteSpace: 'pre-wrap' }}>
            {this.state.err.stack?.split('\n').slice(0, 6).join('\n')}
          </code>
          <button
            onClick={() => { localStorage.clear(); location.reload(); }}
            style={{
              fontSize: 'var(--text-sm)', padding: '6px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              background: 'var(--accent)', color: 'var(--fg-on-accent)', border: 'none', marginTop: 8,
            }}
          >
            重置 & 刷新
          </button>
          <button
            onClick={() => this.setState({ err: null })}
            style={{
              fontSize: 'var(--text-xs)', padding: '4px 12px', cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              color: 'var(--fg-muted)',
            }}
          >
            重试（继续）
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Promise 拒绝兜底处理 ── */
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
});
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.message);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);

// 生产构建才注册，否则开发环境下静态资源会被缓存住
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // 注册失败只影响离线可用，不阻塞应用启动
  });
}
