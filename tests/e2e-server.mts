/**
 * 端到端验证：真实 pocketd 服务 + 真实 stdio MCP + 交互式审批 + SSE 事件契约。
 *
 * 流程：假 LLM 上游先要求调用 MCP 工具 → 本脚本以 SSE 消费方身份批准 →
 * 观察工具真实执行（大写转换）→ 上游收到结果后产出最终文本。
 * 另含「断连 → 重连 → 从新连接完成审批」场景（手机锁屏/标签被回收）。
 *
 * 用法: node --import tsx tests/e2e-server.mts
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

/**
 * 动态取空闲端口。用固定端口时，上一次运行残留的进程会占住它，那种失败
 * 看起来像「服务启动不了」，实际是环境问题——排查成本高且有误导性。
 * 注意 listen 是异步的，必须等地址真的绑定后才能读端口。
 */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.on("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      probe.close(() => (port ? res(port) : rej(new Error("无法获取空闲端口"))));
    });
  });
}

const PORT = await freePort();
const UPSTREAM_PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const fixture = resolve("tests/fixtures/mcp-echo-server.mjs");

let turn = 0;
let upstreamSawToolResult = false;

const upstream = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    const body = JSON.parse(raw || "{}") as { messages: Array<Record<string, unknown>> };
    turn += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) =>
      res.write(
        `data: ${JSON.stringify({
          id: "c",
          object: "chat.completion.chunk",
          created: 0,
          model: "fake",
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...(usage ? { usage } : {}),
        })}\n\n`,
      );

    if (turn === 1) {
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_mcp_1",
            type: "function",
            function: { name: "mcp__echo-probe__shout", arguments: '{"text":"hello mcp"}' },
          },
        ],
      });
      chunk({}, "tool_calls");
    } else {
      const toolMsg = body.messages.find((m) => m.role === "tool");
      upstreamSawToolResult = Boolean(toolMsg);
      chunk({ content: `MCP 工具返回：${String(toolMsg?.content ?? "(空)")}。` });
      chunk({}, "stop", { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

/**
 * 等服务就绪。预算是 60 秒而不是 15 秒：`tsx` 冷启动 + sqlite + MCP 初始化在负载高的机器上
 * （CI 少核、或本机同时在跑 vite build）会明显变慢，预算太紧会变成随机失败——
 * 那种失败看起来像功能坏了，实际只是等不够。
 */
function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const tick = () => {
      fetch(url)
        .then(() => resolvePromise())
        .catch((err: Error) => {
          if (Date.now() > deadline) {
            reject(new Error(`服务未在 ${timeoutMs / 1000}s 内就绪（最后错误：${err.message}）`));
            return;
          }
          setTimeout(tick, 250);
        });
    };
    tick();
  });
}

const server = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
  env: {
    ...process.env,
    ZCODE_PORT: String(PORT),
    POCKETD_WORKSPACE: resolve(".pocketd-e2e-ws"),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const serverLog: string[] = [];
server.stdout?.on("data", (d) => serverLog.push(String(d)));
server.stderr?.on("data", (d) => serverLog.push(String(d)));

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`${cond ? "  OK  " : " FAIL "} ${label}`);
  if (!cond) failures.push(label);
}

