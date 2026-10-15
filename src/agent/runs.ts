import type { ApprovalRequest } from "./permissions.js";

/**
 * Agent 运行的注册表。
 *
 * 存在的理由：agent 一次运行可能持续几分钟，中途会等审批。手机上「锁屏 / 切应用 /
 * 被系统回收标签页」是常态，如果运行绑在 HTTP 请求上，这些动作都会毁掉正在进行的工作。
 * 所以运行由本模块持有，HTTP 连接只是订阅者——断连只解除订阅，不终止运行。
 */

export type RunStatus = "running" | "done" | "error" | "cancelled";

export interface RunEvent {
  seq: number;
  event: string;
  data: unknown;
}

export interface RunSnapshot {
  runId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  eventCount: number;
  /** 客户端从哪个序号开始还没拿到，用来判断是否需要重连回放 */
  lastSeq: number;
  sessionId?: string;
  steps: number;
  toolCalls: number;
  textLength: number;
  pendingApprovals: ApprovalRequest[];
  error?: string;
}

interface RunRecord {
  runId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  steps: number;
  toolCalls: number;
  textLength: number;
  error?: string;
  events: RunEvent[];
  nextSeq: number;
  subscribers: Set<(e: RunEvent, snapshot: RunSnapshot) => void>;
  finishedWaiters: Set<() => void>;
  abort: AbortController;
  pendingApprovals: Map<string, ApprovalRequest>;
  /** 结束后保留一段时间供客户端回看/回放，然后回收 */
  reapAt?: number;
}

export interface StartRunOptions {
  runId: string;
  sessionId?: string;
  /** 每个事件额外打上时间戳，便于客户端显示耗时 */
  onEvent?: (e: RunEvent) => void;
}

/** 单次运行最多保留的事件条数：文本增量很密，超出后丢弃最旧的并标记 */
const MAX_EVENTS = 4000;
/** 结束后保留多久，方便客户端回来看到最终结果 */
const RETAIN_AFTER_FINISH_MS = 10 * 60 * 1000;
/** 同时保留的已完成运行数量上限 */
const MAX_FINISHED_RUNS = 20;

export class RunRegistry {
  private runs = new Map<string, RunRecord>();

  /** 创建一个运行并返回句柄；调用方负责在其上跑 agent 循环 */
  start(opts: StartRunOptions): RunHandle {
    const now = Date.now();
    const record: RunRecord = {
      runId: opts.runId,
      status: "running",
      createdAt: now,
      updatedAt: now,
      sessionId: opts.sessionId,
      steps: 0,
      toolCalls: 0,
      textLength: 0,
      events: [],
      nextSeq: 0,
      subscribers: new Set(),
      finishedWaiters: new Set(),
      abort: new AbortController(),
      pendingApprovals: new Map(),
    };
    this.runs.set(record.runId, record);
    this.sweep();
    return new RunHandle(record);
  }

  get(runId: string): RunSnapshot | undefined {
    const r = this.runs.get(runId);
    return r ? snapshot(r) : undefined;
  }

  /** 列出可回看的运行，最近的在前 */
  list(limit = 10): RunSnapshot[] {
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(snapshot);
  }

  /**
   * 回放事件：返回 from 之后的所有事件 + 当前状态。
   * `truncated` 为真表示请求的起点已被环形缓冲丢弃，客户端需要重建消息。
   */
  events(
    runId: string,
    from = 0,
  ): { events: RunEvent[]; truncated: boolean; snapshot: RunSnapshot } | undefined {
    const r = this.runs.get(runId);
    if (!r) return undefined;
    const oldest = r.events.length > 0 ? r.events[0].seq : r.nextSeq;
    const truncated = from > 0 && from < oldest;
    return {
      events: r.events.filter((e) => e.seq >= from),
      truncated,
      snapshot: snapshot(r),
    };
  }

  /** 订阅实时事件。返回值是解除订阅的函数——断连走的永远是这条路 */
  subscribe(runId: string, fn: (e: RunEvent, snapshot: RunSnapshot) => void): () => void {
    const r = this.runs.get(runId);
    if (!r) return () => {};
    const wrapped = (e: RunEvent, s: RunSnapshot) => fn(e, s);
    r.subscribers.add(wrapped);
    return () => {
      r.subscribers.delete(wrapped);
    };
  }

  /** 等运行结束（用于回放流的收尾） */
  onFinish(runId: string, fn: () => void): () => void {
    const r = this.runs.get(runId);
    if (!r) {
      fn();
      return () => {};
    }
    if (r.status !== "running") {
      fn();
      return () => {};
    }
    r.finishedWaiters.add(fn);
    return () => {
      r.finishedWaiters.delete(fn);
    };
  }

