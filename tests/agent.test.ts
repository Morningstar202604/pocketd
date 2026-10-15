/**
 * Agent 工具层与权限门控的回归测试。
 * 运行: npm test
 *
 * 用假上游替代真实 LLM，验证：消息转换、多步工具循环、审批往返、SSE 事件契约、usage 统计。
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sandbox = await mkdtemp(join(tmpdir(), "pocketd-smoke-"));
process.env.HOME = join(sandbox, "home");
process.env.USERPROFILE = process.env.HOME;
process.env.ZCODE_WORKSPACE = join(sandbox, "ws");
await mkdir(process.env.ZCODE_WORKSPACE, { recursive: true });
await mkdir(process.env.HOME, { recursive: true });

const { createBuiltinTools, runShell } = await import("../src/agent/tools.js");
const { ApprovalBroker } = await import("../src/agent/permissions.js");
const { runAgent, boundHistory } = await import("../src/agent/loop.js");
const { searchProject, replaceInProject } = await import("../src/agent/search.js");
const { moveToTrash, restoreFromTrash, listTrash, safeExistingPath, walkFiles, listDirectory } = await import(
  "../src/agent/runtime.js"
);
const { isIgnored, resetIgnoreCache } = await import("../src/agent/ignore.js");
const { resolveShell, resetShellCache } = await import("../src/agent/shell.js");

interface Ctx {
  broker: InstanceType<typeof ApprovalBroker>;
  runId: string;
  requests: unknown[];
}

function makeCtx(): Ctx {
  return { broker: new ApprovalBroker(5_000), runId: "test", requests: [] };
}

function toolsFor(ctx: Ctx, onApproval = () => {}) {
  return createBuiltinTools({
    broker: ctx.broker,
    runId: ctx.runId,
    onApprovalRequest: (req) => {
      ctx.requests.push(req);
      onApproval();
    },
  });
}

async function call(t: unknown, input: unknown): Promise<string> {
  const exec = (t as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute;
  return String(await exec(input, {}));
}

describe("内置工具", () => {
  it("write_file → read_file 往返，且带行号", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);

    const written = await call(t.write_file, { path: "demo/a.txt", content: "第一行\n第二行\n第三行" });
    assert.match(written, /已写入 demo\/a\.txt/);

    const read = await call(t.read_file, { path: "demo/a.txt" });
    assert.match(read, /1│ 第一行/);
    assert.match(read, /3│ 第三行/);
    assert.match(read, /共 3 行/);
  });

  it("read_file 支持 offset/limit 分页", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "demo/long.txt", content: Array.from({ length: 50 }, (_, i) => `line-${i + 1}`).join("\n") });
    const page = await call(t.read_file, { path: "demo/long.txt", offset: 10, limit: 3 });
    assert.match(page, /10│ line-10/);
    assert.match(page, /12│ line-12/);
    assert.doesNotMatch(page, /13│ line-13/);
  });

  it("edit_file 精确替换，多处匹配时拒绝并要求 replace_all", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "demo/b.txt", content: "foo bar foo" });

    const ambiguous = await call(t.edit_file, { path: "demo/b.txt", old_string: "foo", new_string: "baz" });
    assert.match(ambiguous, /「失败」/);
    assert.match(ambiguous, /出现 2 次/);

    const ok = await call(t.edit_file, { path: "demo/b.txt", old_string: "foo", new_string: "baz", replace_all: true });
    assert.match(ok, /已替换 2 处/);
    assert.equal(await readFile(join(process.env.ZCODE_WORKSPACE!, "demo/b.txt"), "utf8"), "baz bar baz");
  });

  it("edit_file 找不到目标时给出明确失败而不是静默", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "demo/c.txt", content: "hello" });
    const res = await call(t.edit_file, { path: "demo/c.txt", old_string: "nope", new_string: "x" });
    assert.match(res, /未找到 old_string/);
  });

  it("路径穿越被拒绝", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await assert.rejects(() => call(t.read_file, { path: "../../../etc/passwd" }), /路径越界/);
    await assert.rejects(() => call(t.write_file, { path: "../evil.txt", content: "x" }), /路径越界/);
  });

  it("符号链接逃逸被拒绝", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    const outside = join(sandbox, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "secret");
    const linkPath = join(process.env.ZCODE_WORKSPACE!, "link");
    try {
      await symlink(outside, linkPath, "junction");
    } catch {
      return;
    }
    await assert.rejects(() => call(t.read_file, { path: "link/secret.txt" }), /路径越界/);
  });

  it("glob 与 grep 返回结构化结果", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "src/x.ts", content: "const answer = 42;\n// note: a:b:c\n" });
    await call(t.write_file, { path: "src/y.md", content: "answer is here\n" });

    const globbed = await call(t.glob, { pattern: "src/**/*.ts" });
    assert.match(globbed, /src\/x\.ts/);
    assert.doesNotMatch(globbed, /src\/y\.md/);

    const found = await call(t.grep, { query: "answer" });
    assert.match(found, /src\/x\.ts:1:7:/);
    assert.match(found, /src\/y\.md:1:1:/);
  });

  it("grep 对含冒号的匹配行不解析错乱", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "src/colon.ts", content: 'const url = "http://a:8080/b";\n' });
    const res = await call(t.grep, { query: "http://a:8080" });
    assert.match(res, /src\/colon\.ts:1:14: const url = "http:\/\/a:8080\/b";/);
  });

  it("bash 执行真实命令并回传退出码", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx, () => {
      setImmediate(() => {
        const req = ctx.requests.at(-1) as { id: string };
        ctx.broker.resolve(req.id, true, false);
      });
    });
    const out = await call(t.bash, { command: "echo hello-from-shell" });
    assert.match(out, /hello-from-shell/);
    assert.match(out, /\[退出码 0\]/);
  });

  it("bash 硬拒绝命令连审批都不弹", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    const out = await call(t.bash, { command: "rm -rf /" });
    assert.match(out, /「已拒绝」/);
    assert.equal(ctx.requests.length, 0);
  });

  it("bash 超时被终止", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx, () => {
      setImmediate(() => {
        const req = ctx.requests.at(-1) as { id: string };
        ctx.broker.resolve(req.id, true, false);
      });
    });
    const out = await call(t.bash, { command: "sleep 5", timeout_ms: 1200 });
    assert.match(out, /超时被终止/);
  });

  it("read_file 拒绝读取二进制文件", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await writeFile(join(process.env.ZCODE_WORKSPACE!, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0xff]));
    await assert.rejects(() => call(t.read_file, { path: "bin.dat" }), /二进制文件/);
  });
});

