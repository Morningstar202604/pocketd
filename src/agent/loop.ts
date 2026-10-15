import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  stepCountIs,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type { ApiConfig } from "./runtime.js";
import type { ApprovalBroker } from "./permissions.js";

export interface AgentToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "running" | "ok" | "denied" | "error";
}

export interface AgentFinish {
  usage: LanguageModelUsage | null;
  toolCalls: AgentToolCallRecord[];
  steps: number;
  text: string;
}

export interface AgentRunOptions {
  messages: ClientMessage[];
  tools: ToolSet;
  broker: ApprovalBroker;
  config: Pick<ApiConfig, "apiKey" | "apiBase" | "apiModel" | "temperature">;
  runId: string;
  model?: string;
  emit: (event: string, data: unknown) => void;
  signal?: AbortSignal;
  maxSteps?: number;
  instructions?: string;
}

export interface ClientAttachment {
  type?: string;
  text?: string;
  image_url?: { url?: string } | string;
}

export interface ClientMessage {
  role: string;
  content: string | ClientAttachment[];
  tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>;
  tool_call_id?: string;
  name?: string;
}

function dataUrlToParts(url: string): { mediaType: string; data: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) return null;
  return {
    mediaType: match[1],
    data: Uint8Array.from(Buffer.from(match[2], "base64")),
  };
}

function parseArgs(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/* ── 上下文限幅 ──
   客户端每轮发送完整显示历史（含全部历史工具输出）。长会话下这会无限增长，
   既推高费用也把模型淹没在陈旧的命令输出里。这里按「最近 N 轮原样保留、
   更早的降级」来收敛，并且只在真的裁剪时告知用户。 */

const KEEP_RECENT_TURNS = 12;
const MAX_OLD_TEXT = 1500;
const TRIM_MARK = "\n…[更早的内容已省略]";

export interface BoundHistoryResult {
  messages: ModelMessage[];
  /** 被省略的消息条数；> 0 时调用方可以提示用户 */
  trimmed: number;
  /** 估算的字符数，供日志与提示使用 */
  approxChars: number;
}

export function boundHistory(messages: ClientMessage[]): BoundHistoryResult {
  // 以 user 消息为轮次边界，从后往前数够 KEEP_RECENT_TURNS 轮
  let boundary = 0;
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      seen += 1;
      if (seen === KEEP_RECENT_TURNS) {
        boundary = i;
        break;
      }
    }
  }

  const kept: ClientMessage[] = [];
  let trimmed = 0;

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (i >= boundary) {
      kept.push(msg);
      continue;
    }

    // 早于窗口的助手工具调用必须连同其后续的 tool 结果一起丢掉：
    // 只丢一半会产生「tool 结果没有对应调用」的非法序列。
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      trimmed += 1 + msg.tool_calls.length;
      continue;
    }
    if (msg.role === "tool") {
      trimmed += 1;
      continue;
    }
    if (msg.role === "system") {
      // 系统提示由 instructions 承担，历史里的 system 没有保留价值
      trimmed += 1;
      continue;
    }

    if (msg.role === "user" || msg.role === "assistant") {
      if (typeof msg.content === "string") {
        const next =
          msg.content.length > MAX_OLD_TEXT
            ? msg.content.slice(0, MAX_OLD_TEXT) + TRIM_MARK
            : msg.content;
        if (next !== msg.content) trimmed += 1;
        kept.push({ ...msg, content: next });
      } else {
        // 多模态的旧消息只保留文字部分，图片换成占位说明（旧图对当前任务几乎无用）
        const parts = (msg.content ?? []).filter(
          (p) => p?.type === "text" && typeof p.text === "string" && p.text,
        );
        trimmed += 1;
        kept.push({
          role: msg.role,
          content: [
            ...parts.map((p) => ({ type: "text" as const, text: (p.text ?? "").slice(0, MAX_OLD_TEXT) })),
            { type: "text" as const, text: "[更早的图片附件已省略]" },
          ],
        });
      }
      continue;
    }
  }

  const modelMessages = toModelMessages(kept);
  const approxChars = modelMessages.reduce((sum, m) => sum + JSON.stringify(m).length, 0);
  return { messages: modelMessages, trimmed, approxChars };
}

export function toModelMessages(messages: ClientMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      if (typeof msg.content === "string" && msg.content.trim()) {
        out.push({ role: "system", content: msg.content });
      }
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        if (msg.content) out.push({ role: "user", content: [{ type: "text", text: msg.content }] });
        continue;
      }
      const parts: Array<
        { type: "text"; text: string } | { type: "image"; image: Uint8Array; mediaType: string }
      > = [];
      for (const part of msg.content ?? []) {
        if (part?.type === "text" && typeof part.text === "string" && part.text) {
          parts.push({ type: "text", text: part.text });
          continue;
        }
        const rawUrl = typeof part?.image_url === "string" ? part.image_url : part?.image_url?.url;
        if (typeof rawUrl === "string") {
          const decoded = dataUrlToParts(rawUrl);
          if (decoded) {
            parts.push({ type: "image", image: decoded.data, mediaType: decoded.mediaType });
          }
        }
      }
      if (parts.length > 0) out.push({ role: "user", content: parts });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
      > = [];
      if (typeof msg.content === "string" && msg.content) {
        parts.push({ type: "text", text: msg.content });
      }
      for (const call of msg.tool_calls ?? []) {
        parts.push({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.function?.name ?? "",
          input: parseArgs(call.function?.arguments),
        });
      }
      if (parts.length > 0) out.push({ role: "assistant", content: parts });
      continue;
    }

    if (msg.role === "tool") {
      out.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: msg.tool_call_id ?? "",
            toolName: msg.name ?? "",
            output:
              typeof msg.content === "string"
                ? { type: "text", value: msg.content }
                : { type: "text", value: JSON.stringify(msg.content) },
          },
        ],
      });
    }
  }
  return out;
}

