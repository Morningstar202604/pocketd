/**
 * pocketd — 独立本地开发服务器 + 编码 agent
 *
 * 架构:
 *   server.ts           HTTP/WS 接入层（路由、鉴权、静态资源）
 *   src/agent/runtime   路径沙箱、配置、密钥、目录遍历
 *   src/agent/tools     内置工具集（读写/编辑/搜索/命令/Git）
 *   src/agent/permissions  工具审批策略与往返
 *   src/agent/loop      agent 多步循环（Vercel AI SDK）
 *   src/agent/mcp       MCP 客户端（官方 SDK，HTTP + stdio）
 *   src/agent/sessions  会话持久化（node:sqlite）
 *
 * 配置 (环境变量):
 *   POCKETD_WORKSPACE / ZCODE_WORKSPACE  工作目录
 *   ZCODE_API_KEY     API Key
 *   ZCODE_API_BASE    Base URL (默认 https://api.openai.com/v1)
 *   ZCODE_API_MODEL   模型名 (默认 gpt-4o)
 *   ZCODE_PORT        HTTP 端口 (默认 3030)
 *   ZCODE_HOST        监听地址 (默认 127.0.0.1；设为 0.0.0.0 时强制令牌鉴权)
 */
import { serve } from "@hono/node-server";
import { Hono, type Context, type Next } from "hono";
import { readFile, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { ToolSet } from "ai";

import {
  HOST,
  PORT,
  WORKSPACE,
  TRASH_DIR,
  safeExistingPath,
  type TreeEntry,
  alwaysAllowList,
  clearAlwaysAllow,
  config,
  getToken,
  listDirectory,
  listTrash,
  moveToTrash,
  readFileText,
  restoreFromTrash,
  safeWritablePath,
  setApprovalMode,
  writeFileAtomic,
} from "./src/agent/runtime.js";
import { ApprovalBroker, type ApprovalRequest } from "./src/agent/permissions.js";
import { runRegistry } from "./src/agent/runs.js";
import { BRAND } from "./src/agent/brand.js";
import { createBuiltinTools, summarizeWorkspace } from "./src/agent/tools.js";
import { MCPManager, type MCPServerConfig } from "./src/agent/mcp.js";
import { SessionStore } from "./src/agent/sessions.js";
import { runAgent, type ClientMessage } from "./src/agent/loop.js";
import { replaceInProject, searchProject } from "./src/agent/search.js";
import { runGit } from "./src/agent/git.js";
import { resolveShell } from "./src/agent/shell.js";

const FRONTEND_DIST = resolve(process.cwd(), "ui", "dist");


const broker = new ApprovalBroker();
const mcp = new MCPManager(broker);
const sessions = new SessionStore();

const app = new Hono();

/* ── 鉴权：回环地址直接放行；非回环必须带令牌 ── */

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function serverAddress(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress;
}

function parseTokenCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === BRAND.tokenCookie || key === BRAND.legacyTokenCookie) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function tokenFromRequest(c: Context): Promise<string | null> {
  const header = c.req.header("x-pocketd-token") ?? c.req.header("x-zcode-token");
  if (header) return header;
  const query = c.req.query("token");
  if (query) return query;
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return parseTokenCookie(c.req.header("cookie"));
}

app.use("*", async (c, next) => {
  const addr = serverAddress(c);
  if (isLoopback(addr)) {
    await next();
    return;
  }

  const provided = await tokenFromRequest(c);
  const expected = await getToken();
  if (provided && provided === expected) {
    if (c.req.query("token")) {
      c.header(
        "set-cookie",
        `${BRAND.tokenCookie}=${encodeURIComponent(expected)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
      );
    }
    await next();
    return;
  }

  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "未授权：需要访问令牌" }, 401);
  }
  return c.text(
    [
      `${BRAND.name} 已启用访问令牌保护。`,
      "",
      `当前服务监听在 ${HOST}，来自其他设备的请求需要令牌。`,
      "在手机上打开 Settings → 访问令牌，复制后按下面的形式访问：",
      "",
      `  http://<本机IP>:${PORT}/?token=<令牌>`,
      "",
    ].join("\n"),
    401,
  );
});

/* ── 请求体大小限制 ── */

function bodyLimit(bytes: number) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const cl = c.req.header("content-length");
    if (cl && Number.parseInt(cl, 10) > bytes) {
      return c.json({ error: `请求体过大 (上限 ${Math.round(bytes / 1024 / 1024)}MB)` }, 413);
    }
    await next();
    return;
  };
}

app.use("/api/chat/stream", bodyLimit(10 * 1024 * 1024));
app.use("/api/file", bodyLimit(5 * 1024 * 1024));

function fail(c: Context, err: unknown) {
  return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
}

