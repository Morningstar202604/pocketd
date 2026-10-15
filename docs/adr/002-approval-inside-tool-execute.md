# 002 — 审批门控放在工具 execute 内部，而非使用 SDK 的 toolApproval

状态: 已采纳 (2026-10)

## 背景

agent 需要"危险工具先经用户批准"。AI SDK 7 内置了 `toolApproval` 配置与
`ToolApprovalStatus`（`'user-approval'`），会发出 `tool-approval-request` part，
并在收到 `tool-approval-response` 后继续。

## 选项

1. **SDK 的 `toolApproval` + 断点续传** — 官方路径。回应方式是把 `tool-approval-response`
   part 放进 `messages` 的最后一条消息，然后重新调用 `streamText` 恢复。
2. **在工具 `execute` 内部等待一个 broker promise**，由 HTTP POST 解除等待。

## 决定

采纳选项 2。

## 理由

- 选项 1 要求客户端持久化并回传完整的 assistant 消息（含 tool-call parts），服务端随后要**重新进入
  一次新的流**。客户端得实现"断线重连到新流"的协议，而本项目的客户端仍以自定义 SSE 事件消费。
- 选项 2 下整个 agent 运行仍是**一次 `streamText` 调用**，SSE 流不断开，用户体验是"卡片出现 → 点击
  → 继续流式"，没有二次连接。
- 两者的安全语义相同：两者都在执行前拦截，都会产生拒绝路径。
- 已实现的能力：请求带 `danger` 分级与原因，支持"记住选择"（写入 `alwaysAllow`），
  超时按拒绝处理（fail closed），并发运行通过 `runId` 隔离，不会互相取消对方的待批请求。

## 后果

- 不使用 `toolApproval` 配置；如需迁移到 `useChat`，应重新评估本决定。
- 审批状态存在进程内存（`ApprovalBroker.pending`），进程重启会丢弃待批请求（按拒绝处理）。
- broker 是进程级单例以共享"记住选择"缓存；每个请求带 `runId`，取消只影响自己那次运行。
