import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { MONO_FONT } from '../lib/presets';
import { BRAND } from '../lib/brand';
import { useStore } from '../store';
import '@xterm/xterm/css/xterm.css';

/** xterm 不读 CSS 变量，主题必须显式给值；与 index.css 的 token 对齐 */
function xtermTheme(theme: 'dark' | 'light') {
  return theme === 'light'
    ? {
        background: '#ffffff',
        foreground: '#16171a',
        cursor: '#1e5ede',
        cursorAccent: '#ffffff',
        selectionBackground: '#cce0ff',
        black: '#24292f', red: '#b3261e', green: '#0a6b56', yellow: '#7a5c00',
        blue: '#1e5ede', magenta: '#8250df', cyan: '#0a6b56', white: '#e9ebef',
        brightBlack: '#6e7781', brightRed: '#b3261e', brightGreen: '#0a6b56',
        brightYellow: '#7a5c00', brightBlue: '#1e5ede', brightMagenta: '#8250df',
        brightCyan: '#0a6b56', brightWhite: '#16171a',
      }
    : {
        background: 'var(--code-bg)',
        foreground: '#c9d1d9',
        cursor: '#4f8cff',
        cursorAccent: '#0d1117',
        selectionBackground: '#1d4ed880',
        black: '#484f58', red: '#ff7b72', green: '#7ee787', yellow: '#d29922',
        blue: '#79c0ff', magenta: '#d2a8ff', cyan: '#56d4dd', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#aff5b4',
        brightYellow: '#e3b341', brightBlue: '#a5d6ff', brightMagenta: '#e2c5ff',
        brightCyan: '#76e3ea', brightWhite: '#f0f6fc',
      };
}

export function TerminalPanel() {
  const theme = useStore((s) => s.theme);
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ref.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12, // xterm 选项是 JS API，必须是数字
      fontFamily: MONO_FONT,
      theme: xtermTheme(theme),
      scrollback: 10000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    setStatus('connecting');
    term.write(`\x1b[36m${BRAND.name}\x1b[0m 终端\r\n`);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('ready');
      term.write('\x1b[32m✓ 已连接\x1b[0m\r\n');
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    // 后端把 PTY 输出原样透传，这里直接写入，不做 JSON 解析
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '');
    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      setStatus('error');
      term.write('\r\n\x1b[31m✗ 终端已断开\x1b[0m\r\n');
    };

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [attempt]);

  // 主题切换：只改配色，不重建终端（重建会丢掉滚动缓冲）
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme(theme);
    }
  }, [theme]);

  const statusColor = status === 'ready' ? 'var(--success)' : status === 'error' ? 'var(--error)' : 'var(--fg-muted)';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', gap: 6, padding: '5px 8px', flexShrink: 0,
        borderBottom: '1px solid var(--border)', alignItems: 'center',
      }}>
        <button type="button" className="btn-xs" onClick={() => termRef.current?.clear()} aria-label="清空终端">
          清空
        </button>
        {status === 'error' && (
          <button
            type="button"
            className="btn-xs"
            onClick={() => setAttempt((a) => a + 1)}
            aria-label="重新连接终端"
          >
            ↻ 重连
          </button>
        )}
        <span
          role="status"
          style={{ fontSize: 'var(--text-2xs)', marginLeft: 'auto', color: statusColor, display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <span aria-hidden="true">●</span>
          {status === 'ready' ? '就绪' : status === 'connecting' ? '连接中' : '已断开'}
        </span>
      </div>
      <div style={{ flex: 1, padding: 4, minHeight: 0 }} ref={ref} />
    </div>
  );
}
