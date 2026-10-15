import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { useStore } from '../store';
import { MONO_FONT } from '../lib/presets';
import { EmptyState, ErrorState } from './StateView';
import { Markdown } from './Markdown';
import { definePocketdThemes } from '../monaco-themes';
import { fileKind, previewUrl, rawFileUrl } from '../lib/fileKind';
import { useIsNarrowViewport } from '../lib/useIsNarrowViewport';

type ViewMode = 'code' | 'preview';

export function EditorArea() {
  const {
    openFiles, activeFile, activeFileError, updateActiveContent, closeTab,
    setActiveFile, theme, loadFile, filesPanelOpen, toggleFilesPanel, mobileView,
  } = useStore();

  const activeFileObj = openFiles.find((f) => f.path === activeFile);
  // Monaco 的主题必须显式切换：它不读 CSS 变量
  const monacoTheme = theme === 'light' ? 'pocketd-light' : 'pocketd-dark';
  const themed = useRef(false);
  const narrow = useIsNarrowViewport();

  /**
   * 手机上「编辑」与「面板」是互斥视图，面板模式下 .editor-area 是 display:none。
   * 在 display:none 的容器里创建 Monaco，它量到 0 尺寸后会长久停在 5×5：
   * 切回编辑视图时 automaticLayout 的 ResizeObserver 又会用隐藏时缓存的值把它压回去，
   * 所以事后补一次 layout() 救不回来。干脆在隐藏期间不挂载 —— 切过去时容器已可见，
   * Monaco 一次性就按真实尺寸建好。
   */
  const editorHidden = narrow && mobileView !== 'editor';

  /**
   * Monaco 在容器尚未定型时就创建，会把自己固定成 5×5（最小值）。
   * 麻烦在于容器尺寸之后**不再变化**，automaticLayout 的观察者因此永远不触发，
   * 也就永远没人纠正它 —— 编辑器看起来就是一条缝。
   *
   * nudge() 是唯一的核心动作：重排一次，核对 Monaco 报的尺寸与容器是否一致，
   * 不一致就继续。ResizeObserver 与 window resize 只是让它响得更快；
   * 真正保证收敛的是那个每 500ms 的自检（RO 与 resize 在后台标签页、
   * 无渲染帧的自动化环境里都可能不投递）。
   */
  const cleanupRef = useRef<(() => void) | null>(null);
  const nudgeRef = useRef<(() => void) | null>(null);
  const handleEditorMount: OnMount = (editor) => {
    cleanupRef.current?.();
    const container = editor.getDomNode()?.parentElement ?? null;

    let timer: number | null = null;
    let pass = 0;
    /**
     * 量尺寸的基准不是 dom.parentElement：wrapper 在就绪前给容器 div 挂
     * display:none，那一刻它量出来是 0。向上找到最近一个**可见**的祖先
     * （offsetParent 非 null 且 clientWidth > 0），以它为准。
     */
    const visibleBox = (): HTMLElement | null => {
      const dom = editor.getDomNode();
      let el = dom?.parentElement ?? null;
      for (let i = 0; el && i < 6; i += 1) {
        if (el.clientWidth > 0 && el.clientHeight > 0 && getComputedStyle(el).display !== 'none') {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    };
    const relayout = (): void => {
      const dom = editor.getDomNode();
      const box = visibleBox();
      const off =
        !!dom && !!box && (dom.clientWidth !== box.clientWidth || dom.clientHeight !== box.clientHeight);

      /**
       * 尺寸不一致时**显式告知** Monaco 该多大，而不是让它自己量。
       * wrapper 在未就绪时用 display:none 的容器创建编辑器（见渲染处的注释），
       * Monaco 量到 0 后固定成 5×5；layout({width,height}) 直接改写内部尺寸
       * 并强制一次同步渲染，不依赖任何后续时机。
       */
      if (off && box) {
        editor.layout({ width: box.clientWidth, height: box.clientHeight });
      } else {
        editor.layout();
      }

      // 下一帧再核对一次：wrapper 移除 hide 样式、React 提交 DOM 都可能晚于本次调用
      if (pass < 40) {
        pass += 1;
        timer = window.setTimeout(relayout, 60);
      } else {
        timer = null;
      }
    };
    const nudge = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      relayout();
    };

    // 下面两个是「尽快响一次」的加速器；真正保证收敛的是上面那个自校验循环
    window.addEventListener('resize', nudge);
    let ro: ResizeObserver | null = null;
    if (container) {
      ro = new ResizeObserver(nudge);
      ro.observe(container);
    }
    /**
     * 兜底自检：ResizeObserver 与 resize 事件都可能不投递（后台标签页、
     * 无渲染帧的自动化浏览器），而容器尺寸变化未必伴随窗口变化。
     *
     * 用 setTimeout 链而非 setInterval：setInterval 在后台标签页会被浏览器
     * 大幅节流（实测 100ms 的间隔 1.7s 内只跑 2 次），setTimeout 链在同样
     * 环境下可靠得多；只在尺寸不匹配时才继续排下一次，无变化时不产生负载。
     */
    let watchdogTimer: number | null = null;
    let stopped = false;
    const watchdog = () => {
      if (stopped) return;
      const dom = editor.getDomNode();
      const box = visibleBox();
      if (dom && box && (dom.clientWidth !== box.clientWidth || dom.clientHeight !== box.clientHeight)) {
        nudge();
      }
      watchdogTimer = window.setTimeout(watchdog, 200);
    };
    // watchdog 立刻启动：onMount 阶段 wrapper 的容器还在 display:none，
    // 此时的任何量测都是 0；watchdog 的每一轮都会在容器可见后把尺寸推正。
    watchdogTimer = window.setTimeout(watchdog, 100);

    nudge();
    nudgeRef.current = nudge;

    cleanupRef.current = () => {
      stopped = true;
      window.removeEventListener('resize', nudge);
      ro?.disconnect();
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      if (timer !== null) clearTimeout(timer);
      nudgeRef.current = null;
      cleanupRef.current = null;
    };
  };
  useEffect(() => () => cleanupRef.current?.(), []);
  // 切换文件后补一次重排，内容立刻可见，不必等下一次重绘时机
  useEffect(() => {
    if (editorHidden) return;
    nudgeRef.current?.();
  }, [activeFile, editorHidden]);

  // 按文件类型决定默认视图：图片直接预览；Markdown/HTML 默认看代码（可切预览）
  const kind = activeFileObj ? fileKind(activeFileObj.path) : 'text';
  const [view, setView] = useState<ViewMode>('code');
  const supported = kind === 'markdown' || kind === 'html';

  useEffect(() => {
    // 换文件时回到默认视图，不要把上一个文件的预览状态带过来
    setView(kind === 'image' ? 'preview' : 'code');
  }, [activeFile, kind]);

  const editorOptions = {
    fontSize: 13, // Monaco 选项是 JS API，必须是数字
    fontFamily: MONO_FONT,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: 'off' as const,
    /**
     * 关掉 Monaco 自带的自动布局。
     * 它在容器尚未定型时创建会量到 0 并把自身固定成 5×5，而此后容器尺寸不再变化，
     * 它的观察者就不再触发，于是永远纠正不回来。更麻烦的是它会在我们调用
     * layout({width,height}) 修正之后，用自己的陈旧测量值再覆盖一次 —— 两个
     * 布局控制器互相打架。改由 handleEditorMount 里的 nudge 独占负责（见下）。
     */
    automaticLayout: false,
    lineNumbers: 'on' as const,
    renderLineHighlight: 'all' as const,
    smoothScrolling: true,
    cursorBlinking: 'smooth' as const,
    padding: { top: 8, bottom: 8 },
    scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: false },
  };

  useEffect(() => {
    if (activeFileError) themed.current = false;
  }, [activeFileError]);

  const previewNode = useMemo(() => {
    if (!activeFileObj || view !== 'preview') return null;
    if (kind === 'image') {
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: 'var(--bg-alt)' }}>
          <img
            src={rawFileUrl(activeFileObj.path)}
            alt={activeFileObj.path}
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm, var(--shadow))' }}
          />
        </div>
      );
    }
    if (kind === 'markdown') {
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: 16 }}>
          <Markdown content={activeFileObj.content} />
        </div>
      );
    }
    if (kind === 'html') {
      // 指向 /preview/，这样 HTML 里的相对路径（css/js/图片）都能正确解析；
      // 用 sandbox 去掉同源，避免被预览的页面碰到主应用的存储
      return (
        <iframe
          title={`预览 ${activeFileObj.path}`}
          src={previewUrl(activeFileObj.path)}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', background: '#fff' }}
        />
      );
    }
    return null;
  }, [activeFileObj, kind, view]);

  return (
    <main
      className="editor-area"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, background: 'var(--bg)' }}
    >
      {/* 标签栏 */}
      <div
        className="tabs-bar"
        role="tablist"
        aria-label="打开的文件"
        style={{
          display: 'flex', alignItems: 'center', background: 'var(--bg-alt)',
          borderBottom: '1px solid var(--border)', flexShrink: 0, minHeight: 36,
        }}
      >
        {/* 窄屏：文件树开关放这里，省下顶栏一格 */}
        <button
          type="button"
          className="icon-btn narrow-only"
          onClick={toggleFilesPanel}
          aria-label={filesPanelOpen ? '关闭文件树' : '打开文件树'}
          style={{ display: 'none', marginLeft: 4 }}
        >
          <span aria-hidden="true">📁</span>
        </button>

        <div style={{ display: 'flex', overflowX: 'auto', flex: 1, minWidth: 0 }}>
          {openFiles.map((f) => {
            const isActive = f.path === activeFile;
            const name = f.path.split('/').pop();
            return (
              <div
                key={f.path}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveFile(f.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveFile(f.path);
                  }
                }}
                title={f.path}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '0 6px 0 10px',
                  fontSize: 'var(--text-sm)', borderRight: '1px solid var(--border)', cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  color: isActive ? 'var(--fg)' : 'var(--fg-dim)',
                  background: isActive ? 'var(--bg)' : 'transparent',
                  borderTop: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                  position: 'relative',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>{name}</span>
                {f.modified && (
                  <span
                    title="未保存"
                    aria-label="未保存"
                    style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }}
                  />
                )}
                <button
                  type="button"
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(f.path);
                  }}
                  aria-label={`关闭 ${name}`}
                  style={{ minWidth: 24, minHeight: 24, fontSize: 'var(--text-base)', color: 'var(--fg-dim)' }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* 预览切换：只对能预览的类型显示 */}
        {activeFileObj && supported && (
          <button
            type="button"
            className="btn-xs"
            onClick={() => setView(view === 'preview' ? 'code' : 'preview')}
            aria-pressed={view === 'preview'}
            style={{
              margin: '0 6px',
              borderColor: view === 'preview' ? 'var(--accent)' : 'var(--border)',
              color: view === 'preview' ? 'var(--accent)' : 'var(--fg-muted)',
            }}
            title={view === 'preview' ? '回到代码' : '渲染预览'}
          >
            <span aria-hidden="true">{view === 'preview' ? '⌨' : '👁'}</span>
            <span className="wide-only">{view === 'preview' ? '代码' : '预览'}</span>
          </button>
        )}

        {/* 在浏览器里打开当前文件：HTML 走 /preview 才能正确加载相对资源 */}
        {activeFileObj && (
          <a
            href={kind === 'image' ? rawFileUrl(activeFileObj.path) : previewUrl(activeFileObj.path)}
            target="_blank"
            rel="noopener noreferrer"
            className="icon-btn"
            aria-label="在新标签页打开"
            title="在新标签页打开（工作区预览）"
            style={{ marginRight: 6, textDecoration: 'none' }}
          >
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>

      {/* 编辑/预览区域 */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {activeFileError ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ErrorState
              title="无法打开文件"
              message={`${activeFileError.path}: ${activeFileError.message}`}
              onRetry={() => loadFile(activeFileError.path)}
            />
          </div>
        ) : previewNode ? (
          previewNode
        ) : activeFileObj ? (
          editorHidden ? null : (
            /**
             * 这里包一层常显容器是在绕 @monaco-editor/react 的固有缺陷：
             * 它把 Monaco 创建在「未就绪时 display:none」的 div 里
             * （容器样式 = fullWidth + hide），编辑器构造函数量到 0 尺寸后
             * 把自身固定成 5×5；此后容器尺寸不再变化，automaticLayout 的
             * 观察者永不触发。把 wrapper 放进一个永远可见的盒子里，
             * 那个内部 div 的 display:none 只在加载动画的瞬间出现，
             * 加上 onMount 里的显式 layout({width,height})，两个手段叠加
             * 才能稳定收敛（单靠任何一个都不行，见 ADR 复盘）。
             */
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              <Editor
                width="100%"
                height="100%"
                path={activeFileObj.path}
                language={extLang(activeFileObj.path)}
                value={activeFileObj.content}
                onChange={(v) => updateActiveContent(v || '')}
                options={editorOptions}
                theme={monacoTheme}
                onMount={handleEditorMount}
                beforeMount={(monaco) => {
                  if (!themed.current) {
                    definePocketdThemes(monaco);
                    themed.current = true;
                  }
                }}
                loading={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
                    <span className="spinner spinner-lg" aria-hidden="true" />
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-dim)' }}>加载编辑器</span>
                  </div>
                }
              />
            </div>
          )
        ) : (
          <div style={{ position: 'absolute', inset: 0 }}>
            <EmptyState
              icon="⌨️"
              title="从左侧选择一个文件开始编辑"
              description={
                <span>
                  图片与 Markdown/HTML 可直接预览；
                  <a
                    href="/preview/"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    打开工作区预览 ↗
                  </a>
                </span>
              }
            />
          </div>
        )}
      </div>
    </main>
  );
}

const EXT_MAP: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript',
  jsx: 'javascript', tsx: 'typescript', json: 'json', md: 'markdown',
  py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp',
  h: 'c', hpp: 'cpp', css: 'css', html: 'html', xml: 'xml', yaml: 'yaml',
  yml: 'yaml', sh: 'shell', bash: 'shell', sql: 'sql', toml: 'toml',
  ini: 'ini', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
};

function extLang(p: string): string {
  return EXT_MAP[p.split('.').pop()?.toLowerCase() || ''] || 'plaintext';
}
