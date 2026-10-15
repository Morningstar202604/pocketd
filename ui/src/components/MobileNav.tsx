import { useStore, RightTab } from '../store';

const NAV_ITEMS: { key: RightTab | 'newfile' | 'editor'; label: string; icon: string; ariaLabel: string }[] = [
  { key: 'editor', label: '代码', icon: '📝', ariaLabel: '编辑器' },
  { key: 'chat', label: '对话', icon: '💬', ariaLabel: 'AI 对话' },
  { key: 'terminal', label: '终端', icon: '⌨️', ariaLabel: '终端' },
  { key: 'git', label: 'Git', icon: '📋', ariaLabel: 'Git 版本控制' },
  { key: 'stats', label: '监控', icon: '📊', ariaLabel: '用量监控' },
  { key: 'knowledge', label: '知识库', icon: '📚', ariaLabel: '项目知识库' },
  { key: 'newfile', label: '新建', icon: '＋', ariaLabel: '新建文件' },
];

export function MobileNav() {
  const { rightTab, setRightTab, createFile, mobileView, setMobileView } = useStore();

  const handleNav = (key: string) => {
    if (key === 'newfile') {
      createFile();
      return;
    }
    if (key === 'editor') {
      setMobileView('editor');
      return;
    }
    setRightTab(key as RightTab);
  };

  const isActive = (key: string) =>
    key === 'editor' ? mobileView === 'editor' : mobileView === 'panel' && rightTab === key;

  return (
    <nav
      className="mobile-nav"
      style={{
        display: 'none',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-alt)',
        // 底部安全区由 #root 的 padding 统一承担，这里不再叠加
        paddingTop: 2,
        flexShrink: 0,
      }}
      aria-label="主导航"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(item.key);
        const isNew = item.key === 'newfile';
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => handleNav(item.key)}
            style={{
              flex: 1,
              minHeight: 56,
              minWidth: 44,
              padding: '6px 2px 5px',
              fontSize: 'var(--text-2xs)',
              background: active ? 'var(--accent-soft)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              color: active ? 'var(--accent)' : isNew ? 'var(--success)' : 'var(--fg-muted)',
            }}
            aria-label={item.ariaLabel}
            aria-pressed={active}
          >
            <span aria-hidden="true" style={{ fontSize: 'var(--text-lg)' }}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