const BASE_INSTRUCTIONS = `你是 pocketd —— 一个跑在用户 Android 设备本地的编码 agent。你直接操作用户的工作区，不是只给建议。

工作方式：
- 先看清再动手。改文件前先用 read_file / grep / glob 确认现状，不要凭猜测编辑。
- 小步推进：一次一个明确的改动，改完立刻验证（跑测试、typecheck、或直接执行）。
- 修改已有文件用 edit_file（精确替换），只在创建新文件或需要整体重写时用 write_file。
- 命令用 bash 执行。危险命令会被策略拦截或要求用户批准 —— 被拒绝时不要重试同一命令，换个做法或向用户说明。
- 回答用中文，简洁。完成一个任务后说明你实际做了什么、验证了什么，不要只说"已完成"。
- 不要在代码里加注释，除非用户明确要求。
- 你看到的工具输出可能被截断，需要更多内容时用 offset/limit 分页读取。`;

export async function runAgent(opts: AgentRunOptions): Promise<AgentFinish> {
  const provider = createOpenAICompatible({
    name: "pocketd",
    baseURL: opts.config.apiBase,
    apiKey: opts.config.apiKey || "not-needed",
  });

  const toolCalls = new Map<string, AgentToolCallRecord>();
  const order: string[] = [];
  let text = "";
  let steps = 0;
  let usage: LanguageModelUsage | null = null;

  // 上下文限幅：只保留最近若干轮原文，更早的工具输出降级/省略
  const bounded = boundHistory(opts.messages);
  const modelMessages = bounded.messages;
  if (modelMessages.length === 0) {
    throw new Error("没有可发送给模型的消息");
  }
  if (bounded.trimmed > 0) {
    opts.emit("warning", {
      message: `已省略 ${bounded.trimmed} 条较早的历史内容以控制上下文长度`,
    });
  }

  const result = streamText({
    model: provider.chatModel(opts.model || opts.config.apiModel),
    instructions: opts.instructions ?? BASE_INSTRUCTIONS,
    messages: modelMessages,
    tools: opts.tools,
    stopWhen: stepCountIs(opts.maxSteps ?? 40),
    temperature: opts.config.temperature,
    abortSignal: opts.signal,
    onError: ({ error }) => {
      opts.emit("error", { message: (error as Error)?.message ?? String(error) });
    },
  });

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          text += part.text;
          opts.emit("message", { content: part.text });
          break;
        case "reasoning-delta":
          opts.emit("thinking", { content: part.text });
          break;
        case "start-step":
          steps += 1;
          opts.emit("step", { index: steps });
          break;
        case "tool-call": {
          const rec: AgentToolCallRecord = {
            id: part.toolCallId,
            name: part.toolName,
            input: part.input,
            status: "running",
          };
          toolCalls.set(part.toolCallId, rec);
          order.push(part.toolCallId);
          opts.emit("tool-call", { id: part.toolCallId, name: part.toolName, input: part.input });
          break;
        }
        case "tool-result": {
          const rec = toolCalls.get(part.toolCallId);
          if (rec) {
            rec.output = part.output;
            rec.status = "ok";
          }
          opts.emit("tool-result", {
            id: part.toolCallId,
            name: part.toolName,
            output: part.output,
          });
          break;
        }
        case "tool-error": {
          const rec = toolCalls.get(part.toolCallId);
          const message =
            part.error instanceof Error ? part.error.message : String(part.error ?? "工具执行失败");
          if (rec) {
            rec.output = message;
            rec.status = "error";
          }
          opts.emit("tool-result", {
            id: part.toolCallId,
            name: part.toolName,
            output: message,
            isError: true,
          });
          break;
        }
        case "finish-step":
          usage = part.usage;
          break;
        case "finish":
          usage = part.totalUsage;
          break;
        case "abort":
          opts.emit("aborted", { reason: part.reason ?? "用户中止" });
          break;
        case "error":
          opts.emit("error", {
            message:
              part.error instanceof Error ? part.error.message : String(part.error ?? "未知错误"),
          });
          break;
        default:
          break;
      }
    }
  } finally {
    opts.broker.cancelRun(opts.runId);
  }

  return {
    usage,
    toolCalls: order.map((id) => toolCalls.get(id)!).filter(Boolean),
    steps,
    text,
  };
}
