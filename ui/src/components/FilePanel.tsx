import { useStore } from '../store';
import { EmptyState, ErrorState, Skeleton } from './StateView';

const FILE_ICONS: Record<string, string> = {
  js: '🟨', mjs: '🟨', cjs: '🟨', ts: '🔷', jsx: '🟨', tsx: '🔷',
  json: '📋', md: '📝', py: '🐍', go: '🔵', rs: '🦀',
  java: '☕', cpp: '⚙️', c: '⚙️', rb: '💎', zip: '📦',
  html: '🌐', css: '🎨', sh: '💻', sql: '🗃️', yaml: '📝',
  yml: '📝', xml: '📝', toml: '📝',
};

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '📄';
}

export function FilePanel() {
  const {
    files, curPath, filesLoading, filesError, loadFiles, loadFile,
    createFile, fileFilter, setFileFilter, filesPanelOpen, toggleFilesPanel,
    showHidden, toggleShowHidden,
  } = useStore();

  // 窄屏下文件树是覆盖式抽屉，选中文件后自动收起以露出编辑器
  const closeDrawerOnMobile = () => {
    if (window.innerWidth <= 768 && filesPanelOpen) toggleFilesPanel();
  };

  const filteredFiles = fileFilter
    ? files.filter((f) => f.name.toLowerCase().includes(fileFilter.toLowerCase()))
    : files;

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  // 窄屏下文件树是覆盖式抽屉：给它一个遮罩，点空白处即关闭。
  // 之前只能再点一次顶栏开关，在手机上是多余的一次精确点击。
  const isOverlay = () =>
    typeof window !== 'undefined' && window.innerWidth <= 768 && filesPanelOpen;

  return (
    <>
      {isOverlay() && (
        <div
          className="drawer-scrim"
          onClick={toggleFilesPanel}
          aria-hidden="true"
        />
      )}
    <aside className={filesPanelOpen ? 'file-panel is-open' : 'file-panel'} style={{
      width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-alt)', borderRight: '1px solid var(--border)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', padding: '5px 8px',
        borderBottom: '1px solid var(--border)', gap: 2,
      }}>
        <span style={{ flex: 1, fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '.02em' }}>
          文件
        </span>
        <button type="button" className="icon-btn" onClick={createFile} aria-label="新建文件" title="新建文件">
          <span aria-hidden="true">＋</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={toggleShowHidden}
          aria-label={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}
          aria-pressed={showHidden}
          title={showHidden ? '隐藏以点开头的文件' : '显示以点开头的文件（.gitignore 等）'}
          style={{ color: showHidden ? 'var(--accent)' : undefined }}
        >
          <span aria-hidden="true">{showHidden ? '◉' : '◎'}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => loadFiles(curPath)}
          aria-label="刷新文件列表"
          title="刷新"
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
        <input
          type="search"
          className="field"
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
          placeholder="搜索文件…"
          aria-label="搜索文件"
          style={{ fontFamily: 'var(--font-sans)' }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px', userSelect: 'none' }}>
        {/* 返回上级在空目录/加载中/出错时都要在，否则用户会被困在空目录里 */}
        {curPath !== '.' && (
          <button
            type="button"
            className="row-btn touch-row"
            onClick={() => {
              const parent = curPath.split('/').slice(0, -1).join('/') || '.';
              loadFiles(parent);
            }}
            style={{ color: 'var(--accent)' }}
          >
            <span aria-hidden="true">↰</span>
            <span>返回上级</span>
          </button>
        )}
        {filesLoading && files.length === 0 ? (
          <Skeleton rows={8} />
        ) : filesError ? (
          <ErrorState
            title="无法读取目录"
            message={filesError}
            onRetry={() => loadFiles(curPath)}
            compact
          />
        ) : sortedFiles.length === 0 ? (
          <EmptyState
            icon={fileFilter ? '🔍' : '📂'}
            title={fileFilter ? '没有匹配的文件' : '空目录'}
            description={fileFilter ? `「${fileFilter}」没有匹配项` : '用左上角的 ＋ 新建文件'}
            compact
          />
        ) : (
          sortedFiles.map((item) => {
            const isDir = item.type === 'directory';
            return (
              <button
                type="button"
                key={item.path}
                className="row-btn touch-row file-item"
                onClick={() => {
                  if (isDir) {
                    loadFiles(item.path);
                  } else {
                    loadFile(item.path);
                    closeDrawerOnMobile();
                  }
                }}
                title={
                  item.ignored
                    ? `${item.path}\n命中忽略规则：仍可打开，但搜索与 @ 候选不会收录`
                    : item.path
                }
                style={{ borderLeft: '2px solid transparent' }}
              >
                <span aria-hidden="true" style={{ flexShrink: 0 }}>
                  {isDir ? '📁' : fileIcon(item.name)}
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: item.ignored ? 0.55 : 1,
                  }}
                >
                  {item.name}
                </span>
                {item.ignored ? (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 'var(--text-2xs)',
                      color: 'var(--fg-dim)',
                      flexShrink: 0,
                    }}
                    title="命中 .gitignore / .pocketdignore"
                  >
                    忽略
                  </span>
                ) : (
                  !isDir &&
                  item.size != null && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 'var(--text-2xs)',
                        color: 'var(--fg-dim)',
                        flexShrink: 0,
                      }}
                    >
                      {formatSize(item.size)}
                    </span>
                  )
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}