/* ── 配置 API ── */

app.get("/api/config", (c) => {
  return c.json({
    apiKey: config.apiKey ? "***" : "",
    apiBase: config.apiBase,
    apiModel: config.apiModel,
    temperature: config.temperature,
    workspace: WORKSPACE,
  });
});

app.post("/api/config", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  if (typeof body.apiKey === "string" && body.apiKey !== "***") config.apiKey = body.apiKey.trim();
  if (typeof body.apiBase === "string") config.apiBase = body.apiBase.replace(/\/+$/, "");
  if (typeof body.apiModel === "string") config.apiModel = body.apiModel;
  if (typeof body.temperature === "number" && Number.isFinite(body.temperature)) {
    config.temperature = Math.min(Math.max(body.temperature, 0), 2);
  }
  return c.json({ ok: true });
});

app.post("/api/config/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const base =
    typeof body.apiBase === "string" && body.apiBase ? body.apiBase.replace(/\/+$/, "") : config.apiBase;
  const model = typeof body.apiModel === "string" && body.apiModel ? body.apiModel : config.apiModel;
  const key =
    typeof body.apiKey === "string" && body.apiKey && body.apiKey !== "***"
      ? body.apiKey
      : config.apiKey;
  if (!key) return c.json({ ok: false, error: "未配置 API Key" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  timer.unref?.();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: controller.signal,
    });
    const text = res.ok ? "" : (await res.text()).slice(0, 300);
    return c.json({ ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}: ${text}` });
  } catch (err) {
    const e = err as Error;
    return c.json({ ok: false, status: 0, error: e.name === "AbortError" ? "连接超时 (15s)" : e.message });
  } finally {
    clearTimeout(timer);
  }
});

app.get("/api/auth/token", async (c) => {
  if (!isLoopback(serverAddress(c))) {
    return c.json({ error: "令牌仅在回环地址可读" }, 403);
  }
  return c.json({ token: await getToken() });
});

app.get("/api/status", async (c) => {
  return c.json({
    workspace: WORKSPACE,
    host: HOST,
    model: config.apiModel,
    apiBase: config.apiBase,
    hasApiKey: Boolean(config.apiKey),
    builtinTools: Object.keys(createBuiltinTools({ broker, runId: "probe", onApprovalRequest: () => {} })),
    mcpServers: mcp.describe(),
    mcpErrors: mcp.status(),
    pendingApprovals: broker.pendingCount,
  });
});

/* ── 文件 API ── */

app.get("/api/files", async (c) => {
  try {
    const rel = c.req.query("path") || ".";
    return c.json({ type: "directory", path: rel, items: await listDirectory(rel) });
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/file", async (c) => {
  try {
    const rel = c.req.query("path") || "";
    return c.json({ path: rel, content: await readFileText(rel) });
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/file", async (c) => {
  try {
    const { path: relPath, content } = (await c.req.json()) as { path: string; content?: string };
    const full = await safeWritablePath(relPath);
    await writeFileAtomic(full, content ?? "");
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

app.put("/api/file", async (c) => {
  try {
    const { path: relPath, content } = (await c.req.json()) as { path: string; content?: string };
    const full = await safeWritablePath(relPath);
    if (existsSync(full)) return c.json({ ok: false, error: "已存在" }, 409);
    await writeFileAtomic(full, content ?? "");
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

app.delete("/api/file", async (c) => {
  try {
    const rel = c.req.query("path") || "";
    return c.json({ ok: true, trashed: await moveToTrash(rel) });
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/trash", async (c) => {
  try {
    return c.json({ items: await listTrash() });
  } catch {
    return c.json({ items: [] });
  }
});

app.post("/api/trash/restore", async (c) => {
  try {
    const { name } = (await c.req.json()) as { name: string };
    return c.json({ ok: true, restoredTo: await restoreFromTrash(name) });
  } catch (err) {
    return fail(c, err);
  }
});

/* ── 搜索 / 替换 API ── */

app.get("/api/search", async (c) => {
  try {
    const q = c.req.query("q") || "";
    if (!q) return c.json({ results: [], filesScanned: 0, truncated: false });
    const result = await searchProject({
      query: q,
      include: c.req.query("ext") || undefined,
      regex: c.req.query("regex") === "1",
      caseSensitive: c.req.query("case") === "1",
    });
    return c.json({
      results: result.matches,
      filesScanned: result.filesScanned,
      truncated: result.truncated,
    });
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/replace", async (c) => {
  try {
    const body = (await c.req.json()) as {
      pattern?: string;
      query?: string;
      replacement?: string;
      ext?: string;
      regex?: boolean;
      dryRun?: boolean;
    };
    const query = body.query ?? body.pattern ?? "";
    const result = await replaceInProject({
      query,
      replacement: body.replacement ?? "",
      include: body.ext || undefined,
      regex: body.regex,
      dryRun: body.dryRun,
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    return fail(c, err);
  }
});

/* ── Git API ── */

const FIELD_SEP = "\u001f";

async function branchList() {
  const fmt = [
    "%(refname:short)",
    "%(HEAD)",
    "%(upstream:short)",
    "%(upstream:track)",
    "%(committerdate:relative)",
    "%(subject)",
  ].join(FIELD_SEP);
  const local = await runGit(["for-each-ref", `--format=${fmt}`, "refs/heads"]);
  const remote = await runGit(["for-each-ref", `--format=${fmt}`, "refs/remotes"]);
  const parse = (out: string, isRemote: boolean) =>
    out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, head, upstream, track, date, ...subject] = line.split(FIELD_SEP);
        return {
          name: isRemote ? name.replace(/^[^/]+\//, "") : name,
          fullName: name,
          current: head === "*",
          remote: upstream || (isRemote ? name.split("/")[0] : undefined),
          ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
          behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
          lastCommit: date || "",
          subject: subject.join(FIELD_SEP) || "",
          isRemote,
        };
      });

  const locals = parse(local.stdout, false).filter((b) => b.name !== "HEAD");
  const localNames = new Set(locals.map((b) => b.name));
  const remotes = parse(remote.stdout, true).filter(
    (b) => !b.fullName.endsWith("/HEAD") && !localNames.has(b.fullName),
  );
  return [...locals, ...remotes];
}

app.post("/api/git/init", async (c) => c.json(await runGit(["init"])));
app.get("/api/git/status", async (c) => c.json(await runGit(["status", "--porcelain=v1", "-b"])));
app.post("/api/git/add", async (c) => {
  const { files } = (await c.req.json()) as { files?: string[] };
  return c.json(await runGit(["add", ...(files?.length ? files : ["."])]));
});
app.post("/api/git/commit", async (c) => {
  const { message } = (await c.req.json()) as { message?: string };
  return c.json(await runGit(["commit", "-m", message || "update"]));
});
app.get("/api/git/log", async (c) => {
  const n = c.req.query("n") || "50";
  return c.json(await runGit(["log", "--pretty=format:%h|%an|%ad|%s", "--date=short", "-n", n]));
});
app.get("/api/git/diff", async (c) => {
  const args = ["diff", "--no-color"];
  if (c.req.query("staged") === "1") args.push("--cached");
  const file = c.req.query("path");
  if (file) args.push("--", file);
  return c.json(await runGit(args));
});
app.get("/api/git/branches", async (c) => {
  try {
    return c.json(await branchList());
  } catch {
    return c.json([]);
  }
});
app.post("/api/git/checkout", async (c) => {
  const { branch } = (await c.req.json()) as { branch: string };
  return c.json(await runGit(["checkout", branch]));
});
app.post("/api/git/branch", async (c) => {
  const { name } = (await c.req.json()) as { name: string };
  return c.json(await runGit(["branch", name]));
});
app.delete("/api/git/branch", async (c) => {
  const { name } = (await c.req.json()) as { name: string };
  return c.json(await runGit(["branch", "-D", name]));
});
app.post("/api/git/merge", async (c) => {
  const { branch } = (await c.req.json()) as { branch: string };
  return c.json(await runGit(["merge", branch]));
});
app.post("/api/git/push", async (c) => {
  const { remote, branch } = (await c.req.json()) as { remote?: string; branch?: string };
  return c.json(await runGit(["push", ...(remote ? [remote] : []), ...(branch ? [branch] : [])]));
});
app.post("/api/git/pull", async (c) => {
  const { remote, branch } = (await c.req.json()) as { remote?: string; branch?: string };
  return c.json(await runGit(["pull", ...(remote ? [remote] : []), ...(branch ? [branch] : [])]));
});
app.post("/api/git/fetch", async (c) => {
  const { remote } = (await c.req.json().catch(() => ({}))) as { remote?: string };
  return c.json(await runGit(["fetch", ...(remote ? [remote] : [])]));
});
app.get("/api/git/remotes", async (c) => c.json(await runGit(["remote", "-v"])));

/* ── MCP 管理 API ── */

app.get("/api/mcp/servers", async (c) => {
  const configs = await mcp.loadConfigs();
  const live = new Map(mcp.describe().map((s) => [s.name, s]));
  return c.json(
    configs.map((cfg) => ({
      ...cfg,
      toolCount: live.get(cfg.name)?.toolCount ?? 0,
    })),
  );
});

app.post("/api/mcp/servers", async (c) => {
  try {
    const body = (await c.req.json()) as Partial<MCPServerConfig>;
    if (!body.name) return c.json({ error: "缺少 name" }, 400);
    const type: MCPServerConfig["type"] = body.type === "stdio" ? "stdio" : "http";
    if (type === "http" && !body.url) return c.json({ error: "HTTP 服务器需要 url" }, 400);
    if (type === "stdio" && !body.command) return c.json({ error: "stdio 服务器需要 command" }, 400);

    const cfg: MCPServerConfig = {
      name: body.name,
      type,
      url: body.url,
      command: body.command,
      args: Array.isArray(body.args) ? body.args : [],
      env: body.env,
      enabled: body.enabled !== false,
    };
    const configs = (await mcp.loadConfigs()).filter((s) => s.name !== cfg.name);
    configs.push(cfg);
    await mcp.saveConfigs(configs);

    const result = await mcp.connect(cfg);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/mcp/servers/:name/toggle", async (c) => {
  const name = c.req.param("name");
  const configs = await mcp.loadConfigs();
  const target = configs.find((s) => s.name === name);
  if (!target) return c.json({ error: "未找到" }, 404);
  target.enabled = !target.enabled;
  await mcp.saveConfigs(configs);
  if (target.enabled) {
    await mcp.connect(target);
  } else {
    await mcp.disconnect(name);
  }
  return c.json({ ok: true, enabled: target.enabled });
});

app.delete("/api/mcp/servers/:name", async (c) => {
  const name = c.req.param("name");
  await mcp.disconnect(name);
  const configs = (await mcp.loadConfigs()).filter((s) => s.name !== name);
  await mcp.saveConfigs(configs);
  return c.json({ ok: true });
});

app.post("/api/mcp/reload", async (c) => c.json(await mcp.reloadAll()));

/* ── 知识库 ── */

app.get("/api/knowledge/generate", async (c) => {
  try {
    const tree = await summarizeWorkspace();
    const pkgRaw = await readFile(join(WORKSPACE, "package.json"), "utf8").catch(() => "{}");
    const readme = await readFile(join(WORKSPACE, "README.md"), "utf8").catch(() => "");
    const gitLog = await runGit(["log", "--oneline", "-n", "20"]);
    let pkg: Record<string, unknown> = {};
    try {
      pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    } catch {
      pkg = {};
    }
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };
    const lines: string[] = [
      `# 项目知识库 — ${String(pkg.name ?? "未命名项目")}`,
      "",
      `> 自动生成于 ${new Date().toLocaleString("zh-CN")}`,
      "",
      "## 工作区概况",
      "```",
      tree,
      "```",
      "",
    ];
    if (typeof pkg.description === "string" && pkg.description) {
      lines.push("## 简介", pkg.description, "");
    }
    if (readme) lines.push("## README", readme.slice(0, 4000), "");
    lines.push("## 依赖", "```json", JSON.stringify(deps, null, 2).slice(0, 3000), "```", "");
    lines.push(
      "## 最近提交",
      "```",
      gitLog.code === 0 ? gitLog.stdout.trim() || "(无提交)" : "(非 git 仓库)",
      "```",
      "",
    );
    if (pkg.scripts) {
      lines.push(
        "## npm scripts",
        ...Object.entries(pkg.scripts as Record<string, string>).map(([k, v]) => `- \`${k}\`: ${v}`),
        "",
      );
    }
    return c.json({ doc: lines.join("\n") });
  } catch (err) {
    return c.json({ doc: `# 生成失败\n\n${(err as Error).message}` });
  }
});

