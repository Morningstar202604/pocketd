/**
 * 第二批 codemod：语义性修复 —— 色字面量归 token、触控目标改 CSS 类。
 * 这些替换需要上下文判断，所以逐条精确匹配，匹配不到就报错（不静默跳过）。
 *
 * 用法: node tools/codemod-polish.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'src');
const files = new Map();
/** 记录每个文件原本是否用 CRLF，写回时还原，避免整文件行尾翻转 */
const crlf = new Map();

function load(relPath) {
  if (!files.has(relPath)) {
    const raw = readFileSync(join(SRC, relPath), 'utf8');
    crlf.set(relPath, raw.includes('\r\n'));
    // 统一成 LF 做匹配：多行模式里写的是 \n
    files.set(relPath, raw.replace(/\r\n/g, '\n'));
  }
  return files.get(relPath);
}

function edit(relPath, from, to, note) {
  const content = load(relPath);
  const pattern = from.replace(/\r\n/g, '\n');
  if (!content.includes(pattern)) {
    throw new Error(`未找到模式（${note}）: ${relPath}\n  ${pattern.slice(0, 160)}`);
  }
  files.set(relPath, content.replace(pattern, to.replace(/\r\n/g, '\n')));
  console.log(`  ✓ ${note}`);
}

/* ── ChatPanel：色字面量 → token，触控目标 → 类 ── */

edit('components/ChatPanel.tsx',
  "  const fg = isUser ? '#fff' : isError ? \"var(--error)\" : \"var(--fg)\";",
  "  const fg = isUser ? 'var(--fg-on-accent)' : isError ? 'var(--error)' : 'var(--fg)';",
  'ChatPanel 用户气泡文字色 → --fg-on-accent');

edit('components/ChatPanel.tsx',
  "  medium: 'var(--warn, #d9a441)',",
  "  medium: 'var(--warn)',",
  'ChatPanel 危险度中风险色 → --warn（去掉自造琥珀色）');

edit('components/ChatPanel.tsx',
  "const statusColor = call.status === 'running' ? 'var(--fg-dim)' : call.status === 'ok' ? 'var(--ok, #49a05e)' : 'var(--error)';",
  "const statusColor =\n    call.status === 'running' ? 'var(--fg-dim)' : call.status === 'ok' ? 'var(--ok)' : 'var(--error)';",
  'ChatPanel 工具状态色 → --ok（该 token 已定义）');

// 快捷指令按钮：minHeight 28 在手机上够不到
edit('components/ChatPanel.tsx',
  `            <button key={i} onClick={() => sendChat(p.text)} style={{
              fontSize: 'var(--text-xs)', background: 'transparent', border: "1px solid var(--border)",
              color: "var(--fg-muted)", padding: '4px 10px', borderRadius: 'var(--radius-lg)', whiteSpace: 'nowrap',
              minHeight: 28,
            }} aria-label={\`快捷指令: \${p.label}\`}>`,
  `            <button
              type="button"
              key={i}
              className="chip"
              onClick={() => sendChat(p.text)}
              aria-label={\`快捷指令: \${p.label}\`}
            >`,
  'ChatPanel 快捷指令 → .chip（触屏自动 44px）');

// 工具调用行
edit('components/ChatPanel.tsx',
  `          textAlign: 'left', minHeight: 30, color: 'var(--fg-muted)',
        }}`,
  `          textAlign: 'left', color: 'var(--fg-muted)',
        }}
        className="touch-row"`,
  'ChatPanel 工具调用行 → .touch-row');

// 审批按钮：去掉内联 minHeight，改用 .btn（触屏 44px），并补上 type
edit('components/ChatPanel.tsx',
  `        <button
          onClick={() => onDecide(false, false)}
          style={{
            fontSize: 'var(--text-xs)', padding: '5px 12px', borderRadius: 'var(--radius-sm)', minHeight: 32,
            background: 'transparent', color: 'var(--error)', border: '1px solid var(--error)',
          }}
        >
          拒绝
        </button>
        <button
          onClick={() => onDecide(true, remember)}
          style={{
            fontSize: 'var(--text-xs)', padding: '5px 12px', borderRadius: 'var(--radius-sm)', minHeight: 32,
            background: 'var(--accent)', color: 'var(--fg-on-accent)', border: 'none',
          }}
        >
          批准
        </button>`,
  `        <button
          type="button"
          className="btn"
          onClick={() => onDecide(false, false)}
          style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
        >
          拒绝
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => onDecide(true, remember)}
        >
          批准
        </button>`,
  'ChatPanel 审批按钮 → .btn/.btn-primary');

/* ── SettingsModal：MCP 启停开关只有 14px，点不中 ── */

edit('components/SettingsModal.tsx',
  `                      aria-label={\`\${s.enabled ? '禁用' : '启用'} \${s.name}\`}
                      style={{
                        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                        background: s.enabled ? "var(--success)" : "var(--border)",
                        border: 'none', cursor: 'pointer',
                      }}
                    />`,
  `                      aria-label={\`\${s.enabled ? '禁用' : '启用'} \${s.name}\`}
                      title={s.enabled ? '点击禁用' : '点击启用'}
                      style={{
                        width: 44, height: 44, flexShrink: 0, background: 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        border: 'none', cursor: 'pointer', marginLeft: -14, marginRight: -14,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 14, height: 14, borderRadius: '50%',
                          background: s.enabled ? 'var(--success)' : 'var(--border)',
                          display: 'block',
                        }}
                      />
                    </button>`,
  'SettingsModal MCP 启停 → 44px 可点区域（视觉仍是 14px 圆点）');

// 修掉上面替换后多出来的一个 </button>（原按钮是自闭合）
edit('components/SettingsModal.tsx',
  `                      />
                    </button>
                    <span style={{ fontSize: 'var(--text-sm)' }}>{s.name}</span>`,
  `                    <span style={{ fontSize: 'var(--text-sm)' }}>{s.name}</span>`,
  'SettingsModal 清理多余闭合标签');

/* ── CommandPalette：命令行 32px → 触屏 44px ── */

edit('components/CommandPalette.tsx',
  `              cursor: 'pointer', fontSize: 'var(--text-sm)', borderLeft: '2px solid transparent',`,
  `              cursor: 'pointer', fontSize: 'var(--text-sm)', borderLeft: '2px solid transparent',
              minHeight: 'var(--control-h)',`,
  'CommandPalette 命令行给出基础高度');

/* ── 写入 ── */

console.log('');
for (const [rel, content] of files) {
  const out = crlf.get(rel) ? content.replace(/\n/g, '\r\n') : content;
  writeFileSync(join(SRC, rel), out);
  console.log(`已写入 ${rel}${crlf.get(rel) ? '（保留 CRLF）' : ''}`);
}
console.log(`\n共修改 ${files.size} 个文件`);
