# Architecture — pocketd

English | [中文](#技术架构)

A technical deep-dive into the internals of pocketd.

---

## What this is

A local-first **coding agent** that runs on an Android device under Termux and serves a PWA from
`localhost:3030`. It is not a chat wrapper around an API: the model drives real tools (file I/O,
shell, search, Git, MCP) against the workspace, under a user-configurable approval policy.

### What it is actually for

The phone is not a place to write a feature from scratch — a 6" touch screen without a keyboard is
worse than a laptop by an order of magnitude. The scenarios where this app is genuinely better than
"wait until you're at a desk" are:

| Scenario | Why the phone wins |
|---|---|
| **Direct the agent, then put the phone away** | You describe the task, pocket the phone, and come back to a diff or a result. This is the primary scenario and the reason runs outlive the connection (ADR-005). |
| **Surgical edits while away** | Bump a version, fix a typo, tweak a config, revert a bad commit. Small, bounded, verifiable. |
| **Reading** | Read a diff or get oriented in unfamiliar code while commuting. |
| **The phone as a terminal into a server** | Termux + jump hosts; the terminal tab covers it. |

Two consequences follow from that, and both are load-bearing design constraints:

1. **The chat is the home screen, not one tab among six.** On a narrow viewport the app lands on the
   chat panel; the editor is one tap away, not the other way around.
2. **Nothing may depend on the tab staying open.** Screen lock, app switching and Android reclaiming
   background tabs are the normal case on a phone, not edge cases. Hence the server-owned run
   registry, the 15-minute approval window, and the re-attach-on-load behaviour.

The honest constraint underneath all of this: Termux + Node on Android is fragile in ways the README
states plainly (no APK means no foreground service, no reliable push notification; `node-pty` needs
an on-device compile; battery optimisers kill Termux). Every reliability improvement available inside
those limits is worth making, and "the run survives the client" was the largest one.

---

## Module map

| Module | Responsibility |
|---|---|
| `server.ts` | Hono routes, token gate, WebSocket terminal, SPA serving |
| `src/agent/runtime.ts` | Workspace sandbox, path resolution, trash+restore, secrets, directory walking |
| `src/agent/tools.ts` | The built-in tool set and shell execution |
| `src/agent/permissions.ts` | Approval policy, hard-deny rules, request broker |
| `src/agent/loop.ts` | Multi-step agent loop (Vercel AI SDK `streamText`) + history bounding |
| `src/agent/runs.ts` | **Run registry — runs outlive the HTTP connection (ADR-005)** |
| `src/agent/mcp.ts` | MCP client manager (official SDK; HTTP + stdio) |
| `src/agent/sessions.ts` | Server-side session persistence (`node:sqlite`) |
| `src/agent/search.ts` | Workspace search & replace (Node stdlib, cross-platform) |
| `src/agent/git.ts` | Git invocation (simple-git) |

---

## Technology Layer

### Server (Node.js ≥ 24)

| Concern | Implementation |
|---|---|
| HTTP framework | [Hono](https://hono.dev) on `@hono/node-server` |
| WebSocket | `ws` — terminal PTY over the HTTP upgrade |
| LLM orchestration | [Vercel AI SDK 7](https://ai-sdk.dev) `streamText` + `stopWhen: stepCountIs(n)` |
| Provider | `@ai-sdk/openai-compatible` — any OpenAI-compatible endpoint |
| Tool schemas | `zod` (built-in tools), `jsonSchema` (MCP tools) |
| MCP | `@modelcontextprotocol/sdk` — `StreamableHTTPClientTransport` + `StdioClientTransport` |
| Git | `simple-git` |
| Persistence | `node:sqlite` (`DatabaseSync`, WAL) — zero extra dependency |
| Search | Node stdlib walker + RegExp — no `grep` binary required |

**Why the AI SDK instead of hand-rolled fetch/SSE:** the previous implementation hand-parsed SSE,
hand-merged `tool_calls` deltas, and hand-rolled a 5-round tool loop. The SDK owns all of that plus
provider quirks, retries, and usage accounting. Nesting a loop inside `streamText` also means the
loop terminates on the SDK's terms (`stepCountIs`) rather than a `safety--` counter.

### Frontend (Vite + React + TypeScript)

| Concern | Implementation |
|---|---|
| Bundler | Vite 5 |
| State | Zustand — single store |
| Editor | `@monaco-editor/react` |
| Terminal | `@xterm/xterm` + fit + web-links |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-sanitize` + `rehype-highlight` |
| Styling | CSS custom properties `[data-theme="dark\|light"]` |
| Component tests | Vitest + Testing Library (jsdom) |

**Markdown is a single shared component** (`ui/src/components/Markdown.tsx`) used by both the chat
panel and the knowledge panel. The previous code had two divergent regex renderers, one of which fed
`dangerouslySetInnerHTML` with no sanitization step.

---

## Design system

All visual decisions live in `ui/src/index.css` as custom properties. Components reference tokens;
they do not carry literal colors or ad-hoc sizes.

### Type scale

Thirteen scattered px values collapsed to eight steps. Body is 13px; steps above it follow a ~1.25
modulus so successive headings are visibly distinct.

| Token | px | Role |
|---|---|---|
| `--text-2xs` | 10 | Badges, keyboard hints (9px was bumped — unreadable on mobile) |
| `--text-xs` | 11 | Metadata, labels, buttons |
| `--text-sm` | 12 | Secondary body, code |
| `--text-base` | 13 | Body (base) |
| `--text-lg` | 15 | Section titles, wordmark |
| `--text-xl` | 18 | Stat numbers |
| `--text-2xl` | 24 | Empty-state glyphs |
| `--text-3xl` | 32 | Brand display |

Line height is `--leading-tight` / `--leading-normal` / `--leading-relaxed`.

Monaco and xterm take `fontSize` as a **JS number**, not a CSS value — those two call sites stay
numeric with a comment saying why.

### Colour and contrast

Every foreground/background pair is verified against WCAG 2.1 (§1.4.3). The measured ratio for the
worst surface each token appears on is recorded next to the token. Before this pass, `--fg-dim`
failed on **all eight** surface pairs (2.72–3.85:1) while carrying real content such as approval
reasons and file sizes, and `#fff` on `--accent` failed at 3.22:1 on nine primary buttons.

| Token | Worst measured ratio | Was |
|---|---|---|
| `--fg` | 10.79:1 (dark) / 15.06:1 (light) | 8.91 / 13.88 |
| `--fg-muted` | 6.69:1 / 7.19:1 | 5.05 / 5.40 |
| `--fg-dim` | **4.60:1** / **4.96:1** | **2.95 ✗ / 2.72 ✗** |
| `--accent` (as text) | **4.59:1** / **4.74:1** | **4.10 ✗ / 3.04 ✗** |
| `--fg-on-accent` on `--accent` | **5.82:1** / **5.66:1** | 3.22 ✗ / 3.77 ✗ |
| `--error` on `--bg-alt` | 6.01:1 / 5.99:1 | 4.03 ✗ |

Two structural fixes made those numbers possible:

1. **`--fg-on-accent`** — dark theme now puts near-black text on the bright accent; light theme puts
   white on a darker accent. Hard-coding `#fff` cannot satisfy both.
2. **Deeper overlay surfaces in dark theme** — `--bg-overlay` / `--bg-hover` were lightened down so
   the contrast floor for dim text rises without collapsing the three-level text hierarchy.

Code highlighting is token-driven (`.hljs-*` mapped to `--hl-*`). The previous build imported
`highlight.js/styles/github-dark.css`, which forced every code block dark even in light theme.

`color-scheme` is declared per theme so native controls and scrollbars follow, and the
`theme-color` meta is rewritten at runtime by an effect in `App.tsx`.

### Fonts

No web fonts (a local-first app must boot offline). The sans and mono stacks both enumerate CJK
families explicitly — Chinese inside a monospace context (file paths, git output, inline code) would
otherwise fall out of the mono stack and change metrics mid-line.

### Radii, layers, controls

Six radius steps (`--radius-xs`…`--radius-xl`, `--radius-pill`) replace ten ad-hoc values. Layers use
`--z-drawer` / `--z-modal` / `--z-dropdown` / `--z-command` / `--z-toast`. Interactive sizing is
`--control-h` (34px desktop) / `--control-h-sm` / `--icon-btn`.

### Touch targets

The 44px mobile minimum is enforced on **CSS classes** (`.icon-btn`, `.btn`, `.row-btn`, `.chip`,
`.field`, `.touch-row`), not on inline styles — inline `min-height` beats any stylesheet rule, which
is how ~25 controls were silently staying below 44px on mobile before. Components therefore never
hard-code a control height.

### Brand

| Asset | Where |
|---|---|
| Mark geometry | `ui/src/components/Brand.tsx` (`MarkSvg`) + `ui/public/pocketd-icon.svg` — same path data, asserted by a test |
| Wordmark | `Wordmark` component; the only implementation (previously TopBar and Onboarding used different letter-spacing) |
| PNG icons | Generated by `tools/make-icons.mjs` (`npm run icons`) — hand-rolled PNG encoder over `node:zlib`, no image dependency |
| Verification | `tests/brand-assets.test.ts` decodes the generated PNGs and asserts size, brand-colour corners, white glyph at centre, and maskable safe-zone clearance |

iOS ignores SVG for `apple-touch-icon`, hence the generated PNGs. `tools/png-read.mjs` is the
matching decoder used by that test.

### State primitives

`ui/src/components/StateView.tsx` provides `EmptyState` / `LoadingState` / `ErrorState` /
`InlineNotice` — the single implementation for states that previously had five different treatments
each. `ui/src/components/Dialog.tsx` + `ui/src/lib/dialog.ts` replace native `confirm()` / `prompt()`
with a branded, focus-managed dialog; the API is imperative (`await askConfirm(...)`) so the store can
call it without depending on the component layer.

`ErrorState` exists because FilePanel, EditorArea, KnowledgePanel and SearchPanel previously had no
error surface at all — failures only produced a 2.5s toast, and a failed search was reported as
"no results".

---

## Agent loop

The run is owned by the server, not by the request. The HTTP response is only a *subscriber* to the
run's event stream, so a dropped connection pauses nothing — see ADR-005.

```
Client                      Server                       Upstream LLM
  │                             │                            │
  │ POST /api/chat/stream       │                            │
  │  messages, sessionId        │  runRegistry.start()       │
  │────────────────────────────▶│  ┌── run (background) ──┐  │
  │◀── x-pocketd-run-id header ───│  │ runAgent → streamText│─▶│
  │                             │  │                      │◀─│ text-delta
  │ SSE "message"  ◀────────────│  │ emit → seq + buffer  │  │
  │ SSE "thinking" ◀────────────│  │                      │  │
  │                             │  │ tools.execute()      │  │
  │                             │  │  └ permissions.decide│  │
  │ SSE "tool-call" ◀───────────│  │                      │  │
  │ SSE "tool-result" ◀─────────│  │                      │─▶│ (step 2)
  │                             │  │                      │◀─│ tool-call (bash)
  │ SSE "approval-request" ◀────│  │  └ broker awaits …   │  │
  │                             │  └──────────────────────┘  │
  │ POST /api/agent/approval    │                            │
  │────────────────────────────▶│ broker.resolve()           │
  │                             │  └─ execute bash            │
  │ SSE "tool-result" ◀─────────│                            │
  │ SSE "usage"/"run-finish" ◀──│                            │
  │  data: [DONE]  ◀────────────│  run retained 10 min        │
  │                             │                            │
  ╳  ← 手机锁屏 / 标签被回收：只解除订阅，运行继续
  │
  │ POST /api/agent/runs/:id/stream?from=0   ← 重开页面后接回
  │────────────────────────────▶│ 先回放缓冲事件，再转直播
  │◀── 完整历史 + 待批审批 + 继续直播 ─────────│
```

### SSE event contract

| Event | Payload | Notes |
|---|---|---|
| `run-start` | `{runId, sessionId, tools[]}` | tool names available this run |
| `step` | `{index}` | one per upstream round |
| `message` | `{content}` | text delta |
| `thinking` | `{content}` | reasoning delta |
| `tool-call` | `{id, name, input}` | before execution |
| `tool-result` | `{id, name, output, isError?}` | after execution |
| `approval-request` | `{id, tool, args, danger, reason}` | interactive; see below |
| `run-status` | full run snapshot | sent once at the end of every replay; the client reconciles pending approvals from it |
| `truncated` | `{from, oldest}` | the requested start fell out of the ring buffer — rebuild, don't append |
| `usage` | `{promptTokens, completionTokens, totalTokens}` | real, non-estimated |
| `run-finish` | `{runId, steps, toolCalls, textLength}` | |
| `error` / `warning` / `aborted` | `{message}` / `{message}` / `{reason}` | |
| — | `data: [DONE]` | terminator |
| — | `: ping` | comment heartbeat every 20 s while a run waits for approval |

### Run lifecycle

| Endpoint | Purpose |
|---|---|
| `POST /api/chat/stream` | Start a run; the response streams it and carries `x-pocketd-run-id` |
| `GET /api/agent/runs` | List recent runs (discover an in-flight one) |
| `GET /api/agent/runs/:id?from=N` | One-shot status + replay (used on load to decide whether to re-attach) |
| `GET /api/agent/runs/:id/stream?from=N` | Re-attach: replay from N, then live |
| `POST /api/agent/runs/:id/cancel` | Cancel the **run** (not the connection) |

Client side: `ui/src/lib/chatStream.ts` is the single SSE parser, shared by the live path and the
re-attach path so both render identically. The client persists `activeRun` (`runId`, session index)
in `localStorage`; on load it re-attaches and rebuilds the assistant message from `seq 0`.

**Cancellation is run-scoped.** A dropped connection is not a cancellation, and a cancellation is
not a dropped connection: they are separate endpoints and separate client actions.

### Context bounding

The client sends its full display history every turn, including every historical tool output. Left
alone that grows without bound. `boundHistory()` in `loop.ts` keeps the most recent 12 turns intact
and degrades older ones:

- assistant `tool_calls` and their `tool` results are **dropped together** — dropping half would
  produce a tool result with no matching call, which providers reject;
- old text is truncated (kept, not dropped — removing it breaks conversational continuity);
- old multimodal messages keep their text and lose the images.

The invariant "no orphan tool result" is asserted by a test. When anything is trimmed, a `warning`
event tells the user.

---

## Preview

The workspace doubles as a static site root, because the realistic phone scenario is "I built a web
app in the workspace, show me it working".

| Route | Purpose |
|---|---|
| `GET /preview/*` | Serves workspace files with correct MIME types; directories get a generated index page. Relative paths (`style.css`, `app.js`, images) resolve naturally because the prefix maps 1:1 onto the workspace tree. |
| `GET /api/file/raw?path=` | Raw bytes, for image preview and downloads — no text decoding. |

Both go through the same `safeExistingPath` sandbox as every other file route; an encoded `../`
segment returns `路径越界` (asserted in verification), and an absolute path is rejected.

Editor behaviour by file kind (`ui/src/lib/fileKind.ts` decides, `EditorArea.tsx` renders):

- **image** → shown directly from the raw endpoint. Opening an image used to fail with
  "binary file, refusing to read as text", i.e. images could not be opened at all.
- **markdown / html** → Monaco by default with a preview toggle. The HTML preview is an `<iframe>`
  pointed at `/preview/<path>` (so relative assets resolve) with `sandbox` that deliberately omits
  `allow-same-origin`: the previewed page cannot touch the app's storage.
- everything else → Monaco.

`store.loadFile` skips the text read for images, so no error surfaces for a file that is perfectly
openable.

---

## Streaming UX

The chat had one behaviour that actively fought the user: it scrolled to the bottom on every
message change, so reading back through a long answer while the model was still writing meant being
dragged down repeatedly.

The contract now is: **follow only if the user is already near the bottom** (`< 80px`). Otherwise
show a floating "back to bottom" button that grows a dot when new output arrives. This is asserted
in `ChatPanel.test.tsx` by spying on `Element.prototype.scrollTo` — jsdom does not really scroll, so
the assertion is on *whether the app ordered a scroll*, which is exactly the contract.

Also: a blinking cursor marks the message being generated (and only that one), running tool calls
pulse so "working" is distinguishable from "stuck", code blocks and whole messages have copy
buttons, and the quick prompts live in the main area when the conversation is empty — the space is
used for content instead of a permanently visible strip.

---

## Permissions

Approval happens **inside the tool's `execute`**, via a broker promise resolved by an HTTP POST.
The alternative — the AI SDK's `toolApproval` + persist/resume flow — was rejected because it
requires the client to round-trip whole assistant messages and the server to re-enter the stream;
the broker gives the same UX with far less state. See ADR-002.

### Modes (`~/.pocketd/state/secrets.json` → `approvalMode`, or `POCKETD_APPROVAL_MODE`)

| Mode | Behaviour |
|---|---|
| `auto` | No prompts at all. Hard-deny list still applies. |
| `edits` (default) | File writes/edits/replace allowed; `bash`, `delete_path`, and MCP tools ask. |
| `strict` | Everything except read-only tools asks. |

### Hard deny (never prompts, cannot be approved)

`rm -rf /`, `mkfs*`, `dd of=/dev/sd*`, fork bombs, `chmod -R 777 /`, block-device redirection,
`shutdown`/`reboot`/`halt`.

### Remembered approvals

Approving with "记住选择" stores a key (`bash:<first-token>`, `write_file:<top-dir>`) in
`alwaysAllow`, so a class of operations stops asking. Revocable from Settings.

### Path sandbox

`toWorkspacePath` rejects any resolution outside the workspace, and `assertNoSymlinkEscape`
`realpath`s the deepest existing ancestor so a symlink cannot redirect a write outside the sandbox.

---

## Built-in tools

| Tool | Approval | Notes |
|---|---|---|
| `read_file` | read-only | line-numbered, `offset`/`limit` paging, rejects binary |
| `list_dir` | read-only | directories first; marks ignored entries |
| `glob` | read-only | `**`, `*`, `?`; honours ignore rules, `include_ignored` to bypass |
| `grep` | read-only | literal or regex, structured `path:line:col`; ignores vendor dirs by default |
| `git_status` / `git_diff` | read-only | |
| `write_file` | per mode | atomic write (temp + rename) |
| `edit_file` | per mode | exact replace; refuses ambiguous matches unless `replace_all` |
| `replace_in_files` | per mode | `dry_run` defaults to true |
| `delete_path` | per mode | moves to `回收站/` with a sidecar for restore |
| `bash` | per mode | `/bin/sh -c`, process-group kill on timeout, output capped |

All tool output is capped (30 000 chars) so a runaway command cannot flood the context window.

### Ignore rules

`glob`, `grep`, `replace_in_files` and the `@` file candidates honour gitignore semantics, so a
recursive search does not walk into `node_modules` and burn the context window. Three sources are
layered, later ones able to override earlier ones:

1. `.gitignore` — read live, never copied, so there is nothing to go stale
2. `.pocketdignore` — project-specific additions
3. `.zcodeignore` — the previous brand's file, still honoured

On top of those, `.git`, `.hg`, `.svn` and both trash directories are always excluded and cannot be
re-enabled by configuration.

The split matters and is deliberate: ignore rules govern **what gets fed to the model** (search,
matching, `@` candidates), not **what the user may look at**. `list_dir` still lists ignored entries
and marks them `[已忽略]`; the file tree still lets you open them; `read_file` is unaffected. Both
`glob` and `grep` take `include_ignored: true` for the case where the user genuinely wants to search
a vendor directory, and pointing a search *at* an ignored directory disables filtering for that walk
(explicit intent wins).

`listDirectory` returns `ignored` per entry, which the file tree renders as a dimmed row with an
`忽略` badge — the answer to "why doesn't search find this file" sits next to the file itself.

### Editor sizing

Monaco is created by `@monaco-editor/react` inside a container that the wrapper renders with
`display: none` until the editor reports ready, so the editor can measure its container as 0 and
clamp itself to its 5×5 minimum. That is not self-correcting: the container's size then never
*changes*, so Monaco's own `automaticLayout` ResizeObserver never fires and nothing ever fixes it —
the editor stays a sliver.

`EditorArea` therefore drives relayout itself. `nudge()` calls `editor.layout()` and then verifies
that Monaco's reported size matches the container, retrying until it does. A `ResizeObserver` on the
container and a `window` `resize` listener make it react promptly, and a 500 ms self-check catches
anything those miss (both ResizeObserver and `resize` can fail to deliver in background tabs, and
element-level resizes do not always accompany a window resize). `layout()` also forces a synchronous
render, which is what makes a newly selected file paint immediately rather than waiting for a frame.

On narrow screens the editor is not mounted at all while the panel view is showing
(`editorHidden`), so it is never instantiated in a hidden container in the first place. The same
`useIsNarrowViewport` hook exists because a `display: none` element cannot be measured and CSS alone
does not tell JavaScript that it happened.

### Shell resolution

POSIX shell always, including on Windows: `POCKETD_SHELL` → `/bin/sh` or `$SHELL` → `bash.exe`/`sh.exe`
→ PowerShell only as a last resort. Rationale: the model emits POSIX-shaped commands, and the real
target (Termux) is POSIX. See ADR-003.

---

## MCP integration

Two transports, both from the official SDK:

| Transport | Config |
|---|---|
| `http` | `{name, type:"http", url}` — `StreamableHTTPClientTransport` |
| `stdio` | `{name, type:"stdio", command, args[]}` — `StdioClientTransport`, cwd = workspace |

Tool names are flattened to `mcp__<server>__<tool>` and sanitized to `[A-Za-z0-9_-]{1,64}`.
The previous `mcp::server::tool` separator was invalid for OpenAI function names and would be
rejected by upstream providers.

MCP servers are persisted to `~/.pocketd/state/mcp.json` and reconnected on startup.

---

## Sessions

Conversation history is persisted server-side in `~/.pocketd/state/sessions.db` (`node:sqlite`, WAL):

- `sessions(id, title, created_at, updated_at)`
- `messages(session_id, seq, role, payload JSON, created_at)`

The client sends its full display history each turn (so assistant `tool_calls` and `role:"tool"`
messages round-trip faithfully) and, alongside its throttled `localStorage` write, PUTs the whole
session to the server. The payload is the client's own `ChatMessage`, so restore is lossless.

Both copies exist for a reason: `localStorage` is the fast path, and the server copy is the only one
that survives clearing browser storage or switching device/browser. When local history is empty on
startup, the newest non-empty server session is restored automatically; the chat header's ☁ button
lists server sessions and restores any of them on demand.

A restored session may contain approval cards whose run no longer exists (the server keeps runs for
10 minutes; a session outlives that). Those are marked **expired** at restore time rather than left
looking clickable, and answering an approval that has already timed out also flips the card to
expired instead of only flashing a toast.

---

## Access control

| Bind | Behaviour |
|---|---|
| `127.0.0.1` (default) | Loopback requests pass. Nothing else is reachable. |
| `0.0.0.0` (`POCKETD_HOST`) | Every non-loopback request must present the token. |

The token is generated on first run into `~/.pocketd/state/secrets.json` (mode `0600`) and surfaced in
Settings. A browser exchanges it once via `?token=…`, which sets an `HttpOnly` cookie. The terminal
WebSocket upgrade checks the same token.

This closes the previous "binds `0.0.0.0` with no authentication" exposure, where any host on the
LAN could read the workspace and execute commands.

---

## Testing

| Suite | What it covers |
|---|---|
| `npm test` | Tools, path sandbox (incl. symlink escape), approval gate & timeout, search/replace semantics, trash restore, and the full agent loop against a **fake OpenAI-compatible upstream**; plus brand assets (decodes the generated PNGs and asserts pixels) |
| `npm run test:ui` | Component tests: state primitives, the dialog (confirm/prompt/Escape/focus/single-at-a-time), FilePanel (empty vs filtered-empty vs loading vs error+retry, row clicks, open failure), the approval card (approve/deny/remember → the exact `respondApproval` call), and store error handling (search failure surfaced instead of masked as "no results") |
| `npm run test:e2e` | Boots the real server, registers a **real stdio MCP server**, drives a chat stream, answers the approval mid-stream, and asserts tool execution, usage, SSE contract, and session persistence |

Component tests assert **user-visible behaviour** (roles, names, rendered text, resulting API calls),
never internal state shape, so a refactor doesn't redden them. The only store-level assertions are for
the error-surfacing contract, which has no other observable channel.

---

## Configuration & persistence

```
~/.pocketd/
  ├── env                    # optional env vars (loaded by the Termux script)
  ├── state/
  │   ├── secrets.json       # access token, approval mode, remembered approvals (0600)
  │   ├── mcp.json           # MCP server configs
  │   └── sessions.db        # session + message store (SQLite WAL)
  └── workspace/             # the agent's workspace (git repo)
      └── 回收站/      # soft-deleted files, with .meta.json sidecars
```

---

# 技术架构

[English](#architecture--pocketd) | 中文

## 这是什么

一个在 Termux 里本地运行的**编码 agent**，从 `localhost:3030` 提供 PWA。它不是套壳聊天：模型直接
驱动真实工具（文件、命令、搜索、Git、MCP）操作工作区，并受可配置的审批策略约束。

分两层：

- **接入层**（`server.ts`）——只做路由、鉴权、静态资源、终端 WS。
- **agent 核心**（`src/agent/`）——工具、权限、多步循环、MCP、会话。

## 模块划分

| 模块 | 职责 |
|---|---|
| `server.ts` | Hono 路由、令牌门禁、终端 WebSocket、SPA |
| `src/agent/runtime.ts` | 工作区沙箱、路径解析、回收站与恢复、密钥、目录遍历 |
| `src/agent/tools.ts` | 内置工具集与 shell 执行 |
| `src/agent/permissions.ts` | 审批策略、硬拒绝规则、审批往返 |
| `src/agent/loop.ts` | agent 多步循环（Vercel AI SDK `streamText`） |
| `src/agent/mcp.ts` | MCP 客户端管理（官方 SDK，HTTP + stdio） |
| `src/agent/sessions.ts` | 服务端会话持久化（`node:sqlite`） |
| `src/agent/search.ts` | 工作区搜索替换（Node 标准库，跨平台） |
| `src/agent/git.ts` | Git 调用（simple-git） |

## 技术选型

| 关注点 | 实现 | 为什么 |
|---|---|---|
| LLM 编排 | Vercel AI SDK 7 `streamText` | 流式、工具多步循环、usage 统计、provider 适配都由库承担，不再手写 SSE 解析与 tool_calls 增量合并 |
| 提供商 | `@ai-sdk/openai-compatible` | DeepSeek / Moonshot / Groq / Ollama / OpenAI 一个适配器通吃 |
| MCP | `@modelcontextprotocol/sdk` | 官方实现；HTTP 与 stdio 双 transport（手写版本只有 HTTP） |
| 持久化 | `node:sqlite` | Node 24 内置，零额外依赖 |
| 搜索 | Node 标准库 | 不依赖 `grep` 二进制，Windows/Termux 行为一致 |
| Git | `simple-git` | 结构化返回，不再手工切分 `for-each-ref` 字符串 |
| Markdown | react-markdown + remark-gfm + rehype-sanitize | 单一实现，强制消毒；替换原先两份会走 `dangerouslySetInnerHTML` 的正则渲染器 |

## 权限模型

审批发生在**工具 `execute` 内部**，由 HTTP POST 解除等待。没有采用 AI SDK 的 `toolApproval` +
断点续传方案，因为它要求客户端回传整条 assistant 消息、服务端重新进入流；broker 方案用户体验相同
而状态少得多（ADR-002）。

三档策略：`auto`（不询问，硬拒绝仍生效）、`edits`（默认，改文件放行，命令/删除/MCP 需批准）、
`strict`（除只读外全问）。硬拒绝清单（`rm -rf /`、`mkfs`、fork 炸弹等）永远不弹窗、也不可批准。

路径沙箱在解析越界时直接拒绝，并对最深层已存在的祖先做 `realpath` 校验，防止符号链接把写入引出工作区。

## 访问控制

默认只监听 `127.0.0.1`（回环直接放行）。设 `POCKETD_HOST=0.0.0.0` 后强制令牌鉴权：令牌首次运行生成到
`~/.pocketd/state/secrets.json`（权限 0600），浏览器用 `?token=` 换取 HttpOnly Cookie，终端 WebSocket
升级同样校验。这堵住了此前"监听全网卡且无鉴权"的暴露面。

## 测试

`npm test` 覆盖工具层、路径沙箱（含符号链接逃逸）、审批门控与超时、搜索替换语义、回收站恢复，以及
针对**假 OpenAI 兼容上游**的完整 agent 循环。`npm run test:e2e` 启动真实服务、注册**真实 stdio MCP
服务器**、在流式过程中完成审批往返，断言工具真实执行、usage、SSE 契约与会话持久化。