/* ── Agent 会话 API ── */

app.get("/api/agent/sessions", (c) => c.json(sessions.listSessions()));

app.get("/api/agent/sessions/:id", (c) => {
  const id = c.req.param("id");
  return c.json({ id, messages: sessions.getMessages(id) });
});

app.put("/api/agent/sessions/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = (await c.req.json()) as {
      title?: string;
      messages?: Array<{ role: string; payload: unknown }>;
    };
    sessions.replaceMessages(id, body.title ?? "", body.messages ?? []);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

app.delete("/api/agent/sessions/:id", (c) => {
  sessions.deleteSession(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/agent/policy", async (c) => {
  return c.json({
    mode: broker.currentMode(),
    alwaysAllow: await alwaysAllowList(),
    pendingApprovals: broker.pendingCount,
  });
});

app.post("/api/agent/policy", async (c) => {
  try {
    const { mode } = (await c.req.json()) as { mode?: string };
    if (mode !== "auto" && mode !== "edits" && mode !== "strict") {
      return c.json({ error: "mode 必须是 auto | edits | strict" }, 400);
    }
    await setApprovalMode(mode);
    await broker.setMode(mode);
    return c.json({ ok: true, mode });
  } catch (err) {
    return fail(c, err);
  }
});

app.delete("/api/agent/policy/always-allow", async (c) => {
  try {
    const { key } = (await c.req.json().catch(() => ({}))) as { key?: string };
    await clearAlwaysAllow(key);
    return c.json({ ok: true, alwaysAllow: await alwaysAllowList() });
  } catch (err) {
    return fail(c, err);
  }
});

app.post("/api/agent/approval", async (c) => {
  try {
    const { id, approved, remember } = (await c.req.json()) as {
      id: string;
      approved: boolean;
      remember?: boolean;
    };
    const result = broker.resolve(id, Boolean(approved), Boolean(remember));
    if (!result.ok) return c.json({ ok: false, error: "审批请求不存在或已超时" }, 404);
    // 同步清掉运行上的登记，避免重连的客户端看到已经处理过的待批项
    if (result.runId) runRegistry.clearApproval(result.runId, id);
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err);
  }
});

