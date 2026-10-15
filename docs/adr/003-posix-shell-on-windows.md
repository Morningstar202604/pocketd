# 003 — Windows 上仍优先使用 POSIX shell

状态: 已采纳 (2026-10)

## 背景

`bash` 工具需要一个 shell 来执行模型给出的命令。初始实现按平台二选一：Windows 用
`powershell.exe -Command`，其他平台用 `/bin/sh -c`。

实测暴露出问题：模型（按训练先验）生成的命令是 POSIX 形态——`echo a; echo b 1>&2`、
管道、`&&`、`$(...)`。在 PowerShell 下这些要么语法错误，要么语义不同
（实测 `echo err 1>&2` 直接报 "The '1>&2' operator is reserved for future use"）。

## 选项

1. **Windows 用 PowerShell（平台原生）** — 语义正确但对模型不可预测。
2. **全平台统一 POSIX shell** — 与 Termux 目标一致，与模型的命令先验一致。

## 决定

采纳选项 2。解析顺序（唯一实现在 `src/agent/shell.ts`，终端面板与 `bash` 工具共用）：

1. `POCKETD_SHELL` 环境变量（显式覆盖，旧名 `ZCODE_SHELL` 仍兼容）
2. 非 Windows：`$SHELL` → `/bin/sh`
3. Windows：绝对路径候选 → `PATH` 上的 `bash.exe`/`sh.exe`
4. 兜底：`powershell.exe`

### Windows 上必须用绝对路径

只按名字找 `bash.exe` 是**不够**的：`C:\Windows\System32\bash.exe` 是 WSL 的启动存根，
它**能启动**但内部立刻失败：

```
<3>WSL (2779 - Relay) ERROR: CreateProcessCommon:818: execvpe(/bin/bash) failed
```

更麻烦的是同一台机器上两条查找路径结果不一致 —— 实测 `spawnSync("bash.exe")` 命中 Git Bash，
而 node-pty 的 spawn 命中 System32 的 WSL 存根。所以候选按绝对路径优先
（`C:/Program Files/Git/usr/bin/bash.exe` 等），并且探测不能只看 `error`：
还要检查退出码与输出里有没有 `execvpe` / `CreateProcessCommon` 这类存根特征。

## 理由

- 真实目标平台（Android/Termux）是 POSIX，开发平台与目标平台行为一致能减少"本地能跑、手机不行"。
- 模型不需要根据不同平台改变命令风格，工具描述也不必分支。
- 项目的开发工作流本身就是 Git Bash（`termux-setup.sh` 等一系列脚本）。

## 后果

- 未安装 Git for Windows 的机器会退回 PowerShell，此时模型给的 POSIX 命令可能失败；工具描述中不
  做分支说明，依赖模型从错误输出中自适应。
- 超时终止需要杀进程组：POSIX 下 `spawn(detached:true)` + `process.kill(-pid)`，Windows 下
  `taskkill /T /F`。否则 `yes x | head -c N` 这类管道会挂住整个超时窗口。
- 终端面板曾经**绕过**这套解析、硬编码 `powershell.exe`，导致同一台机器上工具与终端行为不一致
  （工具用 bash、终端用 PowerShell）。现已统一到 `resolveShell()`。
