/**
 * 假的 OpenAI 兼容上游，用于本地开发与冒烟测试（无需真实 API Key）。
 *
 * 阶段按**请求内容**推导，不用全局计数器：应用启动时会先发一条 "ping" 做连通性
 * 探测，全局计数器会被它打乱，导致同一段对话被重新当作第一轮。
 *
 * 阶段：0 个工具结果 → 写文件；1 个 → 执行命令（会触发审批）；≥2 个 → 产出结论。
 *
 * 用法: node tests/fixtures/fake-upstream.mjs [port]
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2]) || 3198;

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      body = {};
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const toolResults = messages.filter((m) => m.role === "tool").length;
    const dump = JSON.stringify(messages);
    // 连通性探测：单条 user 消息、且还没有任何工具往返
    const isProbe = messages.length <= 2 && toolResults === 0 && /"ping"/.test(dump);

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });

    const chunk = (delta, finish = null, usage) =>
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-fake",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "fake-model",
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...(usage ? { usage } : {}),
        })}\n\n`,
      );

    if (isProbe) {
      chunk({ content: "pong" });
      chunk({}, "stop", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
      res.write("data: [DONE]\n\n");
      res.end();
      process.stderr.write("[fake-upstream] probe (ping) → pong\n");
      return;
    }

    process.stderr.write(
      `[fake-upstream] messages=${messages.length} toolResults=${toolResults} → step ${toolResults + 1}\n`,
    );

    if (toolResults === 0) {
      chunk({ content: "我先创建一个文件。\n" });
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_write_1",
            type: "function",
            function: {
              name: "write_file",
              arguments: JSON.stringify({
                path: "demo/agent-smoke.txt",
                content: "由 pocketd agent 写入\n第二行\n",
              }),
            },
          },
        ],
      });
      chunk({}, "tool_calls");
    } else if (toolResults === 1) {
      chunk({ content: "\n文件已写入，现在看一下它的内容。\n" });
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_bash_1",
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: "cat demo/agent-smoke.txt" }),
            },
          },
        ],
      });
      chunk({}, "tool_calls");
    } else {
      const sawContent = dump.includes("由 pocketd agent 写入");
      chunk({
        content: sawContent
          ? "\n\n已完成：写入 `demo/agent-smoke.txt` 并读回验证，内容符合预期。"
          : "\n\n流程走完了，但我在上下文里没有看到文件内容。",
      });
      chunk({}, "stop", { prompt_tokens: 120, completion_tokens: 48, total_tokens: 168 });
    }

    res.write("data: [DONE]\n\n");
    res.end();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`[fake-upstream] listening on http://127.0.0.1:${PORT}/v1\n`);
});