app.get("/api/agent/tools", async (c) => {
  const probeCtx = { broker, runId: "probe", onApprovalRequest: () => {} };
  const builtin = Object.entries(createBuiltinTools(probeCtx)).map(([name, t]) => ({
    name,
    description: (t as { description?: string }).description ?? "",
    source: "builtin" as const,
  }));
  const mcpTools = Object.entries(
    (await mcp.buildTools(probeCtx)) as Record<string, { description?: string }>,
  ).map(([name, t]) => ({ name, description: t.description ?? "", source: "mcp" as const }));
  return c.json({ tools: [...builtin, ...mcpTools] });
});

/* ── Agent 运行 ──
   运行由 runRegistry 持有，HTTP 连接只是订阅者。手机上锁屏/切应用/标签被回收是常态，
   断连只解除订阅，不终止运行；客户端回来时用 runId 回放事件继续看。 */

interface RunRequestBody {
  messages?: ClientMessage[];
  model?: string;
  sessionId?: string;
  maxSteps?: number;
  apiKey?: string;
  apiBase?: string;
}

function resolveRunConfig(body: RunRequestBody) {
  return {
    apiKey: body.apiKey?.trim() || config.apiKey,
    apiBase: (body.apiBase?.trim() || config.apiBase).replace(/\/+$/, ""),
    apiModel: body.model?.trim() || config.apiModel,
    temperature: config.temperature,
  };
}