describe("权限门控", () => {
  it("只读工具不需要审批", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "demo/r.txt", content: "x" });
    ctx.requests.length = 0;
    await call(t.read_file, { path: "demo/r.txt" });
    await call(t.list_dir, { path: "." });
    await call(t.git_status, {});
    assert.equal(ctx.requests.length, 0);
  });

  it("拒绝后工具返回拒绝说明，模型可据此调整", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx, () => {
      setImmediate(() => {
        const req = ctx.requests.at(-1) as { id: string };
        ctx.broker.resolve(req.id, false, false);
      });
    });
    const out = await call(t.bash, { command: "echo should-not-run" });
    assert.match(out, /「已拒绝」/);
    assert.doesNotMatch(out, /should-not-run\n/);
  });

  it("审批超时按拒绝处理（fail closed）", async () => {
    const ctx = makeCtx();
    ctx.broker = new ApprovalBroker(300);
    const t = toolsFor(ctx);
    const started = Date.now();
    const out = await call(t.bash, { command: "echo timeout-case" });
    assert.match(out, /「已拒绝」/);
    assert.ok(Date.now() - started < 3000, "超时应快速返回");
  });

  it("remember 使后续同类命令免审批", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx, () => {
      setImmediate(() => {
        const req = ctx.requests.at(-1) as { id: string };
        ctx.broker.resolve(req.id, true, true);
      });
    });
    await call(t.bash, { command: "echo first" });
    const afterFirst = ctx.requests.length;
    await call(t.bash, { command: "echo second" });
    assert.equal(ctx.requests.length, afterFirst, "第二次不应再弹审批");
  });
});

