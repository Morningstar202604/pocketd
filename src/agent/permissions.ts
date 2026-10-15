import { randomUUID } from "node:crypto";
import {
  alwaysAllowList,
  getApprovalMode,
  rememberAlwaysAllow,
  type ApprovalMode,
} from "./runtime.js";
import { envValue } from "./brand.js";

export type Decision = "allow" | "ask" | "deny";

export interface ApprovalRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  danger: "low" | "medium" | "high";
  reason: string;
  allowKey?: string;
}

export interface ApprovalOutcome {
  approved: boolean;
  remember: boolean;
}

const READ_ONLY_TOOLS = new Set(["read_file", "list_dir", "glob", "grep", "git_status", "git_diff"]);

const HARD_DENY_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)*\/(\s|$)/, reason: "递归删除文件系统根" },
  { re: /\bmkfs(\.\w+)?\b/, reason: "格式化文件系统" },
  { re: /\bdd\b[^\n]*\bof=\/dev\/[sh]d/, reason: "裸写块设备" },
  { re: /:\s*\(\s*\)\s*\{.*\|.*&.*\}\s*;\s*:/, reason: "fork 炸弹" },
  { re: /\bchmod\s+-R\s+777\s+\/(\s|$)/, reason: "开放根目录权限" },
  { re: />\s*\/dev\/[sh]d[a-z]/, reason: "覆写块设备" },
  { re: /\bshutdown\b|\breboot\b|\bhalt\b/, reason: "关机/重启" },
];