/** 在后台启动一次 agent 运行，立刻返回 runId。调用方不 await。 */
function startAgentRun(opts: {
  messages: ClientMessage[];
  runConfig: ReturnType<typeof resolveRunConfig>;
  sessionId?: string;
  maxSteps?: number;
}): string {
  const runId = randomUUID();
  const handle = runRegistry.start({ runId, sessionId: opts.sessionId });

  void (async () => {
    const onApprovalRequest = (req: ApprovalRequest) => {
      // 登记到运行上，这样重连的客户端也能看到待批项
      runRegistry.trackApproval(runId, req);
      handle.emit("approval-request", req);
    };
    try {
      const builtin = createBuiltinTools({ broker, runId, onApprovalRequest });
      const mcpTools = await mcp.buildTools({ runId, onApprovalRequest });
      const tools = { ...builtin, ...mcpTools } as ToolSet;

      handle.emit("run-start", {
        runId,
        sessionId: opts.sessionId ?? null,
        tools: Object.keys(tools),
      });

      const finish = await runAgent({
        messages: opts.messages,
        tools,
        broker,
        config: opts.runConfig,
        runId,
        model: opts.runConfig.apiModel,
        emit: (event, data) => handle.emit(event, data),
        signal: handle.signal,
        maxSteps: opts.maxSteps,
      });

      if (handle.signal.aborted) {
        handle.emit("aborted", { reason: "用户取消" });
        handle.finish("cancelled");
        return;
      }

      if (finish.usage) {
        handle.emit("usage", {
          promptTokens: finish.usage.inputTokens ?? 0,
          completionTokens: finish.usage.outputTokens ?? 0,
          totalTokens: finish.usage.totalTokens ?? 0,
        });
      }
      handle.emit("run-finish", {
        runId,
        steps: finish.steps,
        toolCalls: finish.toolCalls.length,
        textLength: finish.text.length,
      });

      if (opts.sessionId) {
        try {
          const lastUser = [...opts.messages].reverse().find((m) => m.role === "user");
          const title =
            typeof lastUser?.content === "string"
              ? lastUser.content.slice(0, 60)
              : `会话 ${opts.sessionId.slice(0, 8)}`;
          sessions.upsertSession(opts.sessionId, title);
          sessions.appendMessage(opts.sessionId, Date.now(), "assistant", {
            text: finish.text,
            toolCalls: finish.toolCalls,
            usage: finish.usage,
          });
        } catch (err) {
          handle.emit("warning", { message: `会话持久化失败: ${(err as Error).message}` });
        }
      }

      handle.finish("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      handle.emit("error", { message });
      handle.finish(handle.signal.aborted ? "cancelled" : "error", message);
    }
  })();

  return runId;
}

/** 把一次运行的事件流以 SSE 返回：先回放 from 之后的事件，再转直播，运行结束即收尾。 */
function streamRun(runId: string, from: number): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let onFinish: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const writeEvent = (seq: number, event: string, data: unknown) => {
        send(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        onFinish?.();
      };
      const finish = () => {
        if (closed) return;
        send("data: [DONE]\n\n");
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* 已被客户端关掉 */
        }
      };

      const replay = runRegistry.events(runId, from);
      if (!replay) {
        send(`event: error\ndata: ${JSON.stringify({ message: "运行不存在或已回收" })}\n\n`);
        finish();
        return;
      }
      if (replay.truncated) {
        // 请求的起点已被环形缓冲丢弃，告知客户端需要重建消息
        writeEvent(0, "truncated", { from, oldest: replay.events[0]?.seq ?? null });
      }
      for (const ev of replay.events) writeEvent(ev.seq, ev.event, ev.data);
      // 回放末尾补一条状态，让客户端立刻知道待批项与运行状态
      writeEvent(replay.snapshot.lastSeq + 1, "run-status", replay.snapshot);

      if (replay.snapshot.status !== "running") {
        finish();
        return;
      }

      unsubscribe = runRegistry.subscribe(runId, (ev, snap) => {
        if (ev.event === "run-status") {
          writeEvent(snap.lastSeq + 1, "run-status", snap);
          finish();
          return;
        }
        writeEvent(ev.seq, ev.event, ev.data);
      });
      onFinish = runRegistry.onFinish(runId, finish);

      // 等审批时可能长时间没有事件，心跳避免中间层掐断空闲连接
      heartbeat = setInterval(() => send(": ping\n\n"), 20_000);
      heartbeat.unref?.();
    },
    cancel() {
      // 客户端断连：只解除订阅，运行继续
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
      onFinish?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      [BRAND.runIdHeader]: runId,
    },
  });
}