describe("搜索与替换", () => {
  it("search 返回行列号且不受内容冒号影响", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "s/one.txt", content: "alpha\nbeta:gamma\n" });
    const result = await searchProject({ query: "beta:gamma" });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].path, "s/one.txt");
    assert.equal(result.matches[0].line, 2);
  });

  it("replace 字面量与正则语义一致", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "s/two.txt", content: "a.b a.b aXb" });

    const literal = await replaceInProject({ query: "a.b", replacement: "Z", path: "s", dryRun: true });
    assert.equal(literal.totalMatches, 2, "字面量模式不应把 . 当通配符");

    const regex = await replaceInProject({
      query: "a.b",
      replacement: "Z",
      regex: true,
      path: "s",
      dryRun: true,
    });
    assert.equal(regex.totalMatches, 3, "正则模式下 . 应匹配任意字符");
  });

  it("replace dryRun 不落盘", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "s/three.txt", content: "keep me" });
    await replaceInProject({ query: "keep", replacement: "drop", path: "s", dryRun: true });
    assert.equal(await readFile(join(process.env.ZCODE_WORKSPACE!, "s/three.txt"), "utf8"), "keep me");
  });
});

describe("忽略规则", () => {
  const ws = () => process.env.ZCODE_WORKSPACE!;
  const ignoreFile = (name: string) => join(ws(), name);
  const cleanIgnoreFiles = async () => {
    for (const f of [".gitignore", ".pocketdignore", ".zcodeignore"]) {
      await rm(ignoreFile(f), { force: true });
    }
    resetIgnoreCache();
  };
  const seed = async (rel: string, content = "needle") => {
    await mkdir(join(ws(), rel.split("/").slice(0, -1).join("/")), { recursive: true });
    await writeFile(join(ws(), rel), content);
  };

  before(cleanIgnoreFiles);
  after(cleanIgnoreFiles);

  it("无任何规则文件时，回收站与 .git 仍然不进遍历结果", async () => {
    await cleanIgnoreFiles();
    await seed("always/keep.txt");
    await seed(".pocketd-trash/junk.txt");
    await seed(".zcode-trash/old.txt");
    await seed(".git/config");
    const files = await walkFiles(".");
    assert.ok(files.includes("always/keep.txt"), "普通文件应被收录");
    assert.ok(!files.some((f) => f.includes("trash")), `回收站不得进入遍历: ${files}`);
    assert.ok(!files.some((f) => f.startsWith(".git/")), `.git 不得进入遍历: ${files}`);
  });

  it(".gitignore 生效，且取反规则能把文件救回来", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".gitignore"), "*.log\n!keep.log\n");
    await seed("logs/a.log", "needle");
    await seed("logs/keep.log", "needle");
    resetIgnoreCache();
    const files = await walkFiles(".");
    assert.ok(!files.includes("logs/a.log"), "被 *.log 忽略");
    assert.ok(files.includes("logs/keep.log"), "!keep.log 应把它救回来");
  });

  it("带斜杠的目录型规则只命中目录，不命中同名文件", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".gitignore"), "build/\n");
    await seed("build/out.js", "needle");
    await seed("pkg/build", "needle");
    resetIgnoreCache();
    const files = await walkFiles(".");
    assert.ok(!files.includes("build/out.js"), "build/ 目录下的文件应被忽略");
    assert.ok(files.includes("pkg/build"), "目录型规则不该误伤同名的普通文件");
  });

  it("后面的规则文件能取反前面的规则", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".gitignore"), "*.log\n");
    await writeFile(ignoreFile(".pocketdignore"), "!important.log\n");
    await seed("logs/important.log", "needle");
    await seed("logs/noisy.log", "needle");
    resetIgnoreCache();
    const files = await walkFiles(".");
    assert.ok(files.includes("logs/important.log"), ".pocketdignore 的取反应覆盖 .gitignore");
    assert.ok(!files.includes("logs/noisy.log"), "未被取反的仍按 .gitignore 忽略");
  });

  it(".pocketdignore 在 .gitignore 之上追加规则", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".gitignore"), "*.tmp\n");
    await writeFile(ignoreFile(".pocketdignore"), "secret/\n");
    await seed("secret/keys.txt", "needle");
    await seed("cache/x.tmp", "needle");
    await seed("src/ok.txt", "needle");
    resetIgnoreCache();
    const files = await walkFiles(".");
    assert.ok(!files.includes("secret/keys.txt"), ".pocketdignore 的规则应生效");
    assert.ok(!files.includes("cache/x.tmp"), ".gitignore 的规则仍生效");
    assert.ok(files.includes("src/ok.txt"), "无关文件不受影响");
  });

  it("旧品牌 .zcodeignore 仍被沿用", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".zcodeignore"), "legacy-out/\n");
    await seed("legacy-out/generated.js", "needle");
    resetIgnoreCache();
    const files = await walkFiles(".");
    assert.ok(!files.includes("legacy-out/generated.js"), "改名不该让旧规则文件失效");
  });

  it("搜索默认跳过被忽略路径，includeIgnored 可绕过", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".gitignore"), "vendor/\n");
    await seed("vendor/lib.js", "needle_here");
    resetIgnoreCache();

    const skipped = await searchProject({ query: "needle_here" });
    assert.equal(skipped.matches.length, 0, "默认不应搜到忽略目录里的内容");

    const forced = await searchProject({ query: "needle_here", includeIgnored: true });
    assert.ok(
      forced.matches.some((m) => m.path === "vendor/lib.js"),
      "includeIgnored=true 时必须能搜到",
    );
  });

  it("显式把起点指到被忽略目录时不套用过滤", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".gitignore"), "vendor/\n");
    await seed("vendor/nested/deep.js", "needle");
    resetIgnoreCache();
    const files = await walkFiles("vendor");
    assert.ok(
      files.includes("vendor/nested/deep.js"),
      "用户明确指定要看 vendor，不该再被规则挡住",
    );
  });

  it("规则文件改动后无需重启即生效", async () => {
    await cleanIgnoreFiles();
    await seed("shift/target.js", "needle");
    resetIgnoreCache();
    assert.ok((await walkFiles(".")).includes("shift/target.js"));

    await writeFile(ignoreFile(".gitignore"), "shift/\n");
    // 刻意不调用 resetIgnoreCache：验证 mtime 指纹能自动发现改动
    const after = await walkFiles(".");
    assert.ok(!after.includes("shift/target.js"), "改了 .gitignore 后应立刻生效，不必重启");
  });

  it("listDirectory 标记被忽略项但仍列出它", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".gitignore"), "vendor/\n");
    await seed("vendor/lib.js", "needle");
    await seed("src/app.js", "needle");
    resetIgnoreCache();
    const entries = await listDirectory(".");
    const vendor = entries.find((e) => e.path === "vendor");
    const src = entries.find((e) => e.path === "src");
    assert.ok(vendor, "被忽略的目录仍要列出来——用户得能点进去看");
    assert.equal(vendor.ignored, true, "应带上忽略标记供界面灰显");
    assert.ok(src);
    assert.notEqual(src.ignored, true, "未命中的目录不该被标记");
  });

  it("isIgnored 区分文件与目录，路径越界不误判", async () => {
    await cleanIgnoreFiles();
    await writeFile(ignoreFile(".gitignore"), "build/\n");
    resetIgnoreCache();
    assert.equal(await isIgnored("build", true), true, "目录 build/ 被忽略");
    assert.equal(await isIgnored("build/x.js", false), true, "目录内文件被忽略");
    assert.equal(await isIgnored("../outside", false), false, "越界路径不参与判定");
    assert.equal(await isIgnored("", false), false, "空路径不参与判定");
  });
});

