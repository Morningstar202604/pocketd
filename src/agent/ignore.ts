/**
 * 工作区忽略规则。
 *
 * 语义与 .gitignore 完全一致，由 `ignore` 包实现（ESLint 同款，零依赖）。
 *
 * 三个来源按顺序叠加，后面的规则可以覆盖前面的：
 *   1. .gitignore        —— 实时读取，不维护副本，所以永远不存在「同步过期」
 *   2. .pocketdignore    —— 本项目的额外规则
 *   3. .zcodeignore      —— 旧品牌的规则文件，沿用不丢
 *
 * 作用范围（刻意与「文件树浏览」分开）：
 *   忽略只影响 搜索 / 匹配 / @ 文件候选 —— 这些是「把文件喂给模型」的入口，
 *   爬进 node_modules 会白烧上下文。
 *   不影响 目录浏览 / 读文件 / Agent 显式访问 —— 想看一眼依赖源码仍然点得进去。
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import ignore, { type Ignore } from "ignore";
import { BRAND } from "./brand.js";
import { WORKSPACE } from "./paths.js";

/**
 * 兜底黑名单：即使用户一个规则文件都没写，这些目录也不该被递归扫描。
 * 只是性能与常识的底线，用户无法通过配置关掉（回收站尤其不能进搜索）。
 */
const ALWAYS_IGNORED = [
  ".git",
  ".hg",
  ".svn",
  BRAND.trashDirName,
  BRAND.legacyTrashDirName,
];

const IGNORE_SOURCES = [
  ".gitignore",
  BRAND.ignoreFileName,
  BRAND.legacyIgnoreFileName,
];

interface IgnoreSnapshot {
  matcher: Ignore;
  /** 各规则文件的 mtimeMs，用于判断缓存是否过期 */
  stamp: string;
}

let cached: IgnoreSnapshot | null = null;

async function fingerprint(): Promise<string> {
  const parts: string[] = [];
  for (const name of IGNORE_SOURCES) {
    try {
      const s = await stat(join(WORKSPACE, name));
      parts.push(`${name}:${s.mtimeMs}:${s.size}`);
    } catch {
      parts.push(`${name}:-`);
    }
  }
  return parts.join("|");
}

async function build(): Promise<IgnoreSnapshot> {
  const matcher = ignore().add(ALWAYS_IGNORED);
  const stamp = await fingerprint();
  for (const name of IGNORE_SOURCES) {
    try {
      const text = await readFile(join(WORKSPACE, name), "utf8");
      matcher.add(text);
    } catch {
      // 文件不存在或不可读都按「没有额外规则」处理
    }
  }
  return { matcher, stamp };
}

/**
 * 取得当前规则。规则文件改动后（含用户手动编辑、Agent 写文件）自动重建，
 * 所以不需要重启进程。
 */
export async function ignoreMatcher(): Promise<Ignore> {
  const stamp = await fingerprint();
  if (cached && cached.stamp === stamp) return cached.matcher;
  const fresh = await build();
  cached = fresh;
  return fresh.matcher;
}

/** 归一化：统一分隔符、去掉 ./ 前缀与首尾斜杠，目录带尾斜杠 */
function toProbe(relPath: string, isDir: boolean): string | null {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === ".") return null;
  if (!ignore.isPathValid(normalized)) return null;
  return isDir ? `${normalized}/` : normalized;
}

export async function isIgnored(relPath: string, isDir = false): Promise<boolean> {
  const probe = toProbe(relPath, isDir);
  if (probe === null) return false;
  const matcher = await ignoreMatcher();
  return matcher.ignores(probe);
}

/**
 * 批量过滤。一次取规则、逐条判定，避免每个文件都去 stat 规则文件。
 * 注意：这只是文件级判定；被忽略目录**内部**的文件在遍历时本就该跳过，
 * 所以调用方仍需在遍历中调用 isIgnored(dir, true) 剪枝。
 */
export async function filterIgnored(paths: readonly string[]): Promise<string[]> {
  const matcher = await ignoreMatcher();
  return paths.filter((p) => {
    const probe = toProbe(p, false);
    return probe === null || !matcher.ignores(probe);
  });
}

/** 供测试与「改完规则立刻生效」的场景强制失效缓存 */
export function resetIgnoreCache(): void {
  cached = null;
}