app.post("/api/chat/stream", async (c) => {
  let body: RunRequestBody;
  try {
    body = (await c.req.json()) as RunRequestBody;
  } catch {
    return c.json({ error: "请求体不是合法 JSON" }, 400);
  }

  const runConfig = resolveRunConfig(body);
  if (!runConfig.apiKey) return c.json({ error: "缺少 API Key" }, 400);

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return c.json({ error: "messages 不能为空" }, 400);

  const runId = startAgentRun({
    messages,
    runConfig,
    sessionId: body.sessionId,
    maxSteps: body.maxSteps,
  });

  return streamRun(runId, 0);
});

/* ── 运行的查询、重连与取消 ── */

app.get("/api/agent/runs", (c) => c.json({ runs: runRegistry.list(20) }));

app.get("/api/agent/runs/:id", (c) => {
  const runId = c.req.param("id");
  const from = Number(c.req.query("from") ?? 0) || 0;
  const replay = runRegistry.events(runId, from);
  if (!replay) return c.json({ error: "运行不存在或已回收" }, 404);
  return c.json(replay);
});

/** 重连：回放不丢，然后继续直播 */
app.get("/api/agent/runs/:id/stream", (c) => {
  const runId = c.req.param("id");
  const from = Number(c.req.query("from") ?? 0) || 0;
  return streamRun(runId, from);
});

app.post("/api/agent/runs/:id/cancel", (c) => {
  const ok = runRegistry.cancel(c.req.param("id"));
  if (!ok) return c.json({ ok: false, error: "运行不存在或已结束" }, 404);
  return c.json({ ok: true });
});

/* ── 终端 WebSocket ── */

let PTY: typeof import("node-pty") | null = null;
try {
  PTY = await import("node-pty");
} catch {
  console.warn("[warn] node-pty 未安装，终端不可用。Termux 下: npm i node-pty");
}

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  if (!PTY) {
    ws.send("\r\nnode-pty 未安装，终端不可用。\r\n");
    ws.close();
    return;
  }
  // 与 bash 工具共用 ADR-003 的解析顺序：POSIX shell 优先，Windows 上也是
  // bash.exe/sh.exe，PowerShell 仅作兜底。终端里模型/用户敲的同样是 POSIX 命令。
  const { bin: shell } = resolveShell();
  let term: import("node-pty").IPty;
  try {
    term = PTY.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: WORKSPACE,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "true" } as Record<string, string>,
    });
  } catch (err) {
    ws.send(`\r\n终端启动失败: ${(err as Error).message}\r\n`);
    ws.close();
    return;
  }
  term.onData((data) => {
    try {
      ws.send(data);
    } catch {
      /* socket 已关闭 */
    }
  });
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type?: string; data?: string; cols?: number; rows?: number };
      if (msg.type === "input" && typeof msg.data === "string") term.write(msg.data);
      else if (msg.type === "resize" && msg.cols && msg.rows) term.resize(msg.cols, msg.rows);
    } catch {
      term.write(raw.toString());
    }
  });
  ws.on("close", () => {
    try {
      term.kill();
    } catch {
      /* 进程已退出 */
    }
  });
});

