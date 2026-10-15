import type React from 'react';
import { useStore } from '../store';
import { Wordmark } from './Brand';

export function TopBar() {
  const {
    apiConfig, status, statusText, theme,
    setCmdPal, setSettings, createFile, saveActive,
    toggleFilesPanel, newSession, toggleTheme, agentPolicy,
  } = useStore();

  const statusDot: Record<string, React.CSSProperties> = {
    ok: { background: 'var(--success)', boxShadow: '0 0 6px var(--success)' },
    warn: { background: 'var(--warn)' },
    error: { background: 'var(--error)' },
    loading: { background: 'var(--fg-dim)', animation: 'pulseDot 1.5s infinite' },
  };

  // 当前审批策略：这是最该随时可见的全局状态——比「保存」按钮重要得多。
  // 显示在顶栏，点击直接进设置改。
  const policyLabel = agentPolicy
    ? agentPolicy.mode === 'auto'
      ? '自动'
      : agentPolicy.mode === 'strict'
        ? '严格'
        : '标准'
    : '—';
  const policyTone =
    agentPolicy?.mode === 'auto'
      ? 'var(--warn)'
      : agentPolicy?.mode === 'strict'
        ? 'var(--success)'
        : 'var(--fg-muted)';

  return (
    <header
      className="top-bar"
      style={{
        display: 'flex', alignItems: 'center', padding: '6px 10px',
        background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)',
        gap: 4, zIndex: 20, flexShrink: 0, minWidth: 0,
      }}
    >
      {/* 窄屏：文件树开关 */}
      <button
        type="button"
        onClick={toggleFilesPanel}
        className="mobile-only icon-btn"
        style={{ display: 'none', background: 'var(--bg-overlay)' }}
        title="文件树"
        aria-label="文件管理器"
      >
        <span aria-hidden="true">📁</span>
      </button>

      <Wordmark size={15} />
      {/* 后缀是装饰性的，窄屏省下 45px */}
      <span className="wide-only" style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)', marginLeft: -4 }}>
        android
      </span>

      {/* 以下三项窄屏隐藏：都能在别处到达，顶栏不该重复张贴
          （新建文件在文件面板与底部导航、新建会话在对话头部、命令面板是桌面亲和功能） */}
      <button
        type="button"
        className="btn wide-only"
        onClick={createFile}
        aria-label="新建文件"
        style={{ border: 'none', background: 'transparent' }}
      >
        <span aria-hidden="true">＋</span> 文件
      </button>
      <button
        type="button"
        className="btn wide-only"
        onClick={newSession}
        aria-label="新建会话"
        style={{ border: 'none', background: 'transparent' }}
      >
        <span aria-hidden="true">✚</span> 会话
      </button>
      <button
        type="button"
        className="btn wide-only"
        onClick={() => setCmdPal(true)}
        aria-label="命令面板"
        style={{ border: 'none', background: 'transparent' }}
      >
        <span aria-hidden="true">⌘</span> 命令面板
        <span className="kbd-hint" style={kbdStyle}>
          ⌘K
        </span>
      </button>

      {/* 保存：编辑器没有别的保存入口，所以窄屏也保留（图标化） */}
      <button
        type="button"
        className="icon-btn"
        onClick={saveActive}
        aria-label="保存文件"
        title="保存 (⌘S)"
        style={{ background: 'transparent' }}
      >
        <span aria-hidden="true">💾</span>
      </button>

      <div style={{ flex: 1, minWidth: 8 }} />

      {/* 审批策略：随时可见，点击进设置 */}
      <button
        type="button"
        className="chip"
        onClick={() => setSettings(true)}
        title={`审批策略：${policyLabel}（点击修改）`}
        aria-label={`审批策略：${policyLabel}，点击在设置中修改`}
        style={{ color: policyTone, gap: 4 }}
      >
        <span aria-hidden="true">🔐</span>
        <span className="wide-only">{policyLabel}</span>
      </button>

      {/* 连接状态：窄屏只留圆点，文字靠 title / aria-label 承载 */}
      <div
        role="status"
        aria-live="polite"
        title={statusText}
        aria-label={`连接状态：${statusText}`}
        className="wide-only"
        style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--text-xs)',
          padding: '3px 9px', borderRadius: 'var(--radius-pill)',
          background:
            status === 'ok' ? 'var(--success-soft)'
              : status === 'error' ? 'var(--error-soft)'
                : 'var(--bg-overlay)',
          color: status === 'error' ? 'var(--error)' : 'var(--fg-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, ...(statusDot[status] || {}) }} />
        <span className="status-text">{statusText}</span>
      </div>

      {/* 模型芯片 */}
      <button
        type="button"
        data-model-chip
        onClick={() => useStore.getState().setModelDrop(true)}
        className="chip"
        style={{ maxWidth: 'min(150px, 24vw)', gap: 5 }}
        title="点击切换模型"
        aria-label={`切换 AI 模型，当前: ${apiConfig.apiModel || 'gpt-4o'}`}
      >
        <span
          style={{
            width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
            background: status === 'ok' ? 'var(--success)' : 'var(--fg-dim)',
          }}
          aria-hidden="true"
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {apiConfig.apiModel || 'gpt-4o'}
        </span>
      </button>

      {/* 主题切换：窄屏隐藏（已在设置 → 外观里），宽屏保留做快捷入口 */}
      <button
        type="button"
        className="icon-btn wide-only"
        onClick={toggleTheme}
        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}
        aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      >
        <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
      </button>

      <button
        type="button"
        className="btn-primary"
        onClick={() => setSettings(true)}
        aria-label="设置"
        title="设置"
      >
        <span aria-hidden="true">⚙</span>
        <span className="wide-only">设置</span>
      </button>
    </header>
  );
}

const kbdStyle: React.CSSProperties = {
  fontSize: 'var(--text-2xs)',
  color: 'var(--fg-muted)',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-xs)',
  padding: '0 3px',
  marginLeft: 3,
  fontFamily: 'var(--font-mono)',
};
