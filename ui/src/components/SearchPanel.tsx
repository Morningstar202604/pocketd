import { useState } from 'react';
import { useStore } from '../store';
import { askConfirm } from '../lib/dialog';
import { EmptyState, ErrorState, LoadingState } from './StateView';

export function SearchPanel() {
  const {
    searchResults, searchLoading, searchQuery, searchExt, searchScanned, searchError,
    search, replace, loadFile, showToast, toggleFilesPanel, openFiles,
  } = useStore();
  const [query, setQuery] = useState(searchQuery);
  const [ext, setExt] = useState(searchExt);
  const [replaceFrom, setReplaceFrom] = useState('');
  const [replaceTo, setReplaceTo] = useState('');
  const [showReplace, setShowReplace] = useState(false);

  const handleSearch = () => {
    search(query, ext);
  };

  const handleJump = (path: string) => {
    loadFile(path);
    showToast(`已跳转到 ${path}`, 'ok');
  };

  // 窄屏下搜索面板与编辑器互斥，跳转前把编辑器露出来
  const handleBackToEditor = () => {
    document.body.classList.toggle('hide-right-panel');
    toggleFilesPanel();
  };

  const handleReplace = async () => {
    if (!replaceFrom.trim()) return;
    try {
      // 先预览：dryRun 仅在服务端统计，不落盘
      const preview = await replace(replaceFrom, replaceTo, true, ext);
      if (preview.filesAffected === 0) {
        showToast('没有文件需要改动', 'info');
        return;
      }
      const detail = preview.changed
        .slice(0, 8)
        .map((c) => `${c.path} (${c.matches} 处)`)
        .join('\n');
      const more = preview.changed.length > 8 ? `\n…还有 ${preview.changed.length - 8} 个文件` : '';
      const ok = await askConfirm({
        title: '批量替换',
        body: `「${replaceFrom}」→「${replaceTo}」\n\n${preview.filesAffected} 个文件 / ${preview.totalMatches} 处匹配：\n${detail}${more}`,
        confirmText: '替换',
        danger: true,
      });
      if (!ok) return;
      const r = await replace(replaceFrom, replaceTo, false, ext);
      showToast(`已替换 ${r.filesAffected} 个文件 / ${r.totalMatches} 处`, 'ok');
    } catch (e: unknown) {
      showToast(`替换失败: ${(e as Error).message}`, 'error');
    }
  };

  const showNoMatch = !searchLoading && !searchError && searchResults.length === 0 && Boolean(searchQuery);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <button
        type="button"
        onClick={handleBackToEditor}
        className="mobile-only"
        style={{
          display: 'none',
          padding: '6px 12px', fontSize: 'var(--text-xs)', textAlign: 'left',
          background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)',
          color: 'var(--accent)',
        }}
        aria-label="返回编辑器"
      >
        ← 返回编辑器 {openFiles.length > 0 && `(${openFiles.length} 个打开的文件)`}
      </button>

      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-alt)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            type="search"
            className="field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="搜索文本…"
            aria-label="搜索文本"
            style={{ flex: 1, fontFamily: 'var(--font-sans)' }}
          />
          <input
            type="text"
            className="field"
            value={ext}
            onChange={(e) => setExt(e.target.value)}
            placeholder=".py"
            aria-label="文件扩展名过滤"
            style={{ width: 68 }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={handleSearch}
            aria-label="执行搜索"
            disabled={searchLoading}
            style={{ minWidth: 46 }}
          >
            {searchLoading ? <span className="spinner" aria-hidden="true" /> : '🔍'}
          </button>
        </div>

        <button
          type="button"
          className="btn-xs"
          onClick={() => setShowReplace(!showReplace)}
          aria-label={showReplace ? '隐藏替换面板' : '显示替换面板'}
          aria-expanded={showReplace}
        >
          <span aria-hidden="true">{showReplace ? '▾' : '▸'}</span> 批量替换
        </button>

        {showReplace && (
          <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
            <input
              type="text"
              className="field"
              value={replaceFrom}
              onChange={(e) => setReplaceFrom(e.target.value)}
              placeholder="查找内容"
              aria-label="替换查找内容"
              style={{ flex: 1, minWidth: 90, fontFamily: 'var(--font-sans)' }}
            />
            <span style={{ color: 'var(--fg-dim)', alignSelf: 'center' }} aria-hidden="true">→</span>
            <input
              type="text"
              className="field"
              value={replaceTo}
              onChange={(e) => setReplaceTo(e.target.value)}
              placeholder="替换为"
              aria-label="替换为内容"
              style={{ flex: 1, minWidth: 90, fontFamily: 'var(--font-sans)' }}
            />
            <button
              type="button"
              className="btn"
              onClick={handleReplace}
              disabled={!replaceFrom.trim()}
              style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
              aria-label="执行批量替换"
            >
              替换
            </button>
          </div>
        )}
      </div>

      <div role="listbox" aria-label="搜索结果" style={{ flex: 1, overflow: 'auto', padding: 6 }}>
        {searchLoading ? (
          <LoadingState label="搜索中" compact />
        ) : searchError ? (
          <ErrorState title="搜索失败" message={searchError} onRetry={handleSearch} compact />
        ) : showNoMatch ? (
          <EmptyState
            icon="🔍"
            title="没有匹配结果"
            description={
              searchScanned > 0
                ? `已扫描 ${searchScanned} 个文件`
                : '换个关键词，或清空扩展名过滤'
            }
            compact
          />
        ) : searchResults.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="全局搜索"
            description="在项目所有文本文件中查找内容，支持扩展名过滤"
            compact
          />
        ) : (
          <>
            {searchResults.map((r, i) => (
              <button
                type="button"
                key={`${r.path}:${r.line}:${i}`}
                role="option"
                aria-selected={false}
                onClick={() => handleJump(r.path)}
                className="touch-row"
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  marginBottom: 3, padding: '6px 8px',
                  background: 'var(--bg)', border: '1px solid transparent',
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                }}
                aria-label={`跳转到 ${r.path} 第 ${r.line} 行`}
              >
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', marginBottom: 2 }}>
                  <span style={{ color: 'var(--fg-dim)', marginRight: 4 }}>:{r.line}</span>
                  {r.path}
                </div>
                <div style={{
                  fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontWeight: 400,
                }}>
                  {r.text.trim().slice(0, 120)}
                </div>
              </button>
            ))}
            <div style={{
              textAlign: 'center', padding: 8, fontSize: 'var(--text-2xs)', color: 'var(--fg-dim)',
              borderTop: '1px solid var(--border)', marginTop: 6,
            }}>
              共 {searchResults.length} 个结果{searchScanned > 0 && ` · 扫描 ${searchScanned} 个文件`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
