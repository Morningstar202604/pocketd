/**
 * shell 解析（ADR-003 的唯一实现）。
 *
 * 模型的命令先验是 POSIX 形态（`echo a; echo b`、管道、`&&`、`$(...)`），
 * 在 PowerShell 下要么语法错误要么语义不同。真实目标平台（Android/Termux）
 * 也是 POSIX，所以全平台统一走 POSIX shell，PowerShell 只作最后兜底。
 *
 * 终端面板与 `bash` 工具共用这里 —— 两边各自实现会让行为分叉，
 * 之前终端面板就因此固定用了 PowerShell。
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { envValue } from "./brand.js";

export interface ShellSpec {
  bin: string;
  /** 把一条命令包成该 shell 的 argv */
  args: (cmd: string) => string[];
}

let cached: ShellSpec | null = null;

/**
 * Windows 上候选按绝对路径优先。
 *
 * 只用 `bash.exe` 这个名字是不够的：`C:\Windows\System32\bash.exe` 是 WSL 的启动存根，
 * 它**能启动**但内部立刻失败（`execvpe(/bin/bash) failed`），而 node-pty 的 PATH 查找
 * 会命中它 —— 实测同一台机器上 spawnSync 找到 Git Bash、node-pty 却找到 WSL 存根。
 * 所以先试绝对路径，把歧义消除掉。
 */
const WINDOWS_POSIX_CANDIDATES = [
  "C:/Program Files/Git/usr/bin/bash.exe",
  "C:/Program Files/Git/bin/bash.exe",
  "C:/Program Files (x86)/Git/usr/bin/bash.exe",
  "C:/Program Files/Git/usr/bin/sh.exe",
];

/** 认为 shell 不可用的输出特征：WSL 存根与失败注入都会打印这些 */
const SHELL_STUB_PATTERN = /execvpe|CreateProcessCommon|WSL.*ERROR|No such file or directory/i;

function probeRunsOk(bin: string): boolean {
  try {
    const r = spawnSync(bin, ["-c", "exit 0"], { windowsHide: true, encoding: "utf8", timeout: 5000 });
    if (r.error) return false;
    if (r.status !== 0) return false;
    return !SHELL_STUB_PATTERN.test(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  } catch {
    return false;
  }
}

export function resolveShell(): ShellSpec {
  if (cached) return cached;

  const override = envValue("SHELL")?.trim();
  if (override) {
    cached = { bin: override, args: (cmd) => ["-c", cmd] };
    return cached;
  }

  if (process.platform !== "win32") {
    const bin = process.env.SHELL?.trim() || "/bin/sh";
    cached = { bin, args: (cmd) => ["-c", cmd] };
    return cached;
  }

  for (const bin of WINDOWS_POSIX_CANDIDATES) {
    if (existsSync(bin) && probeRunsOk(bin)) {
      cached = { bin, args: (cmd) => ["-c", cmd] };
      return cached;
    }
  }

  // 退回 PATH 查找，但要排除 WSL 存根
  for (const bin of ["bash.exe", "sh.exe"]) {
    if (probeRunsOk(bin)) {
      cached = { bin, args: (cmd) => ["-c", cmd] };
      return cached;
    }
  }

  cached = { bin: "powershell.exe", args: (cmd) => ["-NoProfile", "-Command", cmd] };
  return cached;
}

/** 供测试重置（环境变量在进程内只解析一次） */
export function resetShellCache(): void {
  cached = null;
}