describe("回收站", () => {
  it("删除后可恢复到原始路径并保留元数据", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx, () => {
      setImmediate(() => {
        const req = ctx.requests.at(-1) as { id: string };
        ctx.broker.resolve(req.id, true, false);
      });
    });
    await call(t.write_file, { path: "trash/me.txt", content: "payload" });
    const del = await call(t.delete_path, { path: "trash/me.txt" });
    assert.match(del, /已移入回收站/);
    await assert.rejects(() => safeExistingPath("trash/me.txt"));

    const entries = await listTrash();
    const entry = entries.find((e) => e.originalPath === "trash/me.txt");
    assert.ok(entry, "回收站应记录原始路径");

    const restored = await restoreFromTrash(entry!.name);
    assert.equal(restored, "trash/me.txt");
    assert.equal(await readFile(join(process.env.ZCODE_WORKSPACE!, "trash/me.txt"), "utf8"), "payload");
  });

  it("拒绝删除工作区根目录", async () => {
    const ctx = makeCtx();
    await ctx.broker.setMode("auto");
    const t = toolsFor(ctx);
    await assert.rejects(() => call(t.delete_path, { path: "." }), /拒绝删除工作区根目录/);
    await assert.rejects(() => moveToTrash("."), /拒绝删除工作区根目录/);
  });

  it("回收站条目名不允许穿越", async () => {
    await assert.rejects(() => restoreFromTrash("../secret"), /非法回收站条目/);
  });
});

