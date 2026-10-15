/**
 * 一次性 codemod：把组件里的硬编码字号/圆角/强调色文字替换为设计 token。
 * 只改精确模式，改完打印每个文件的替换计数供核对。
 *
 * 用法: node tools/codemod-tokens.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'src');

/** 字号：13 个散落值收敛到 8 级阶梯。9px 并入 10px（低于此在手机上不可读）。 */
const FONT_SIZE = [
  [/\bfontSize:\s*9\b/g, "fontSize: 'var(--text-2xs)'"],
  [/\bfontSize:\s*10\b/g, "fontSize: 'var(--text-2xs)'"],
  [/\bfontSize:\s*11\b/g, "fontSize: 'var(--text-xs)'"],
  [/\bfontSize:\s*12\b/g, "fontSize: 'var(--text-sm)'"],
  [/\bfontSize:\s*13\b/g, "fontSize: 'var(--text-base)'"],
  [/\bfontSize:\s*14\b/g, "fontSize: 'var(--text-lg)'"],
  [/\bfontSize:\s*15\b/g, "fontSize: 'var(--text-lg)'"],
  [/\bfontSize:\s*16\b/g, "fontSize: 'var(--text-lg)'"],
  [/\bfontSize:\s*18\b/g, "fontSize: 'var(--text-xl)'"],
  [/\bfontSize:\s*24\b/g, "fontSize: 'var(--text-2xl)'"],
  [/\bfontSize:\s*28\b/g, "fontSize: 'var(--text-3xl)'"],
  [/\bfontSize:\s*32\b/g, "fontSize: 'var(--text-3xl)'"],
  [/\bfontSize:\s*40\b/g, "fontSize: 'var(--text-3xl)'"],
];

/** 圆角：10 个基数收敛到 6 级。3-4→xs/sm，5-6→sm/md，8→lg，10→lg，12→xl。 */
const RADIUS = [
  [/\bborderRadius:\s*2\b/g, "borderRadius: 'var(--radius-xs)'"],
  [/\bborderRadius:\s*3\b/g, "borderRadius: 'var(--radius-xs)'"],
  [/\bborderRadius:\s*4\b/g, "borderRadius: 'var(--radius-sm)'"],
  [/\bborderRadius:\s*5\b/g, "borderRadius: 'var(--radius-sm)'"],
  [/\bborderRadius:\s*6\b/g, "borderRadius: 'var(--radius-md)'"],
  [/\bborderRadius:\s*8\b/g, "borderRadius: 'var(--radius-lg)'"],
  [/\bborderRadius:\s*10\b/g, "borderRadius: 'var(--radius-lg)'"],
  [/\bborderRadius:\s*12\b/g, "borderRadius: 'var(--radius-xl)'"],
];

/** 强调色上的文字：统一走 --fg-on-accent（深色主题是深色字，浅色是白字） */
const ON_ACCENT = [[/color:\s*'#fff'/g, "color: 'var(--fg-on-accent)'"]];

/** 主题无关的硬编码色 → token */
const COLORS = [
  [/background:\s*'#0d1117'/g, "background: 'var(--code-bg)'"],
  [/background:\s*"#0d1117"/g, 'background: "var(--code-bg)"'],
  [/rgba\(244,\s*135,\s*113,\s*0\.25\)/g, 'var(--error)'],
  [/rgba\(210,\s*63,\s*42,\s*0\.3\)/g, 'var(--error)'],
  [/rgba\(13,\s*17,\s*23,\s*0\.85\)/g, 'var(--code-bg)'],
];

const RULES = [...FONT_SIZE, ...RADIUS, ...ON_ACCENT, ...COLORS];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full) && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

let totalFiles = 0;
let totalHits = 0;

for (const file of walk(ROOT)) {
  // Dialog/StateView/Brand/Markdown 是新写的，已用 token；仍然处理一遍以防遗漏
  const before = readFileSync(file, 'utf8');
  let after = before;
  let hits = 0;
  for (const [pattern, replacement] of RULES) {
    const matches = after.match(pattern);
    if (matches) {
      hits += matches.length;
      after = after.replace(pattern, replacement);
    }
  }
  if (after !== before) {
    writeFileSync(file, after);
    totalFiles += 1;
    totalHits += hits;
    console.log(`${relative(ROOT, file)}  ${hits} 处`);
  }
}

console.log(`\n合计 ${totalFiles} 个文件 / ${totalHits} 处替换`);