const SHELL_META = /[;&|`$><\n\\]/;

export function classifyShellCommand(command: string): { danger: ApprovalRequest["danger"]; reason: string } {
  for (const { re, reason } of HARD_DENY_PATTERNS) {
    if (re.test(command)) return { danger: "high", reason: `硬拒绝: ${reason}` };
  }
  if (/\brm\b|\bmv\b|\btruncate\b/.test(command)) return { danger: "high", reason: "删除或移动文件" };
  if (/\bgit\s+(push|reset|clean|checkout|rebase|filter-branch)\b/.test(command)) {
    return { danger: "high", reason: "改写仓库历史或远程状态" };
  }
  if (/\b(npm|pnpm|yarn)\s+(install|i|add|publish)\b|\bpip\s+install\b|\bcurl\b|\bwget\b/.test(command)) {
    return { danger: "high", reason: "安装依赖或发起网络请求" };
  }
  if (/\bsudo\b|\bsu\b/.test(command)) return { danger: "high", reason: "提权执行" };
  return { danger: "medium", reason: "执行 shell 命令" };
}

export function isHardDenied(command: string): string | null {
  for (const { re, reason } of HARD_DENY_PATTERNS) {
    if (re.test(command)) return reason;
  }
  return null;
}

export function hasShellMetacharacters(command: string): boolean {
  return SHELL_META.test(command);
}

export function shellAllowKey(command: string): string {
  const first = command.trim().split(/\s+/)[0] || command.trim();
  return `bash:${first}`;
}

export function writeAllowKey(tool: string, path: string): string {
  const top = path.split("/")[0] || path;
  return `${tool}:${top}`;
}

export function decide(
  tool: string,
  input: Record<string, unknown>,
  alwaysAllow: Set<string>,
  mode: ApprovalMode = "edits",
): { decision: Decision; reason: string; danger: ApprovalRequest["danger"]; allowKey?: string } {
  if (READ_ONLY_TOOLS.has(tool)) {
    return { decision: "allow", reason: "只读工具", danger: "low" };
  }

  if (tool === "bash") {
    const command = String(input.command ?? "");
    if (!command.trim()) return { decision: "deny", reason: "空命令", danger: "low" };
    const hard = isHardDenied(command);
    if (hard) return { decision: "deny", reason: hard, danger: "high" };
    const cls = classifyShellCommand(command);
    const key = shellAllowKey(command);
    if (alwaysAllow.has(key)) return { ...cls, decision: "allow", allowKey: key };
    if (mode === "auto") return { ...cls, decision: "allow", allowKey: key };
    return { ...cls, decision: "ask", allowKey: key };
  }

  if (tool === "write_file" || tool === "edit_file" || tool === "replace_in_files") {
    const path = String(input.path ?? "");
    const key = writeAllowKey(tool, path);
    if (alwaysAllow.has(key) || mode !== "strict") {
      return { decision: "allow", reason: "工作区内文件修改", danger: "medium", allowKey: key };
    }
    return { decision: "ask", reason: "修改工作区文件", danger: "medium", allowKey: key };
  }

  if (tool === "delete_path") {
    const path = String(input.path ?? "");
    const key = writeAllowKey(tool, path);
    if (alwaysAllow.has(key)) return { decision: "allow", reason: "已记住该目录", danger: "high", allowKey: key };
    if (mode === "auto") return { decision: "allow", reason: "auto 模式", danger: "high", allowKey: key };
    return { decision: "ask", reason: "删除文件（移入回收站）", danger: "high", allowKey: key };
  }

  if (alwaysAllow.has(tool)) return { decision: "allow", reason: "已记住该工具", danger: "medium" };
  if (mode === "auto") return { decision: "allow", reason: "auto 模式", danger: "medium" };
  return { decision: "ask", reason: "未分类工具，默认需批准", danger: "medium", allowKey: tool };
}

interface Pending {
  request: ApprovalRequest;
  runId: string;
  resolve: (outcome: ApprovalOutcome) => void;
  timer: NodeJS.Timeout;
}

export class ApprovalBroker {
  private pending = new Map<string, Pending>();
  private cache = new Set<string>();
  private mode: ApprovalMode = "edits";
  private loaded = false;

  /**
   * 默认等 15 分钟。手机上锁屏、切应用、被系统挂起都是常态，180 秒会在用户
   * 只是在走路时静默把任务否掉。超时仍然是 fail-closed（按拒绝处理）。
   */
  constructor(
    private readonly timeoutMs = Number(envValue("APPROVAL_TIMEOUT_MS")) || 15 * 60_000,
  ) {}

  async prime(): Promise<void> {
    if (this.loaded) return;
    for (const key of await alwaysAllowList()) this.cache.add(key);
    this.mode = await getApprovalMode();
    this.loaded = true;
  }

  private async ensure(): Promise<void> {
    if (!this.loaded) await this.prime();
  }

  async setMode(mode: ApprovalMode): Promise<void> {
    await this.ensure();
    this.mode = mode;
  }

  currentMode(): ApprovalMode {
    return this.mode;
  }

  async evaluate(
    tool: string,
    input: Record<string, unknown>,
    onRequest: (req: ApprovalRequest) => void,
    runId = "default",
  ): Promise<{ approved: boolean; reason: string; request?: ApprovalRequest }> {
    await this.ensure();
    const verdict = decide(tool, input, this.cache, this.mode);
    if (verdict.decision === "allow") return { approved: true, reason: verdict.reason };
    if (verdict.decision === "deny") return { approved: false, reason: verdict.reason };

    const request: ApprovalRequest = {
      id: randomUUID(),
      tool,
      args: input,
      danger: verdict.danger,
      reason: verdict.reason,
      allowKey: verdict.allowKey,
    };
    onRequest(request);

    const outcome = await new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        resolve({ approved: false, remember: false });
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(request.id, { request, runId, resolve, timer });
    });

    if (outcome.approved && outcome.remember && request.allowKey) {
      this.cache.add(request.allowKey);
      await rememberAlwaysAllow(request.allowKey);
    }
    return { approved: outcome.approved, reason: outcome.approved ? "用户已批准" : "用户拒绝或超时", request };
  }

  resolve(id: string, approved: boolean, remember = false): { ok: boolean; runId?: string } {
    const entry = this.pending.get(id);
    if (!entry) return { ok: false };
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve({ approved, remember });
    return { ok: true, runId: entry.runId };
  }

  cancelRun(runId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.runId !== runId) continue;
      clearTimeout(entry.timer);
      entry.resolve({ approved: false, remember: false });
      this.pending.delete(id);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