try {
  await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, "127.0.0.1", r));
  await waitForServer(`${BASE}/api/status`);
  console.log(`服务已就绪 :${PORT}\n`);

  const reg = await fetch(`${BASE}/api/mcp/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "echo-probe", type: "stdio", command: "node", args: [fixture] }),
  }).then((r) => r.json() as Promise<{ tools?: number; error?: string }>);
  check(reg.tools === 2, `注册 stdio MCP 服务器，发现 2 个工具（实际 ${reg.tools}）${reg.error ?? ""}`);

  const toolsRes = (await fetch(`${BASE}/api/agent/tools`).then((r) => r.json())) as {
    tools: Array<{ name: string; source: string }>;
  };
  const mcpNames = toolsRes.tools.filter((t) => t.source === "mcp").map((t) => t.name);
  check(
    mcpNames.includes("mcp__echo-probe__shout"),
    `MCP 工具暴露给模型: ${JSON.stringify(mcpNames)}`,
  );
  check(
    mcpNames.every((n) => /^[a-zA-Z0-9_-]{1,64}$/.test(n)),
    "MCP 工具名符合 OpenAI 函数名规范（无 :: 等非法字符）",
  );

  const policy = (await fetch(`${BASE}/api/agent/policy`).then((r) => r.json())) as { mode: string };
  check(policy.mode === "edits", `默认审批策略为 edits（实际 ${policy.mode}）`);

  const seen = new Set<string>();
  let approvalHandled = false;

  const resp = await fetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "用 MCP 工具喊一句话" }],
      sessionId: "e2e-session",
      apiKey: "test-key",
      apiBase: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
      model: "fake",
    }),
  });
  check(resp.headers.get("content-type")?.includes("text/event-stream") === true, "响应为 SSE 流");

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const evLine = rawEvent.split("\n").find((l) => l.startsWith("event:"));
      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
      if (!evLine || !dataLine) continue;
      const event = evLine.slice(6).trim();
      const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
      seen.add(event);

      if (event === "approval-request") {
        check(data.tool === "mcp__echo-probe__shout", `审批请求针对 MCP 工具（${String(data.tool)}）`);
        const answered = await fetch(`${BASE}/api/agent/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: data.id, approved: true }),
        }).then((r) => r.json() as Promise<{ ok?: boolean }>);
        approvalHandled = true;
        check(answered.ok === true, "批准请求被服务端接受");
      }
      if (event === "tool-result") {
        check(
          String(data.output).includes("HELLO MCP"),
          `MCP 工具真实执行并返回大写结果（${String(data.output).slice(0, 40)}）`,
        );
      }
      if (event === "usage") {
        check(data.totalTokens === 29, `usage 事件携带真实用量（${String(data.totalTokens)}）`);
      }
      if (dataLine.includes("[DONE]")) done = true;
    }
  }

  for (const expected of ["run-start", "step", "tool-call", "tool-result", "message", "usage", "run-finish"]) {
    check(seen.has(expected), `SSE 事件契约包含 ${expected}`);
  }
  check(approvalHandled, "审批往返在流式过程中完成");
  check(upstreamSawToolResult, "上游第二轮请求收到了 role:tool 消息");
  check(turn === 2, `上游共被调用 2 轮（实际 ${turn}）`);

  const hist = (await fetch(`${BASE}/api/agent/sessions/e2e-session`).then((r) => r.json())) as {
    messages: unknown[];
  };
  check(hist.messages.length > 0, "会话已持久化到服务端");
  const listed = (await fetch(`${BASE}/api/agent/sessions`).then((r) => r.json())) as unknown[];
  check(listed.length > 0, "会话列表可查询");

  /* ─────────────────────────────────────────────────────────────
     场景：跑到一半客户端断连（手机锁屏 / 标签被回收），之后重连继续。
     这是「手机 agent」定位能否成立的分水岭：运行不能随连接消失。
     ───────────────────────────────────────────────────────────── */

  console.log("\n--- 断连重连场景 ---");

  // 用 afterResume 会话，确保上游从第 1 轮开始重新走工具流程
  const openStream = async (url: string) =>
    fetch(url, {
      method: url.includes("/chat/stream") ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: url.includes("/chat/stream")
        ? JSON.stringify({
            messages: [{ role: "user", content: "用 MCP 工具喊一句话" }],
            sessionId: "e2e-resume",
            apiKey: "test-key",
            apiBase: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
            model: "fake",
          })
        : undefined,
    });

  const readEvents = async (
    resp: Response,
    stopAfter: (event: string, data: Record<string, unknown>) => boolean,
    onEvent?: (event: string, data: Record<string, unknown>) => void,
  ) => {
    const reader = resp.body!.getReader();
    const dec = new TextDecoder();
    let buffer = "";
    const events: Array<{ event: string; data: Record<string, unknown>; seq: number }> = [];
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += dec.decode(value, { stream: true });
      let at: number;
      let stop = false;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const evLine = raw.split("\n").find((l) => l.startsWith("event:"));
        const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
        const idLine = raw.split("\n").find((l) => l.startsWith("id:"));
        if (!evLine || !dataLine) continue;
        if (dataLine.includes("[DONE]")) return { events, reader };
        const event = evLine.slice(6).trim();
        const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        const seq = idLine ? Number(idLine.slice(3).trim()) : -1;
        events.push({ event, data, seq });
        onEvent?.(event, data);
        if (stopAfter(event, data)) stop = true;
      }
      if (stop) return { events, reader };
    }
    return { events, reader };
  };

  turn = 0;
  const first = await openStream(`${BASE}/api/chat/stream`);
  const runIdFromHeader = first.headers.get("x-pocketd-run-id");
  check(Boolean(runIdFromHeader), `响应头带 runId（${runIdFromHeader}）`);

  let pendingApprovalId = "";
  const firstPass = await readEvents(
    first,
    (event, data) => {
      if (event === "approval-request") pendingApprovalId = String(data.id);
      // 一看到审批请求就"关掉标签页"
      return event === "approval-request";
    },
  );
  check(Boolean(pendingApprovalId), "首轮连接在审批处停下");
  // 模拟锁屏 / 标签被回收：直接放弃读取，取消底层连接
  await firstPass.reader.cancel().catch(() => {});
  check(true, "客户端断连（未批准，未取消运行）");

  // 断连后运行必须仍然活着
  await new Promise((r) => setTimeout(r, 800));
  const runState = (await fetch(`${BASE}/api/agent/runs/${runIdFromHeader}`).then((r) => r.json())) as {
    snapshot: { status: string; pendingApprovals: Array<{ id: string; tool: string }> };
  };
  check(runState.snapshot.status === "running", `断连后运行仍在进行（${runState.snapshot.status}）`);
  check(
    runState.snapshot.pendingApprovals.some((a) => a.id === pendingApprovalId),
    "断连后待批审批仍可查询（重连能看见）",
  );

  // 重连：单条流，回放 + 直播；在回放中看到审批请求就当作「用户在重连后的界面里点了批准」
  const reattach = await fetch(`${BASE}/api/agent/runs/${runIdFromHeader}/stream?from=0`);
  const replayedKinds: string[] = [];
  let approvePosted: Promise<{ ok?: boolean }> | null = null;
  const resumeStart = Date.now();

  const resumed = await readEvents(reattach, () => false, (event, data) => {
    replayedKinds.push(event);
    if (event === "approval-request" && !approvePosted) {
      pendingApprovalId = String(data.id);
      approvePosted = fetch(`${BASE}/api/agent/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pendingApprovalId, approved: true }),
      }).then((r) => r.json() as Promise<{ ok?: boolean }>);
    }
  });

  check(replayedKinds.includes("run-start"), "重连回放包含 run-start（未丢历史）");
  check(replayedKinds.includes("approval-request"), "重连回放包含审批请求");
  check(approvePosted !== null, "重连后能看到并处理待批项");
  check((await approvePosted!)?.ok === true, "从重连的连接完成审批");
  check(Date.now() - resumeStart < 30_000, "重连后运行在合理时间内收尾");

  const kinds = new Set(replayedKinds);
  check(
    resumed.events.some(
      (e) => e.event === "tool-result" && String(e.data.output).includes("HELLO MCP"),
    ),
    "重连后工具真实执行完成",
  );
  check(kinds.has("run-finish"), "重连后运行正常收尾");

  const finalState = (await fetch(`${BASE}/api/agent/runs/${runIdFromHeader}`).then((r) => r.json())) as {
    snapshot: { status: string; toolCalls: number };
  };
  check(
    finalState.snapshot.status === "done",
    `运行最终状态为 done（${finalState.snapshot.status}）`,
  );
  check(finalState.snapshot.toolCalls >= 1, `运行记录了工具调用次数（${finalState.snapshot.toolCalls}）`);

  /* ─────────────────────────────────────────────────────────────
     预览（把工作区当静态站点）：功能可用 + 不暴露不该暴露的东西
     ───────────────────────────────────────────────────────────── */

  console.log("\n--- 工作区预览 ---");

  const { writeFileSync, mkdirSync, rmSync } = await import("node:fs");
  const wsRoot = resolve(".pocketd-e2e-ws");
  mkdirSync(resolve(wsRoot, ".git"), { recursive: true });
  // 模拟真实仓库里可能存在的凭据：remote URL 带 token
  writeFileSync(
    resolve(wsRoot, ".git", "config"),
    ['[remote "origin"]', "\turl = https://user:ghp_SECRETTOKEN@github.com/x/y.git", ""].join("\n"),
  );
  mkdirSync(resolve(wsRoot, "site"), { recursive: true });
  writeFileSync(resolve(wsRoot, "site", "index.html"), "<h1>preview works</h1>");
  writeFileSync(resolve(wsRoot, "site", "app.js"), "console.log('ok')");

  const index = await fetch(`${BASE}/preview/`).then((r) => r.text());
  check(index.includes("site/"), "预览目录索引列出了工作区里的目录");
  check(!index.includes('href="/preview/.git/"'), "索引里不出现 .git 条目");
  check(!index.includes('href="/preview/.pocketd-trash/"'), "索引里不出现回收站条目");
  check(!index.includes('href="/preview/.zcode-trash/"'), "索引里不出现旧品牌回收站条目");

  const blockedGit = await fetch(`${BASE}/preview/.git/config`);
  const blockedBody = await blockedGit.text();
  check(blockedGit.status === 403, `直接请求 .git/config 被拒绝（${blockedGit.status}）`);
  check(!blockedBody.includes("ghp_SECRETTOKEN"), "响应体不含仓库凭据");

  const blockedTrash = await fetch(`${BASE}/preview/.pocketd-trash/`);
  check(blockedTrash.status === 403, `回收站不通过预览暴露（${blockedTrash.status}）`);

  const servedHtml = await fetch(`${BASE}/preview/site/index.html`);
  const servedHtmlText = await servedHtml.text();
  check(servedHtml.status === 200, "工作区里的静态文件可正常预览");
  check(servedHtmlText.includes("preview works"), "预览返回的是文件真实内容");
  check(
    servedHtml.headers.get("content-type")?.includes("text/html") === true,
    "HTML 的 content-type 正确",
  );

  const servedJs = await fetch(`${BASE}/preview/site/app.js`);
  check(
    servedJs.headers.get("content-type")?.includes("javascript") === true,
    "JS 的 content-type 正确（相对资源才能被浏览器执行）",
  );

  const escapedPreview = await fetch(`${BASE}/preview/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
  check(escapedPreview.status === 404 || escapedPreview.status === 403, "编码的路径穿越被拒绝");

  const rawImage = await fetch(`${BASE}/api/file/raw?path=site/index.html`);
  check(rawImage.status === 200, "raw 端点可读文件");

  /* ─────────────────────────────────────────────────────────────
     忽略规则：真实服务器进程里 /api/files 要带上 ignored 标记，
     且改 .gitignore 后无需重启即生效（界面灰显依赖这个字段）
     ───────────────────────────────────────────────────────────── */

  console.log("\n--- 忽略规则 ---");

  // e2e 工作区跨轮保留，先把规则文件清掉，建立确定基线
  rmSync(resolve(wsRoot, ".gitignore"), { force: true });
  rmSync(resolve(wsRoot, ".pocketdignore"), { force: true });
  rmSync(resolve(wsRoot, ".zcodeignore"), { force: true });

  const ignoredDir = resolve(wsRoot, "ignored-dir");
  mkdirSync(ignoredDir, { recursive: true });
  writeFileSync(resolve(ignoredDir, "secret.txt"), "should not be searched");
  writeFileSync(resolve(wsRoot, "visible.txt"), "should be searchable");

  const filesBefore = (await fetch(`${BASE}/api/files?path=.`).then((r) => r.json())) as {
    items: Array<{ name: string; ignored?: boolean }>;
  };
  const dirBefore = filesBefore.items.find((i) => i.name === "ignored-dir");
  check(Boolean(dirBefore), "忽略规则加载前，目录正常列出");
  check(!dirBefore?.ignored, "没有规则文件时不该标记为忽略");

  writeFileSync(resolve(wsRoot, ".gitignore"), "ignored-dir/\n");

  // 刻意不重启服务器：验证 mtime 指纹能自动发现规则变化
  const filesAfter = (await fetch(`${BASE}/api/files?path=.`).then((r) => r.json())) as {
    items: Array<{ name: string; ignored?: boolean }>;
  };
  const dirAfter = filesAfter.items.find((i) => i.name === "ignored-dir");
  const visibleAfter = filesAfter.items.find((i) => i.name === "visible.txt");
  check(dirAfter?.ignored === true, "写入 .gitignore 后无需重启，目录被标记为忽略");
  check(!visibleAfter?.ignored, "未命中规则的条目不被误标");
  check(
    filesAfter.items.some((i) => i.name === "ignored-dir"),
    "被忽略的目录仍要出现在列表里——用户得能点进去看",
  );

  /* ─────────────────────────────────────────────────────────────
     取消也是运行级的，不是连接级的
     ───────────────────────────────────────────────────────────── */

  turn = 0;
  const toCancel = await openStream(`${BASE}/api/chat/stream`);
  const cancelRunId = toCancel.headers.get("x-pocketd-run-id");
  const cancelPass = await readEvents(toCancel, (event) => event === "approval-request");
  check(Boolean(cancelRunId), "第二次运行拿到独立 runId");
  await cancelPass.reader.cancel().catch(() => {});
  const cancelled = await fetch(`${BASE}/api/agent/runs/${cancelRunId}/cancel`, { method: "POST" }).then(
    (r) => r.json() as Promise<{ ok?: boolean }>,
  );
  check(cancelled.ok === true, "可以显式取消一个仍在等待的运行");
  await new Promise((r) => setTimeout(r, 500));
  const afterCancel = (await fetch(`${BASE}/api/agent/runs/${cancelRunId}`).then((r) => r.json())) as {
    snapshot: { status: string };
  };
  check(
    afterCancel.snapshot.status === "cancelled",
    `取消后状态为 cancelled（${afterCancel.snapshot.status}）`,
  );
} catch (err) {
  failures.push(`异常: ${(err as Error).message}`);
  console.error(err);
} finally {
  server.kill();
  upstream.close();
  await new Promise((r) => setTimeout(r, 300));
}

console.log("\n" + "=".repeat(50));
if (failures.length === 0) {
  console.log("端到端验证：全部通过");
  process.exit(0);
}
console.log(`端到端验证：${failures.length} 项失败`);
for (const f of failures) console.log(" - " + f);
console.log("\n服务端日志尾部:\n" + serverLog.join("").split("\n").slice(-15).join("\n"));
process.exit(1);