describe("agent 循环（假上游）", () => {
  let upstream: Server;
  let baseUrl = "";
  let received: Array<{ tools?: unknown[]; messages?: unknown[] }> = [];
  let turn = 0;

  before(async () => {
    upstream = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as { tools?: unknown[]; messages?: unknown[] };
        received.push(body);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) =>
          res.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-test",
              object: "chat.completion.chunk",
              created: 0,
              model: "fake",
              choices: [{ index: 0, delta, finish_reason: finish }],
              ...(usage ? { usage } : {}),
            })}\n\n`,
          );

        turn += 1;
        if (turn === 1) {
          chunk({
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "grep", arguments: '{"query":"marker"}' },
              },
            ],
          });
          chunk({}, "tool_calls");
        } else {
          chunk({ content: "已经找到 " });
          chunk({ content: "marker。" });
          chunk({}, "stop", { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
        }
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const addr = upstream.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}/v1`;
  });

  after(() => {
    upstream.close();
  });

  it("多步执行工具并把结果喂回模型，最终产出文本与 usage", async () => {
    turn = 0;
    received = [];
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await call(t.write_file, { path: "loop/marker.txt", content: "here is the marker line\n" });

    const events: Array<{ event: string; data: unknown }> = [];
    const finish = await runAgent({
      messages: [{ role: "user", content: "找一下 marker" }],
      tools: t as unknown as Record<string, never>,
      broker: ctx.broker,
      config: { apiKey: "test-key", apiBase: baseUrl, apiModel: "fake", temperature: 0 },
      runId: ctx.runId,
      emit: (event, data) => events.push({ event, data }),
    });

    const kinds = events.map((e) => e.event);
    assert.ok(kinds.includes("tool-call"), "应发出 tool-call 事件");
    assert.ok(kinds.includes("tool-result"), "应发出 tool-result 事件");
    assert.ok(kinds.includes("message"), "应发出 message 事件");
    assert.ok(finish.usage, "runAgent 应回传 usage，供接入层发出 usage 事件");
    assert.equal(finish.usage?.totalTokens, 18);
    assert.equal(finish.steps, 2, "两轮上游调用对应两个 step");
    assert.equal(finish.text, "已经找到 marker。");
    assert.equal(finish.toolCalls.length, 1);
    assert.equal(finish.toolCalls[0].name, "grep");
    assert.match(String(finish.toolCalls[0].output), /loop\/marker\.txt/);

    assert.equal(received.length, 2, "应发起两轮上游请求（工具调用 + 结果回灌）");
    assert.ok(Array.isArray(received[0].tools) && received[0].tools.length > 0, "首轮应携带工具定义");

    const secondMsgs = received[1].messages as Array<Record<string, unknown>>;
    const toolMsg = secondMsgs.find((m) => m.role === "tool");
    assert.ok(toolMsg, "次轮应带回 role:tool 消息");
    assert.equal(toolMsg?.tool_call_id, "call_1", "工具消息应绑定原始 tool_call_id");

    const assistantMsg = secondMsgs.find((m) => m.role === "assistant");
    assert.ok(assistantMsg?.tool_calls, "次轮应带回 assistant 的 tool_calls 以维持上下文");
    assert.match(String(toolMsg?.content), /loop\/marker\.txt/, "工具消息应包含真实工具输出");
  });

  it("工具定义包含全部内置工具", async () => {
    turn = 0;
    received = [];
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    await runAgent({
      messages: [{ role: "user", content: "hi" }],
      tools: t as unknown as Record<string, never>,
      broker: ctx.broker,
      config: { apiKey: "k", apiBase: baseUrl, apiModel: "fake", temperature: 0 },
      runId: ctx.runId,
      emit: () => {},
    });
    const names = (received[0].tools as Array<{ function: { name: string } }>).map((x) => x.function.name);
    for (const expected of ["read_file", "write_file", "edit_file", "list_dir", "glob", "grep", "bash", "delete_path"]) {
      assert.ok(names.includes(expected), `工具集应包含 ${expected}`);
    }
  });

  it("上游报错时发出 error 事件且不抛穿", async () => {
    const ctx = makeCtx();
    const t = toolsFor(ctx);
    const events: Array<{ event: string }> = [];
    await runAgent({
      messages: [{ role: "user", content: "hi" }],
      tools: t as unknown as Record<string, never>,
      broker: ctx.broker,
      config: { apiKey: "k", apiBase: "http://127.0.0.1:1/v1", apiModel: "fake", temperature: 0 },
      runId: ctx.runId,
      emit: (event) => events.push({ event }),
    });
    assert.ok(events.some((e) => e.event === "error"), "应发出 error 事件");
  });
});