  /** 主动取消（客户端点「停止生成」） */
  cancel(runId: string): boolean {
    const r = this.runs.get(runId);
    if (!r || r.status !== "running") return false;
    r.abort.abort();
    return true;
  }

  /** 待批审批的登记/注销，让重连的客户端也能看到 */
  trackApproval(runId: string, req: ApprovalRequest): void {
    this.runs.get(runId)?.pendingApprovals.set(req.id, req);
  }

  clearApproval(runId: string, approvalId: string): void {
    this.runs.get(runId)?.pendingApprovals.delete(approvalId);
  }

  /** 所有运行里的待批请求（供 /api/agent/policy 之类的地方汇总） */
  allPendingApprovals(): ApprovalRequest[] {
    const out: ApprovalRequest[] = [];
    for (const r of this.runs.values()) {
      if (r.status === "running") out.push(...r.pendingApprovals.values());
    }
    return out;
  }

  private sweep(): void {
    const now = Date.now();
    const finished = [...this.runs.values()]
      .filter((r) => r.status !== "running")
      .sort((a, b) => b.updatedAt - a.updatedAt);

    for (const r of finished) {
      if (r.reapAt && now > r.reapAt) this.runs.delete(r.runId);
    }
    // 数量兜底：即使还在保留窗口内，也不无限堆积
    const stillFinished = finished.filter((r) => this.runs.has(r.runId));
    for (const r of stillFinished.slice(MAX_FINISHED_RUNS)) this.runs.delete(r.runId);
  }

  /** 供测试与运维使用 */
  get size(): number {
    return this.runs.size;
  }
}

export class RunHandle {
  constructor(private readonly record: RunRecord) {}

  get runId(): string {
    return this.record.runId;
  }

  get signal(): AbortSignal {
    return this.record.abort.signal;
  }

  /** 追加一个事件：分配序号、进缓冲、广播给当前订阅者 */
  emit(event: string, data: unknown): void {
    if (this.record.status !== "running") return;
    const ev: RunEvent = { seq: this.record.nextSeq, event, data };
    this.record.nextSeq += 1;
    this.record.updatedAt = Date.now();

    if (event === "step") this.record.steps = (data as { index?: number })?.index ?? this.record.steps + 1;
    if (event === "tool-call") this.record.toolCalls += 1;
    if (event === "message") {
      this.record.textLength += String((data as { content?: string })?.content ?? "").length;
    }
    if (event === "error") this.record.error = String((data as { message?: string })?.message ?? "未知错误");

    this.record.events.push(ev);
    if (this.record.events.length > MAX_EVENTS) {
      // 只丢最旧的；客户端发现 from 早于首序号时会收到 truncated 并重建
      this.record.events.splice(0, this.record.events.length - MAX_EVENTS);
    }

    const snap = snapshot(this.record);
    for (const fn of this.record.subscribers) {
      try {
        fn(ev, snap);
      } catch {
        /* 订阅者自己抛错不该影响运行 */
      }
    }
  }

  approve(runId: string, id: string): void {
    if (runId === this.record.runId) this.record.pendingApprovals.delete(id);
  }

  finish(status: Exclude<RunStatus, "running">, error?: string): void {
    if (this.record.status !== "running") return;
    this.record.status = status;
    if (error) this.record.error = error;
    this.record.updatedAt = Date.now();
    this.record.reapAt = Date.now() + RETAIN_AFTER_FINISH_MS;
    this.record.pendingApprovals.clear();

    const snap = snapshot(this.record);
    // 最后再广播一次状态，让订阅者能收尾
    for (const fn of this.record.subscribers) {
      try {
        fn({ seq: this.record.nextSeq, event: "run-status", data: snap }, snap);
      } catch {
        /* 同上 */
      }
    }
    for (const fn of this.record.finishedWaiters) {
      try {
        fn();
      } catch {
        /* 同上 */
      }
    }
    this.record.finishedWaiters.clear();
  }
}

function snapshot(r: RunRecord): RunSnapshot {
  return {
    runId: r.runId,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    eventCount: r.events.length,
    lastSeq: r.nextSeq - 1,
    sessionId: r.sessionId,
    steps: r.steps,
    toolCalls: r.toolCalls,
    textLength: r.textLength,
    pendingApprovals: [...r.pendingApprovals.values()],
    error: r.error,
  };
}

export const runRegistry = new RunRegistry();