/* ── 工作区预览：把工作区当静态站点暴露 ──
   真实场景：你在工作区里构建一个网页应用，想在手机上直接看效果。
   路径映射 /preview/<相对路径> → <工作区>/<相对路径>，目录给索引页。
   仍然走同一套路径沙箱，越界一律拒绝。 */

const PREVIEW_MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  pdf: "application/pdf",
  wasm: "application/wasm",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

/**
 * 预览不给看的东西。
 * `.git/config` 里的 remote 可能带 `https://user:token@host` —— 而预览是「看我的站点」
 * 这类会被分享出去的入口，不该成为凭据泄露路径。回收站同理会泄露已删除的内容。
 * 注意：/api/file 作为显式的文件读写接口不受此限制，这是有意的区别。
 */
const PREVIEW_BLOCKED = /^(?:\.git|\.pocketd-trash|\.zcode-trash|\.hg|\.svn|\.ssh|\.aws|\.gnupg|\.env.*)$/;

function previewBlocked(segment: string): boolean {
  return PREVIEW_BLOCKED.test(segment);
}

/** 单文件上限：预览是给人看的，几百 MB 的文件应该走下载，而不是塞进内存再吐给浏览器 */
const PREVIEW_MAX_BYTES = 64 * 1024 * 1024;

function escapeHtmlText(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** 目录索引页：用一个极简的静态列表，不依赖任何前端资源（预览时不一定有网络） */
function renderDirectoryIndex(rel: string, entries: TreeEntry[]): string {
  const joined = rel ? `${rel}/` : "";
  const parentPath = rel ? rel.split("/").slice(0, -1).join("/") : "";
  // 父目录链接也要编码：目录名里可能有空格或 #
  const parent = rel ? `<li><a href="/preview/${encodeURI(parentPath)}">../</a></li>` : "";
  const rows = entries
    .filter((e) => !previewBlocked(e.name))
    .map((e) => {
      const slash = e.type === "directory" ? "/" : "";
      const size = e.size != null ? `<span class="sz">${formatBytes(e.size)}</span>` : "";
      return `<li><a href="/preview/${encodeURI(joined + e.name)}${slash}">${escapeHtmlText(e.name)}${slash}</a>${size}</li>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtmlText("/" + joined)}</title>
<style>
  :root { color-scheme: dark light }
  body { font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 16px;
         background: Canvas; color: CanvasText }
  h1 { font-size: 15px; margin: 0 0 4px }
  p.hint { margin: 0 0 14px; font-size: 12px; opacity: .6 }
  ul { list-style: none; padding: 0; margin: 0 }
  li { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent) }
  a { color: LinkText; text-decoration: none; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
  a:hover { text-decoration: underline }
  .sz { font-size: 11px; opacity: .5; flex-shrink: 0 }
</style></head>
<body>
<h1>工作区预览 — /${escapeHtmlText(joined)}</h1>
<p class="hint">这是工作区里的真实文件，改动后刷新即可看到。点目录进入子目录。</p>
<ul>
${parent}${rows}
</ul>
</body></html>`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

app.get("/preview", (c) => c.redirect("/preview/"));

app.get("/preview/*", async (c) => {
  const url = new URL(c.req.url);
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname.replace(/^\/preview\/?/, ""));
  } catch {
    return c.text("非法路径", 400);
  }
  // 去掉结尾斜杠，交给 stat 判断是目录还是文件
  const cleaned = rel.replace(/\/+$/, "");
  // 路径里任何一段落在黑名单上就拒绝：不能只看最后一段，
  // 否则 /preview/.git/config 会绕过检查（最后一段是 config）
  if (cleaned.split("/").some(previewBlocked)) {
    return c.html(
      `<body style="font:14px ui-monospace,monospace;padding:24px;background:Canvas;color:CanvasText">
       <p>该路径不在预览范围内（版本库、回收站与凭据文件不通过预览暴露）。</p></body>`,
      403,
    );
  }
  try {
    const full = await safeExistingPath(cleaned || ".");
    const st = await stat(full);
    if (st.isDirectory()) {
      if (cleaned && !url.pathname.endsWith("/")) return c.redirect(`${url.pathname}/`);
      const entries = await listDirectory(cleaned || ".");
      return c.html(renderDirectoryIndex(cleaned, entries));
    }
    if (st.size > PREVIEW_MAX_BYTES) {
      return c.text(`文件过大，预览上限 ${PREVIEW_MAX_BYTES / 1024 / 1024}MB（可下载后本地查看）`, 413);
    }
    const data = await readFile(full);
    const ext = full.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": PREVIEW_MIME[ext] ?? "application/octet-stream",
        // 预览是开发用途：不缓存，改完刷新就能看到
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return c.html(
      `<body style="font:14px ui-monospace,monospace;padding:24px;background:Canvas;color:CanvasText">
       <p>无法预览：${escapeHtmlText((err as Error).message)}</p>
       <p style="opacity:.6">路径只能落在工作区内。</p></body>`,
      404,
    );
  }
});

/** 原始文件：给界面做图片/二进制预览用，不做文本解码 */
app.get("/api/file/raw", async (c) => {
  try {
    const rel = c.req.query("path") ?? "";
    const full = await safeExistingPath(rel);
    const st = await stat(full);
    if (!st.isFile()) return c.json({ error: "不是文件" }, 400);
    if (st.size > PREVIEW_MAX_BYTES) {
      return c.text(`文件过大（上限 ${PREVIEW_MAX_BYTES / 1024 / 1024}MB）`, 413);
    }
    const data = await readFile(full);
    const ext = full.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": PREVIEW_MIME[ext] ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return fail(c, err);
  }
});

/* ── 静态资源（SPA） ── */

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  html: "text/html; charset=utf-8",
  webmanifest: "application/manifest+json",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  wasm: "application/wasm",
  txt: "text/plain; charset=utf-8",
  woff2: "font/woff2",
  woff: "font/woff",
  map: "application/json",
};

if (existsSync(join(FRONTEND_DIST, "index.html"))) {
  const distRoot = resolve(FRONTEND_DIST);
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith("/api/")) return c.notFound();
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return c.notFound();
    }
    const filePath = resolve(join(distRoot, decoded));
    if (filePath !== distRoot && !filePath.startsWith(distRoot + sep)) return c.notFound();
    try {
      const st = await stat(filePath);
      if (st.isFile()) {
        const data = await readFile(filePath);
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        return new Response(new Uint8Array(data), {
          headers: {
            "content-type": MIME[ext] ?? "application/octet-stream",
            "cache-control": /-[A-Za-z0-9_-]{8}\./.test(decoded)
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          },
        });
      }
    } catch {
      /* 落到 SPA 入口 */
    }
    const html = await readFile(join(FRONTEND_DIST, "index.html"));
    return new Response(new Uint8Array(html), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
    });
  });
} else {
  app.get("*", (c) => c.text("请先构建前端: npm run build (in ui/)", 503));
}