describe("shell 执行层", () => {
  it("返回 stderr 与退出码", async () => {
    const r = await runShell("echo out; echo err 1>&2; exit 3");
    assert.match(r.stdout, /out/);
    assert.match(r.stderr, /err/);
    assert.equal(r.code, 3);
  });

  it("输出被截断保护", async () => {
    const r = await runShell("yes x | head -c 200000", 10_000);
    assert.ok(r.stdout.length <= 40_000, `输出应被截断，实际 ${r.stdout.length}`);
  });
});

describe("shell 解析（ADR-003）", () => {
  it("解析出 POSIX shell 且命令形态是 -c", () => {
    resetShellCache();
    const spec = resolveShell();
    assert.ok(spec.bin, "应解析出 shell 可执行文件");
    assert.deepEqual(spec.args("echo hi"), ["-c", "echo hi"]);
  });

  it("win32 上也优先 bash/sh，不直接落到 PowerShell", () => {
    resetShellCache();
    const spec = resolveShell();
    if (process.platform === "win32" && /bash\.exe|sh\.exe$/i.test(spec.bin)) {
      assert.ok(!/powershell/i.test(spec.bin), "装了 bash/sh 时不应选 PowerShell");
    }
    if (process.platform !== "win32") {
      assert.ok(!/powershell/i.test(spec.bin));
    }
  });

  it("同进程内解析结果稳定（终端与 bash 工具共用同一份）", () => {
    resetShellCache();
    const first = resolveShell();
    const second = resolveShell();
    assert.equal(first.bin, second.bin, "同进程内应被缓存且一致");
  });
});

