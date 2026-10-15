# 001 — 用 Vercel AI SDK 替换手写的 LLM 调用层

状态: 已采纳 (2026-10)

## 背景

原实现在 `server.ts` 里手写了 OpenAI 兼容接口的调用：SSE 分帧、`tool_calls` 增量合并、
`reasoning_content` 透传、以及一个用 `safety--` 计数的 5 轮工具循环。这段代码约 160 行，
只支持单一 provider 形态，且 usage 依赖上游是否在 chunk 里返回。

## 选项

1. **保持手写** — 零依赖，但每加一项能力都要重新实现一遍协议细节。
2. **Vercel AI SDK 7** — `streamText` 负责流式、多步工具循环、重试、usage 归一化；
   `@ai-sdk/openai-compatible` 覆盖所有 OpenAI 兼容端点。
3. **LangChain.js** — 生态大，但对本项目的规模过重，抽象层更深。

## 决定

采纳选项 2。

## 理由

- 工具多步循环由 `stopWhen: stepCountIs(n)` 表达，替代手写计数器。
- `fullStream` 的 part 类型（`text-delta` / `reasoning-delta` / `tool-call` / `tool-result` /
  `finish`）是稳定契约，不再依赖上游 chunk 的具体形状。
- 同一 SDK 已被本机其他项目使用（`web/`），技术栈一致，心智负担低。
- 多模态消息、图片 part 的编解码由库处理。

## 后果

- 新增依赖 `ai` + `@ai-sdk/openai-compatible`（服务端，不影响前端包体）。
- 消息需从 OpenAI 线上格式转换为 SDK 的 `ModelMessage`；该转换集中在
  `src/agent/loop.ts` 的 `toModelMessages()`，已由测试覆盖。
- 上游若返回非标准扩展字段，需通过 `providerOptions` 传递，不能像以前那样直接透传。