/* ── 启动 ── */

async function startup(): Promise<void> {
  await mkdir(WORKSPACE, { recursive: true });
  await mkdir(TRASH_DIR, { recursive: true });
  await broker.prime();
  await getToken();
  if (!existsSync(join(WORKSPACE, ".git"))) {
    await runGit(["init"]);
  }
  const results = await mcp.reloadAll();
  for (const r of results) {
    if (r.error) console.warn(`[mcp] ${r.name} 连接失败: ${r.error}`);
  }
}

startup()
  .then(() => {
    const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
      console.log("");
      console.log(`${BRAND.nameZh} (${BRAND.name}) — 本地开发服务器 + 编码 agent`);
      console.log(`  工作区:   ${WORKSPACE}`);
      console.log(`  地址:     http://${HOST}:${PORT}`);
      console.log(`  模型:     ${config.apiModel} @ ${config.apiBase}`);
      console.log(`  MCP 工具: ${mcp.toolCount}`);
      console.log(
        HOST === "127.0.0.1"
          ? "  监听:     仅本机（如需局域网访问，设置 POCKETD_HOST=0.0.0.0（旧名 ZCODE_HOST 也兼容）并使用访问令牌）"
          : "  监听:     所有网卡（已强制令牌鉴权，令牌见 Settings → 访问令牌）",
      );
      console.log("");
    });
    server.on("upgrade", (req, socket, head) => {
      void (async () => {
        if (req.url?.split("?")[0] !== "/ws/terminal") {
          socket.destroy();
          return;
        }
        const addr = req.socket.remoteAddress;
        if (!isLoopback(addr)) {
          const expected = await getToken();
          const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
          const provided = url.searchParams.get("token") ?? parseTokenCookie(req.headers.cookie);
          if (provided !== expected) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      })();
    });
  })
  .catch((err) => {
    console.error("[fatal]", err);
    process.exit(1);
  });
