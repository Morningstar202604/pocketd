import { mkdir, readFile, writeFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import { envValue } from "./brand.js";
import { ignoreMatcher } from "./ignore.js";
import { HOME_DIR, TRASH_DIR, TRASH_DIRS, WORKSPACE } from "./paths.js";

export { HOME_DIR, TRASH_DIR, TRASH_DIRS, WORKSPACE };

export const PORT = Number(envValue("PORT")) || 3030;
export const HOST = envValue("HOST")?.trim() || "127.0.0.1";

const STATE_DIR = join(HOME_DIR, "state");
const SECRETS_FILE = join(STATE_DIR, "secrets.json");

export interface ApiConfig {
  apiKey: string;
  apiBase: string;
  apiModel: string;
  temperature: number;
}

export const config: ApiConfig = {
  apiKey: envValue("API_KEY")?.trim() || "",
  apiBase: (envValue("API_BASE")?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
  apiModel: envValue("API_MODEL")?.trim() || "gpt-4o",
  temperature: Number(envValue("TEMPERATURE")) || 0.3,
};

export class PathEscapeError extends Error {
  constructor(rel: string) {
    super(`路径越界: ${rel}`);
    this.name = "PathEscapeError";
  }
}

async function deepestRealpath(target: string): Promise<string | null> {
  let probe = target;
  for (let i = 0; i < 64; i += 1) {
    try {
      return await realpath(probe);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }
  return null;
}

function isInsideWorkspace(p: string): boolean {
  return p === WORKSPACE || p.startsWith(WORKSPACE + sep);
}

async function assertNoSymlinkEscape(target: string): Promise<void> {
  const real = await deepestRealpath(target);
  if (real && !isInsideWorkspace(real)) throw new PathEscapeError(target);
}

export function toWorkspacePath(rel: string): string {
  const clean = rel.replace(/^[/\\]+/, "");
  const full = normalize(join(WORKSPACE, clean));
  if (!isInsideWorkspace(full)) throw new PathEscapeError(rel);
  return full;
}

export async function safeExistingPath(rel: string): Promise<string> {
  const full = toWorkspacePath(rel);
  await assertNoSymlinkEscape(full);
  if (!existsSync(full)) throw new Error(`路径不存在: ${rel || "."}`);
  return full;
}

export async function safeWritablePath(rel: string): Promise<string> {
  const full = toWorkspacePath(rel);
  await assertNoSymlinkEscape(dirname(full));
  return full;
}

export function toRelative(full: string): string {
  const rel = full.slice(WORKSPACE.length).replace(/^[/\\]+/, "");
  return rel.split(sep).join("/");
}

export async function writeFileAtomic(full: string, content: string): Promise<void> {
  await mkdir(dirname(full), { recursive: true });
  const tmp = `${full}.pocketd-tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, full);
}

export async function moveToTrash(rel: string): Promise<string> {
  if (!rel || rel === "." || rel === "/") throw new Error("拒绝删除工作区根目录");
  const full = await safeExistingPath(rel);
  await mkdir(TRASH_DIR, { recursive: true });
  const trashName = `${Date.now()}_${rel.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const trashPath = join(TRASH_DIR, trashName);
  try {
    await rename(full, trashPath);
  } catch {
    await rm(trashPath, { recursive: true, force: true });
    const { cp } = await import("node:fs/promises");
    await cp(full, trashPath, { recursive: true });
    await rm(full, { recursive: true, force: true });
  }
  await writeFile(
    `${trashPath}.meta.json`,
    JSON.stringify({ originalPath: rel, deletedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
  return trashName;
}

export interface TrashEntry {
  name: string;
  originalPath: string;
  deletedAt: string;
  trashed?: string;
}

/**
 * 列出回收站条目。
 * 同时读新旧两个回收站目录：改名不该让用户之前删掉、还能找回的文件消失。
 */
export async function listTrash(): Promise<TrashEntry[]> {
  const entries: TrashEntry[] = [];
  const seen = new Set<string>();
  for (const dir of TRASH_DIRS) {
    if (!existsSync(dir)) continue;
    const names = await readdir(dir);
    for (const name of names) {
      if (name.endsWith(".meta.json") || seen.has(name)) continue;
      seen.add(name);
      let originalPath = "";
      let deletedAt = "";
      try {
        const meta = JSON.parse(await readFile(`${join(dir, name)}.meta.json`, "utf8")) as {
          originalPath?: string;
          deletedAt?: string;
        };
        originalPath = meta.originalPath ?? "";
        deletedAt = meta.deletedAt ?? "";
      } catch {
        deletedAt = new Date(Number(name.split("_")[0]) || 0).toISOString();
      }
      entries.push({ name, originalPath, deletedAt, trashed: dir });
    }
  }
  entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return entries;
}

/** 在哪个回收站目录里找到了这个条目（新旧目录都找） */
function findTrashPath(name: string): string | null {
  for (const dir of TRASH_DIRS) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function restoreFromTrash(name: string): Promise<string> {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("非法回收站条目");
  }
  const trashPath = findTrashPath(name);
  if (!trashPath) throw new Error(`回收站中不存在: ${name}`);

  let originalPath = "";
  try {
    const meta = JSON.parse(await readFile(`${trashPath}.meta.json`, "utf8")) as {
      originalPath?: string;
    };
    originalPath = meta.originalPath ?? "";
  } catch {
    originalPath = "";
  }
  if (!originalPath) throw new Error("缺少元数据，无法确定原始位置（仍可手动移出工作区的回收站目录）");

  const target = toWorkspacePath(originalPath);
  await assertNoSymlinkEscape(dirname(target));
  let finalTarget = target;
  if (existsSync(finalTarget)) {
    finalTarget = `${target}.restored-${Date.now()}`;
  }
  await mkdir(dirname(finalTarget), { recursive: true });
  try {
    await rename(trashPath, finalTarget);
  } catch {
    const { cp } = await import("node:fs/promises");
    await cp(trashPath, finalTarget, { recursive: true });
    await rm(trashPath, { recursive: true, force: true });
  }
  await rm(`${trashPath}.meta.json`, { force: true }).catch(() => {});
  return toRelative(finalTarget);
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  /** 命中忽略规则：仍可浏览/打开，但不会被搜索与 @ 候选收录 */
  ignored?: boolean;
}

export async function listDirectory(rel: string): Promise<TreeEntry[]> {
  const full = await safeExistingPath(rel || ".");
  const entries = await readdir(full, { withFileTypes: true });
  const matcher = await ignoreMatcher();
  const items: TreeEntry[] = [];
  for (const e of entries) {
    const childRel = rel && rel !== "." ? `${rel}/${e.name}` : e.name;
    const probe = e.isDirectory() ? `${childRel}/` : childRel;
    const ignored = ignore.isPathValid(probe) && matcher.ignores(probe);
    if (e.isDirectory()) {
      items.push({ name: e.name, type: "directory", path: childRel, ignored });
    } else {
      let size: number | undefined;
      try {
        size = (await stat(join(full, e.name))).size;
      } catch {
        size = undefined;
      }
      items.push({ name: e.name, type: "file", path: childRel, size, ignored });
    }
  }
  items.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
  );
  return items;
}

export interface WalkOptions {
  maxEntries?: number;
  maxDepth?: number;
  /** 无视忽略规则，用于用户显式要求在 vendor/构建产物里找东西 */
  includeIgnored?: boolean;
}

export async function walkFiles(
  startRel: string,
  opts: WalkOptions = {},
): Promise<string[]> {
  const maxEntries = opts.maxEntries ?? 20000;
  const maxDepth = opts.maxDepth ?? 12;
  const root = await safeExistingPath(startRel || ".");
  const found: string[] = [];
  const base = startRel && startRel !== "." ? startRel.replace(/\\/g, "/").replace(/\/+$/, "") : "";

  /**
   * 起点自己就被忽略时（用户显式指定了 node_modules 之类），关掉过滤：
   * 明确指名要看的地方，不该再被规则挡住。
   */
  let matcher: Ignore | null = null;
  if (!opts.includeIgnored) {
    const m = await ignoreMatcher();
    const baseProbe = base ? `${base}/` : "";
    matcher = !baseProbe || !ignore.isPathValid(baseProbe) || !m.ignores(baseProbe) ? m : null;
  }

  const queue: Array<{ full: string; rel: string; depth: number }> = [
    { full: root, rel: base, depth: 0 },
  ];
  while (queue.length > 0 && found.length < maxEntries) {
    const { full, rel, depth } = queue.shift()!;
    let entries;
    try {
      entries = await readdir(full, { withFileTypes: true });
    } catch {
      continue;
    }
    if (depth >= maxDepth) {
      for (const e of entries) {
        if (!e.isFile() || e.isSymbolicLink()) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (matcher && ignore.isPathValid(childRel) && matcher.ignores(childRel)) continue;
        found.push(childRel);
      }
      continue;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (matcher && ignore.isPathValid(`${childRel}/`) && matcher.ignores(`${childRel}/`)) continue;
        queue.push({ full: join(full, e.name), rel: childRel, depth: depth + 1 });
      } else if (e.isFile()) {
        if (matcher && ignore.isPathValid(childRel) && matcher.ignores(childRel)) continue;
        found.push(childRel);
      }
      if (found.length >= maxEntries) break;
    }
  }
  return found;
}

export function detectBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export async function readFileText(rel: string): Promise<string> {
  const full = await safeExistingPath(rel);
  const buf = await readFile(full);
  if (detectBinary(buf)) throw new Error(`二进制文件，拒绝以文本读取: ${rel}`);
  return buf.toString("utf8");
}

/* ── 访问令牌与审批策略（持久化到 <数据目录>/state/secrets.json，权限 0600） ── */

/**
 * auto   仅硬拒绝生效，不做任何询问
 * edits  写文件/编辑/批量替换放行；执行命令、删除、MCP 工具需批准
 * strict 除只读工具外全部需批准
 */
export type ApprovalMode = "auto" | "edits" | "strict";

const APPROVAL_MODES: ApprovalMode[] = ["auto", "edits", "strict"];

interface Secrets {
  token: string;
  alwaysAllow: string[];
  approvalMode: ApprovalMode;
}

let secrets: Secrets | null = null;

function normalizeMode(value: unknown): ApprovalMode {
  const raw = envValue("APPROVAL_MODE")?.trim();
  if (typeof value === "string" && APPROVAL_MODES.includes(value as ApprovalMode)) {
    return value as ApprovalMode;
  }
  if (raw && APPROVAL_MODES.includes(raw as ApprovalMode)) return raw as ApprovalMode;
  return "edits";
}

export async function loadSecrets(): Promise<Secrets> {
  if (secrets) return secrets;
  await mkdir(STATE_DIR, { recursive: true });
  if (existsSync(SECRETS_FILE)) {
    try {
      const parsed = JSON.parse(await readFile(SECRETS_FILE, "utf8")) as Partial<Secrets>;
      secrets = {
        token: typeof parsed.token === "string" && parsed.token ? parsed.token : "",
        alwaysAllow: Array.isArray(parsed.alwaysAllow)
          ? parsed.alwaysAllow.filter((x) => typeof x === "string")
          : [],
        approvalMode: normalizeMode(parsed.approvalMode),
      };
    } catch {
      secrets = null;
    }
  }
  if (!secrets || !secrets.token) {
    const { randomBytes } = await import("node:crypto");
    secrets = {
      token: randomBytes(32).toString("base64url"),
      alwaysAllow: secrets?.alwaysAllow ?? [],
      approvalMode: secrets?.approvalMode ?? normalizeMode(undefined),
    };
  }
  await saveSecrets();
  return secrets;
}

export async function saveSecrets(): Promise<void> {
  if (!secrets) return;
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(SECRETS_FILE, JSON.stringify(secrets, null, 2), { encoding: "utf8", mode: 0o600 });
}

export async function getToken(): Promise<string> {
  return (await loadSecrets()).token;
}

export async function alwaysAllowList(): Promise<string[]> {
  return (await loadSecrets()).alwaysAllow;
}

export async function rememberAlwaysAllow(key: string): Promise<void> {
  const s = await loadSecrets();
  if (!s.alwaysAllow.includes(key)) {
    s.alwaysAllow.push(key);
    await saveSecrets();
  }
}

export async function clearAlwaysAllow(key?: string): Promise<void> {
  const s = await loadSecrets();
  s.alwaysAllow = key ? s.alwaysAllow.filter((k) => k !== key) : [];
  await saveSecrets();
}

export async function getApprovalMode(): Promise<ApprovalMode> {
  return (await loadSecrets()).approvalMode;
}

export async function setApprovalMode(mode: ApprovalMode): Promise<void> {
  const s = await loadSecrets();
  s.approvalMode = mode;
  await saveSecrets();
}
