import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../store';
import { fileKind, previewUrl, rawFileUrl } from '../lib/fileKind';
import { COMMANDS } from '../lib/presets';

export function CommandPalette() {
  const { cmdPalOpen, setCmdPal, showToast } = useStore();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => {
    const dyn = [
      { id: 'save', label: '保存文件', kbd: '⌘S' },
      { id: 'new-file', label: '新建文件', kbd: '⌘N' },
      { id: 'settings', label: '打开设置', kbd: '⌘,' },
      { id: 'toggle-files', label: '切换文件树', kbd: '⌘B' },
      { id: 'terminal', label: '切换到终端面板', kbd: '⌘J' },
      { id: 'git-panel', label: 'Git 面板', kbd: '⌘G' },
      { id: 'stats-panel', label: '用量监控', kbd: '' },
      { id: 'knowledge-panel', label: '项目知识库', kbd: '' },
      { id: 'knowledge-generate', label: '生成知识库', kbd: '' },
      { id: 'refresh', label: '刷新文件列表', kbd: '⌘R' },
      { id: 'clear-chat', label: '清空对话', kbd: '' },
      { id: 'new-session', label: '新建会话', kbd: '⌘T' },
      { id: 'toggle-theme', label: '切换深浅主题', kbd: '' },
      { id: 'mcp-toggle', label: '打开 MCP 配置', kbd: '' },
      { id: 'mcp-reload', label: '刷新 MCP 服务器连接', kbd: '' },
      { id: 'search-panel', label: '全局搜索 / 替换', kbd: '⌘⇧F' },
      { id: 'preview-workspace', label: '在浏览器中预览工作区', kbd: '' },
      { id: 'preview-file', label: '在新标签页打开当前文件', kbd: '' },
    ];
    return Array.from(new Set([...COMMANDS.map((c) => c.id), ...dyn.map((c) => c.id)])).map((id) =>
      dyn.find((c) => c.id === id) || COMMANDS.find((c) => c.id === id)!,
    );
  }, []);

  const filtered = useMemo(() => {
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((c) => c.label.toLowerCase().includes(q) || c.id.includes(q));
  }, [query, all]);

  useEffect(() => {
    if (cmdPalOpen) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [cmdPalOpen]);

  useEffect(() => {
    const el = listRef.current?.querySelector('.cmd-active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!cmdPalOpen) return null;

  const run = (id: string) => {
    setCmdPal(false);
    const S = useStore.getState();
    switch (id) {
      case 'save': S.saveActive(); break;
      case 'new-file': S.createFile(); break;
      case 'settings': S.setSettings(true); break;
      case 'toggle-files': S.toggleFilesPanel(); break;
      case 'terminal': S.setRightTab('terminal'); break;
      case 'git-panel': S.setRightTab('git'); break;
      case 'git-status': S.setRightTab('git'); break;
      case 'git-commit': S.setRightTab('git'); break;
      case 'stats-panel': S.setRightTab('stats'); break;
      case 'knowledge-panel': S.setRightTab('knowledge'); break;
      case 'knowledge-generate': S.generateKnowledge(); break;
      case 'refresh': S.loadFiles(); S.showToast('已刷新', 'ok'); break;
      case 'clear-chat': S.clearChat(); break;
      case 'new-session': S.newSession(); break;
      case 'toggle-theme': S.toggleTheme(); S.showToast(S.theme === 'dark' ? '已切深色' : '已切浅色', 'ok'); break;
      case 'mcp-toggle': S.setSettings(true); break;
      case 'mcp-reload': S.reloadMcpServers(); break;
      case 'search-panel': S.setRightTab('search'); break;
      case 'preview-workspace':
        window.open(previewUrl(), '_blank', 'noopener');
        break;
      case 'preview-file': {
        const cur = S.openFiles.find((f) => f.path === S.activeFile);
        if (!cur) {
          S.showToast('先打开一个文件', 'info');
          break;
        }
        const k = fileKind(cur.path);
        window.open(
          k === 'image' ? rawFileUrl(cur.path) : previewUrl(cur.path),
          '_blank',
          'noopener',
        );
        break;
      }
      default: break;
    }
  };

  const listId = 'cmd-palette-list';

  return (
    <div className="command-palette" style={pal} role="dialog" aria-modal="true" aria-label="命令面板">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && filtered[activeIdx]) run(filtered[activeIdx].id);
          if (e.key === 'Escape') setCmdPal(false);
        }}
        placeholder="输入命令..."
        aria-label="命令搜索"
        role="combobox"
        aria-expanded={filtered.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={filtered[activeIdx] ? `cmd-opt-${filtered[activeIdx].id}` : undefined}
        style={{
          background: "var(--bg)", color: "var(--fg)", border: 'none', borderBottom: "1px solid var(--border)",
          padding: '10px 12px', fontSize: 'var(--text-base)', outline: 'none',
        }}
      />
      <div ref={listRef} id={listId} role="listbox" aria-label="命令列表" style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {filtered.length === 0 && (
          <div role="option" aria-selected="false" style={{ textAlign: 'center', padding: 20, color: "var(--fg-dim)", fontSize: 'var(--text-sm)' }}>无匹配命令</div>
        )}
        {filtered.map((c, i) => (
          <div
            key={c.id}
            id={`cmd-opt-${c.id}`}
            className={`touch-row${i === activeIdx ? ' cmd-active' : ''}`}
            role="option"
            aria-selected={i === activeIdx}
            onClick={() => run(c.id)}
            onMouseEnter={() => setActiveIdx(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
              cursor: 'pointer', fontSize: 'var(--text-sm)', borderLeft: '2px solid transparent',
              minHeight: 32,
              background: i === activeIdx ? 'var(--bg-hover)' : 'transparent',
              borderLeftColor: i === activeIdx ? 'var(--accent)' : 'transparent',
            }}
          >
            <span style={{ flex: 1 }}>{c.label}</span>
            {c.kbd && (
              <span aria-hidden="true" style={{
                fontSize: 'var(--text-2xs)', color: "var(--fg-dim)", background: "var(--bg-overlay)",
                border: "1px solid var(--border)", borderRadius: 'var(--radius-xs)', padding: '0 4px',
              }}>
                {c.kbd}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const pal: React.CSSProperties = {
  position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)',
  width: 480, maxWidth: '95vw', maxHeight: '60vh', background: "var(--bg-alt)",
  border: "1px solid var(--border)", borderRadius: 'var(--radius-lg)', boxShadow: "var(--shadow)",
  zIndex: 150, display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
