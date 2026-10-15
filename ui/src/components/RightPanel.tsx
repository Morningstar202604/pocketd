import { useStore } from '../store';
import { ChatPanel } from './ChatPanel';
import { TerminalPanel } from './TerminalPanel';
import { GitPanel } from './GitPanel';
import { StatsPanel } from './StatsPanel';
import { KnowledgePanel } from './KnowledgePanel';
import { SearchPanel } from './SearchPanel';

const TABS = [
  { key: 'chat' as const, label: '对话', icon: '💬', ariaLabel: 'AI 对话面板' },
  { key: 'terminal' as const, label: '终端', icon: '⌨️', ariaLabel: '终端面板' },
  { key: 'git' as const, label: 'Git', icon: '📋', ariaLabel: 'Git 版本控制面板' },
  { key: 'stats' as const, label: '监控', icon: '📊', ariaLabel: '用量监控面板' },
  { key: 'knowledge' as const, label: '知识库', icon: '📚', ariaLabel: '项目知识库面板' },
  { key: 'search' as const, label: '搜索', icon: '🔍', ariaLabel: '全局搜索面板' },
];

export function RightPanel() {
  const { rightTab, setRightTab } = useStore();

  // 左右方向键在标签间移动，符合 tablist 的键盘惯例
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = (index + delta + TABS.length) % TABS.length;
    setRightTab(TABS[next].key);
    document.getElementById(`right-tab-${TABS[next].key}`)?.focus();
  };

  return (
    <aside
      className="right-panel"
      style={{
        width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--bg)', borderLeft: '1px solid var(--border)', minWidth: 0,
      }}
    >
      <div
        role="tablist"
        aria-label="右侧面板"
        style={{
          display: 'flex', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)',
          flexShrink: 0, overflowX: 'auto',
        }}
      >
        {TABS.map((t, i) => {
          const active = rightTab === t.key;
          return (
            <button
              key={t.key}
              id={`right-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`right-tabpanel-${t.key}`}
              tabIndex={active ? 0 : -1}
              aria-label={t.ariaLabel}
              onClick={() => setRightTab(t.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              style={{
                flex: 1, textAlign: 'center', padding: '8px 6px',
                fontSize: 'var(--text-xs)',
                color: active ? 'var(--fg)' : 'var(--fg-dim)',
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                transition: 'color .15s',
                minHeight: 40,
                whiteSpace: 'nowrap',
              }}
            >
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          );
        })}
      </div>

      <div
        id={`right-tabpanel-${rightTab}`}
        role="tabpanel"
        aria-label={TABS.find((t) => t.key === rightTab)?.ariaLabel}
        style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}
      >
        {rightTab === 'chat' && <ChatPanel />}
        {rightTab === 'terminal' && <TerminalPanel />}
        {rightTab === 'git' && <GitPanel />}
        {rightTab === 'stats' && <StatsPanel />}
        {rightTab === 'knowledge' && <KnowledgePanel />}
        {rightTab === 'search' && <SearchPanel />}
      </div>
    </aside>
  );
}