describe("上下文限幅", () => {
  function turn(i: number, withTool: boolean): Array<Record<string, unknown>> {
    const user = { role: "user", content: `第 ${i} 轮：${"长文本内容".repeat(300)}` };
    if (!withTool) {
      return [user, { role: "assistant", content: `第 ${i} 轮回答` }];
    }
    return [
      user,
      {
        role: "assistant",
        content: `第 ${i} 轮先看一下`,
        tool_calls: [
          { id: `call-${i}`, type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
        ],
      },
      { role: "tool", tool_call_id: `call-${i}`, name: "read_file", content: `第 ${i} 轮的文件内容` },
      { role: "assistant", content: `第 ${i} 轮完成` },
    ];
  }

  it("短历史原样保留，不做任何裁剪", () => {
    const messages = [...turn(1, true), ...turn(2, false)];
    const r = boundHistory(messages as never);
    assert.equal(r.trimmed, 0);
    assert.equal(r.messages.length, messages.length);
  });

  it("长历史只保留最近若干轮的工具流量，旧文本截断而非丢弃", () => {
    const messages: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 40; i += 1) messages.push(...turn(i, i % 3 === 0));
    const r = boundHistory(messages as never);

    assert.ok(r.trimmed > 0, "应报告省略条数");
    assert.ok(r.messages.length < messages.length, "应确实变短");
    const dump = JSON.stringify(r.messages);

    // 最近一轮完整可见
    assert.match(dump, /第 40 轮回答/);
    // 窗口内的工具调用与结果完整保留
    assert.match(dump, /第 39 轮的文件内容/);
    // 窗口外的工具流量被丢弃（这是膨胀的真正来源）
    assert.doesNotMatch(dump, /第 3 轮的文件内容/);
    // 但窗口外的对话文本保留（截断），否则上下文会失去连续性
    assert.match(dump, /第 1 轮回答/);
    assert.match(dump, /更早的内容已省略/);
  });

  it("不变量：结果里不存在没有对应 tool-call 的 tool 结果", () => {
    const messages: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 60; i += 1) messages.push(...turn(i, true));
    const r = boundHistory(messages as never);

    const calledIds = new Set<string>();
    for (const m of r.messages as Array<{ role: string; content: unknown }>) {
      if (m.role !== "assistant" || typeof m.content === "string") continue;
      for (const part of m.content as Array<{ type: string; toolCallId?: string }>) {
        if (part.type === "tool-call" && part.toolCallId) calledIds.add(part.toolCallId);
      }
    }
    for (const m of r.messages as Array<{ role: string; content: unknown }>) {
      if (m.role !== "tool") continue;
      for (const part of m.content as Array<{ type: string; toolCallId?: string }>) {
        if (part.type !== "tool-result") continue;
        assert.ok(
          calledIds.has(part.toolCallId ?? ""),
          `出现孤立 tool 结果: ${part.toolCallId}`,
        );
      }
    }
  });

  it("超长的旧文本被截断并带省略标记", () => {
    const messages: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 20; i += 1) messages.push(...turn(i, false));
    const r = boundHistory(messages as never);
    const dump = JSON.stringify(r.messages);
    // 旧的超长用户消息应带省略标记；最近几轮里的则不应被标记
    assert.match(dump, /已省略/);
    const tail = r.messages.slice(-2);
    assert.doesNotMatch(JSON.stringify(tail), /已省略/);
  });

  it("历史里的 system 消息被丢弃（系统提示由 instructions 承担）", () => {
    const messages: Array<Record<string, unknown>> = [{ role: "system", content: "旧的系统提示" }];
    for (let i = 1; i <= 20; i += 1) messages.push(...turn(i, false));
    const r = boundHistory(messages as never);
    assert.doesNotMatch(JSON.stringify(r.messages), /旧的系统提示/);
  });

  it("多模态旧消息保留文字、省略图片", () => {
    const messages: Array<Record<string, unknown>> = [];
    for (let i = 1; i <= 15; i += 1) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: `第 ${i} 轮带图` },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      });
      messages.push({ role: "assistant", content: `答 ${i}` });
    }
    const r = boundHistory(messages as never);
    const dump = JSON.stringify(r.messages);
    assert.match(dump, /第 15 轮带图/);
    assert.doesNotMatch(dump, /data:image\/png;base64,AAAA/);
  });
});
