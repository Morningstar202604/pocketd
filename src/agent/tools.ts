import { spawn, spawnSync } from "node:child_process";
import { tool } from "ai";
import { z } from "zod";
import { ApprovalBroker, type ApprovalRequest } from "./permissions.js";
import {
  WORKSPACE,
  listDirectory,
  moveToTrash,
  readFileText,
  safeExistingPath,
  safeWritablePath,
  walkFiles,
  writeFileAtomic,
} from "./runtime.js";
import { matchesGlob, replaceInProject, searchProject } from "./search.js";
import { resolveShell } from "./shell.js";
import { runGit } from "./git.js";

const MAX_TOOL_OUTPUT = 30_000;

function clamp(text: string, limit = MAX_TOOL_OUTPUT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[已截断，共 ${text.length} 字符]`;
}

export interface ToolContext {
  broker: ApprovalBroker;
  onApprovalRequest: (req: ApprovalRequest) => void;
  runId: string;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function killTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* 进程可能已退出 */
    }
  }
}

export function runShell(command: string, timeoutMs = 120_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const shell = resolveShell();
    const child = spawn(shell.bin, shell.args(command), {
      cwd: WORKSPACE,
      env: { ...process.env, TERM: "dumb", PAGER: "cat", GIT_PAGER: "cat" },
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: clamp(stdout), stderr: clamp(stderr), timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      finish(null);
    }, Math.min(Math.max(timeoutMs, 1_000), 600_000));
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_TOOL_OUTPUT * 2) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_TOOL_OUTPUT * 2) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      stderr += `\n${err.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

export function createBuiltinTools(ctx: ToolContext) {
  async function gate(toolName: string, input: Record<string, unknown>): Promise<string | null> {
    const outcome = await ctx.broker.evaluate(toolName, input, ctx.onApprovalRequest, ctx.runId);
    if (outcome.approved) return null;
    const verb = outcome.request ? "用户未批准" : "策略拒绝";
    return `「已拒绝」${verb}: ${outcome.reason}`;
  }

  return {
    read_file: tool({
      description:
        "读取工作区内的文本文件。返回带行号的内容。大文件请用 offset/limit 分段读取。",
      inputSchema: z.object({
        path: z.string().describe("相对于工作区根目录的路径"),
        offset: z.number().int().min(1).optional().describe("起始行号，从 1 开始"),
        limit: z.number().int().min(1).max(2000).optional().describe("最多读取的行数"),
      }),
      execute: async ({ path, offset, limit }) => {
        const content = await readFileText(path);
        const lines = content.split(/\r?\n/);
        const start = Math.max((offset ?? 1) - 1, 0);
        const count = limit ?? 400;
        const slice = lines.slice(start, start + count);
        const numbered = slice
          .map((line, i) => `${String(start + i + 1).padStart(5, " ")}│ ${line}`)
          .join("\n");
        const tail =
          start + count < lines.length
            ? `\n…[共 ${lines.length} 行，已显示 ${start + 1}-${start + slice.length}]`
            : `\n…[共 ${lines.length} 行]`;
        return clamp(numbered + tail);
      },
    }),

    write_file: tool({
      description:
        "创建新文件或整体覆盖已有文件。修改已有文件时优先用 edit_file，避免覆盖掉未预期的改动。",
      inputSchema: z.object({
        path: z.string().describe("相对于工作区根目录的路径"),
        content: z.string().describe("完整文件内容"),
      }),
      execute: async ({ path, content }) => {
        const denied = await gate("write_file", { path, content });
        if (denied) return denied;
        const full = await safeWritablePath(path);
        await writeFileAtomic(full, content);
        return `已写入 ${path}（${Buffer.byteLength(content, "utf8")} 字节）`;
      },
    }),

    edit_file: tool({
      description:
        "在文件中做精确字符串替换。old_string 必须在文件中唯一出现，否则请扩上下文或设置 replace_all。",
      inputSchema: z.object({
        path: z.string().describe("相对于工作区根目录的路径"),
        old_string: z.string().describe("要被替换的原文，需逐字符精确匹配"),
        new_string: z.string().describe("替换后的文本"),
        replace_all: z.boolean().optional().describe("为 true 时替换所有出现处"),
      }),
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const denied = await gate("edit_file", { path, old_string, new_string, replace_all });
        if (denied) return denied;
        if (!old_string) return "「失败」old_string 不能为空";
        const full = await safeExistingPath(path);
        const content = await readFileText(path);
        const occurrences = content.split(old_string).length - 1;
        if (occurrences === 0) return `「失败」在 ${path} 中未找到 old_string`;
        if (occurrences > 1 && !replace_all) {
          return `「失败」old_string 在 ${path} 中出现 ${occurrences} 次，不唯一。请扩大上下文或设置 replace_all=true`;
        }
        const next = replace_all
          ? content.split(old_string).join(new_string)
          : content.replace(old_string, new_string);
        await writeFileAtomic(full, next);
        return `已替换 ${replace_all ? occurrences : 1} 处（${path}）`;
      },
    }),

    delete_path: tool({
      description: "删除文件或目录。不会真正删除，会移入工作区的回收站。",
      inputSchema: z.object({
        path: z.string().describe("相对于工作区根目录的路径"),
      }),
      execute: async ({ path }) => {
        const denied = await gate("delete_path", { path });
        if (denied) return denied;
        const trashed = await moveToTrash(path);
        return `已移入回收站: ${path} → 回收站/${trashed}`;
      },
    }),

    list_dir: tool({
      description:
        "列出目录内容。目录在前，文件在后。标 [已忽略] 的条目仍可打开，但默认不会被 grep/glob 收录。",
      inputSchema: z.object({
        path: z.string().optional().describe("相对路径，默认工作区根目录"),
      }),
      execute: async ({ path }) => {
        const items = await listDirectory(path || ".");
        if (items.length === 0) return "(空目录)";
        return items
          .map((i) => {
            const flag = i.ignored ? " [已忽略]" : "";
            return i.type === "directory"
              ? `[目录] ${i.path}/${flag}`
              : `[文件] ${i.path}${i.size != null ? ` (${i.size}B)` : ""}${flag}`;
          })
          .join("\n");
      },
    }),

    glob: tool({
      description:
        "按 glob 模式查找文件。支持 ** 递归通配，例如 src/**/*.ts、**/*.md。" +
        "默认遵守 .gitignore/.pocketdignore（不进 node_modules 等），确需在忽略目录里找时传 include_ignored=true。",
      inputSchema: z.object({
        pattern: z.string().describe("glob 模式"),
        path: z.string().optional().describe("搜索起点，默认工作区根目录"),
        limit: z.number().int().min(1).max(2000).optional(),
        include_ignored: z.boolean().optional().describe("无视忽略规则"),
      }),
      execute: async ({ pattern, path, limit, include_ignored }) => {
        const files = await walkFiles(path || ".", { includeIgnored: include_ignored });
        const hits = files.filter((f) => matchesGlob(f, pattern)).slice(0, limit ?? 300);
        if (hits.length === 0) return `没有匹配 ${pattern} 的文件`;
        return clamp(hits.join("\n"));
      },
    }),

    grep: tool({
      description:
        "在工作区内容里搜索文本或正则。返回 路径:行号:列号: 匹配行。include 可限定文件 glob。" +
        "默认遵守 .gitignore/.pocketdignore，确需搜索忽略目录时传 include_ignored=true。",
      inputSchema: z.object({
        query: z.string().describe("搜索内容"),
        regex: z.boolean().optional().describe("把 query 当正则解释"),
        case_sensitive: z.boolean().optional(),
        include: z.string().optional().describe("文件 glob，例如 **/*.ts"),
        path: z.string().optional().describe("搜索起点，默认工作区根目录"),
        limit: z.number().int().min(1).max(1000).optional(),
        include_ignored: z.boolean().optional().describe("无视忽略规则"),
      }),
      execute: async ({ query, regex, case_sensitive, include, path, limit, include_ignored }) => {
        const result = await searchProject({
          query,
          regex,
          caseSensitive: case_sensitive,
          include,
          path,
          maxResults: limit ?? 200,
          includeIgnored: include_ignored,
        });
        if (result.matches.length === 0) {
          return `无匹配（已扫描 ${result.filesScanned} 个文件）`;
        }
        const body = result.matches
          .map((m) => `${m.path}:${m.line}:${m.column}: ${m.text.trim()}`)
          .join("\n");
        const suffix = result.truncated ? "\n…[结果已截断]" : "";
        return clamp(`${body}${suffix}\n\n（${result.matches.length} 处匹配，扫描 ${result.filesScanned} 个文件）`);
      },
    }),

    replace_in_files: tool({
      description:
        "跨文件替换。默认 dry_run=true 只预览不改动，确认无误后传 dry_run=false 落盘。",
      inputSchema: z.object({
        query: z.string(),
        replacement: z.string(),
        regex: z.boolean().optional(),
        case_sensitive: z.boolean().optional(),
        include: z.string().optional().describe("文件 glob"),
        dry_run: z.boolean().optional().describe("默认 true，仅预览"),
      }),
      execute: async ({ query, replacement, regex, case_sensitive, include, dry_run }) => {
        const isDry = dry_run !== false;
        if (!isDry) {
          const denied = await gate("replace_in_files", { query, replacement, include: include ?? null });
          if (denied) return denied;
        }
        const result = await replaceInProject({
          query,
          replacement,
          regex,
          caseSensitive: case_sensitive,
          include,
          dryRun: isDry,
        });
        if (result.filesAffected === 0) return "没有文件需要改动";
        const body = result.changed
          .map((c) => `${c.path} (${c.matches} 处)`)
          .join("\n");
        return `${isDry ? "预览" : "已替换"}: ${result.filesAffected} 个文件 / ${result.totalMatches} 处\n${clamp(body, 4000)}`;
      },
    }),

    git_status: tool({
      description: "查看 git 工作区状态与当前分支。",
      inputSchema: z.object({}),
      execute: async () => {
        const [status, branch] = await Promise.all([
          runGit(["status", "--porcelain=v1", "-b"]),
          runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
        ]);
        if (status.code !== 0) return `git status 失败: ${status.stderr.trim()}`;
        const lines = status.stdout.split("\n").filter(Boolean);
        const head = branch.code === 0 ? `当前分支: ${branch.stdout.trim()}` : "";
        return clamp([head, ...lines].filter(Boolean).join("\n") || "(工作区干净)");
      },
    }),

    git_diff: tool({
      description: "查看未提交的改动。可指定文件路径；staged=true 查看已暂存的改动。",
      inputSchema: z.object({
        path: z.string().optional(),
        staged: z.boolean().optional(),
      }),
      execute: async ({ path, staged }) => {
        const args = ["diff", "--no-color"];
        if (staged) args.push("--cached");
        if (path) args.push("--", path);
        const r = await runGit(args);
        if (r.code !== 0) return `git diff 失败: ${r.stderr.trim()}`;
        if (!r.stdout.trim()) return "(无改动)";
        return clamp(r.stdout);
      },
    }),

    bash: tool({
      description:
        "在工作区根目录执行 shell 命令。支持管道与多命令。危险命令会被策略拦截，其余需用户批准。",
      inputSchema: z.object({
        command: z.string().describe("要执行的命令"),
        timeout_ms: z.number().int().min(1000).max(600000).optional().describe("超时，默认 120000ms"),
      }),
      execute: async ({ command, timeout_ms }) => {
        const denied = await gate("bash", { command });
        if (denied) return denied;
        const r = await runShell(command, timeout_ms);
        const parts: string[] = [];
        if (r.stdout.trim()) parts.push(r.stdout.trimEnd());
        if (r.stderr.trim()) parts.push(`[stderr]\n${r.stderr.trimEnd()}`);
        if (r.timedOut) parts.push("[超时被终止]");
        parts.push(`[退出码 ${r.code ?? "null"}]`);
        return clamp(parts.join("\n"));
      },
    }),
  };
}

export type BuiltinTools = ReturnType<typeof createBuiltinTools>;

export async function summarizeWorkspace(): Promise<string> {
  const items = await listDirectory(".");
  const top = items.slice(0, 40).map((i) => (i.type === "directory" ? `${i.name}/` : i.name));
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  return [
    `工作区根目录: ${WORKSPACE}`,
    `当前分支: ${branch.code === 0 ? branch.stdout.trim() : "(非 git 仓库)"}`,
    `顶层条目: ${top.join(", ")}`,
  ].join("\n");
}
