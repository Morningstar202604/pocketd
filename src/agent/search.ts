import { readFile } from "node:fs/promises";
import { detectBinary, safeExistingPath, safeWritablePath, walkFiles, writeFileAtomic } from "./runtime.js";

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  filesScanned: number;
  truncated: boolean;
}

export interface SearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  include?: string;
  path?: string;
  maxResults?: number;
  includeIgnored?: boolean;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * 支持 `**`（跨目录）、`*`（单层内任意）、`?`（单字符）。
 * 注意：必须先处理通配符、再转义其余正则元字符，否则 `**` 会被转义破坏。
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const trimmed = pattern.trim().replace(/^\.\//, "");
  if (!trimmed) return true;
  const normalized = path.replace(/\\/g, "/");

  const DOUBLE_STAR_SLASH = "\u0001";
  const DOUBLE_STAR = "\u0002";
  const SINGLE_STAR = "\u0003";
  const QUESTION = "\u0004";

  const body = trimmed
    .replace(/\*\*\//g, DOUBLE_STAR_SLASH)
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, SINGLE_STAR)
    .replace(/\?/g, QUESTION)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(new RegExp(DOUBLE_STAR_SLASH, "g"), "(?:.*/)?")
    .replace(new RegExp(DOUBLE_STAR, "g"), ".*")
    .replace(new RegExp(SINGLE_STAR, "g"), "[^/]*")
    .replace(new RegExp(QUESTION, "g"), "[^/]");

  return new RegExp(`^${body}$`).test(normalized);
}

function buildMatcher(opts: SearchOptions): { test: (line: string) => { index: number } | null } {
  const flags = opts.caseSensitive ? "" : "i";
  if (opts.regex) {
    const re = new RegExp(opts.query, flags);
    return {
      test: (line) => {
        const m = re.exec(line);
        return m && m.index >= 0 ? { index: m.index } : null;
      },
    };
  }
  const needle = opts.caseSensitive ? opts.query : opts.query.toLowerCase();
  return {
    test: (line) => {
      const hay = opts.caseSensitive ? line : line.toLowerCase();
      const idx = hay.indexOf(needle);
      return idx >= 0 ? { index: idx } : null;
    },
  };
}

export async function searchProject(opts: SearchOptions): Promise<SearchResult> {
  const maxResults = opts.maxResults ?? 200;
  const matcher = buildMatcher(opts);
  const files = await walkFiles(opts.path || ".", { includeIgnored: opts.includeIgnored });
  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  for (const rel of files) {
    if (opts.include && !matchesGlob(rel, opts.include)) continue;
    let buf: Buffer;
    try {
      const full = await safeExistingPath(rel);
      buf = await readFile(full);
    } catch {
      continue;
    }
    if (buf.length > MAX_FILE_BYTES || detectBinary(buf)) continue;
    filesScanned += 1;
    const lines = buf.toString("utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const hit = matcher.test(lines[i]);
      if (!hit) continue;
      matches.push({ path: rel, line: i + 1, column: hit.index + 1, text: lines[i].slice(0, 400) });
      if (matches.length >= maxResults) {
        truncated = true;
        return { matches, filesScanned, truncated };
      }
    }
  }
  return { matches, filesScanned, truncated };
}

export interface ReplaceOptions extends SearchOptions {
  replacement: string;
  dryRun?: boolean;
}

export interface ReplaceResult {
  filesAffected: number;
  totalMatches: number;
  changed: Array<{ path: string; matches: number }>;
}

export async function replaceInProject(opts: ReplaceOptions): Promise<ReplaceResult> {
  if (!opts.query) throw new Error("缺少 query");
  const flags = opts.regex ? (opts.caseSensitive ? "g" : "gi") : undefined;
  const literalFlags = opts.caseSensitive ? "g" : "gi";
  const files = await walkFiles(opts.path || ".", { includeIgnored: opts.includeIgnored });
  const changed: Array<{ path: string; matches: number }> = [];
  let totalMatches = 0;

  for (const rel of files) {
    if (opts.include && !matchesGlob(rel, opts.include)) continue;
    let content: string;
    try {
      const full = await safeExistingPath(rel);
      const buf = await readFile(full);
      if (buf.length > MAX_FILE_BYTES || detectBinary(buf)) continue;
      content = buf.toString("utf8");
    } catch {
      continue;
    }
    const re = opts.regex
      ? new RegExp(opts.query, flags)
      : new RegExp(opts.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), literalFlags);
    const hits = content.match(re);
    if (!hits || hits.length === 0) continue;
    const next = content.replace(re, opts.replacement);
    if (next === content) continue;
    if (!opts.dryRun) {
      const full = await safeWritablePath(rel);
      await writeFileAtomic(full, next);
    }
    totalMatches += hits.length;
    changed.push({ path: rel, matches: hits.length });
  }

  return { filesAffected: changed.length, totalMatches, changed };
}
