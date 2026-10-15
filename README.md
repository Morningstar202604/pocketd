# pocketd — turn your Android phone into a coding agent that actually works

<div align="center">

**English | [中文](README.zh-CN.md) | [日本語](README.ja.md)**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 24](https://img.shields.io/badge/node-%3E%3D%2024-brightgreen.svg)](https://nodejs.org)
[![TypeScript 7](https://img.shields.io/badge/TypeScript-7-blue.svg)](https://www.typescriptlang.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev)
[![Tests](https://img.shields.io/badge/tests-139%20passing-brightgreen.svg)](#development)

*A local-first coding agent that runs on your phone — real tools, real files, your approval*

[Quick start](#quick-start) · [Features](#features) · [API](#http-api) · [Architecture](docs/ARCHITECTURE.md) · [Decisions](docs/adr/) · [Mobile notes](docs/MOBILE.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## What this is

`pocketd` is a self-contained, local-first **coding agent** that runs inside [**Termux**](https://termux.dev) on an Android phone and is reachable from a browser.

It is not a chat wrapper. The model gets a set of **real tools** — read and write files, apply exact edits, search and replace, execute shell commands, inspect Git state, call MCP servers — and every one of them operates on your workspace under an **approval policy you configure**. **No cloud account, no OAuth, no telemetry.** All data stays on your device. AI capability comes from your own API key, and any OpenAI-compatible provider works (DeepSeek, Moonshot, Groq, Ollama, OpenAI, …).

### What you actually use it for on a phone

Let's be clear about what this is *not*: it is not where you write a feature from scratch on a 6-inch screen. No physical keyboard, no multiple windows — a laptop beats it by an order of magnitude at that. The scenarios where it genuinely wins:

| Scenario | Why the phone is the better device |
|---|---|
| **Direct the agent, then pocket the phone** | Say "fix that failing auth test", lock the screen, walk away, come back to a diff or a result. **This is the primary scenario** — and the reason runs outlive the connection |
| **Surgical edits on the move** | Bump a version, fix a typo, adjust config, revert a bad commit — small, bounded, verifiable |
| **Reading** | Read a diff on the commute, or get oriented in unfamiliar code fast |
| **Your phone as a terminal into a server** | Termux plus a jump host; the terminal tab covers this |

Two hard constraints follow, and both are visible in the implementation:

1. **Chat is the home screen, not one of six tabs.** On a narrow viewport the app lands on the chat panel; the editor is something you tap *into*, not the other way around.
2. **Nothing may assume the tab stays open.** Locking the screen, switching apps, and Android reclaiming background tabs are **the norm on a phone, not edge cases** — hence server-owned runs, a 15-minute approval window, and automatic reattach when the page reopens.

### The runtime ceiling, stated plainly

No APK means no foreground service, which means no reliable notification. `node-pty` must be compiled on-device (clang/make; some ABIs will fail). Android battery optimisation will kill Termux. **"An agent that can't notify you is just a web page you have to stare at"** — that limit cannot be designed away in this form factor, only mitigated. So everything that *can* be made reliable within those limits, is: runs detached from the client, a long approval window, automatic reattach, history persisted server-side.

---

## Features

| Module | Capabilities |
|--------|--------------|
| **Agent** | 11 built-in tools · multi-step tool loop (up to 40 steps) · tool-call visualisation · three approval modes · hard-deny list · "remember this choice" to skip future prompts |
| **Resilience** | **Closing the page or locking the screen does not interrupt a run** (runs are owned by the server) · reopening the page reattaches and replays history · 15-minute approval window · explicit "reconnect" affordance when the stream drops |
| **Approval** | `bash`, deletion and MCP tools require approval by default · risk levels · argument preview · timeout counts as denial (fail closed) · stale cards marked explicitly |
| **MCP** | Official SDK · **both HTTP and stdio transports** · tools discovered and registered automatically · names normalised to provider rules · add/enable/disable from Settings |
| **Editor** | Monaco Editor · multiple tabs · syntax highlighting · `Ctrl+S` to save · tuned for touch |
| **Files** | Directory navigation · fuzzy filter · create · delete to trash (**restorable to the original path**) · drag-and-drop upload · ignored entries dimmed · hidden-file toggle |
| **Ignore rules** | `.gitignore` **read live** (no copy to go stale) · `.pocketdignore` layered on top · legacy `.zcodeignore` still honoured · `node_modules` and friends no longer walked · `include_ignored` to opt out explicitly |
| **Terminal** | xterm.js · node-pty · real bash/zsh · WebSocket streaming |
| **Chat** | Streaming SSE · tool-call cards · approval cards · multiple sessions (**server-synced, one-tap restore**) · slash commands · attachments (paste/drag/camera) · vision input · thinking trace display |
| **Context** | Automatic bounding: the most recent 12 turns are kept verbatim, older tool traffic is degraded; truncation is announced, and the message sequence never becomes invalid |
| **Preview** | **Images render directly** (no more "binary file" errors) · Markdown preview · HTML preview in a sandboxed iframe · **browse the workspace as a static site** (`/preview/`, directory index, relative assets resolve) · "open in new tab" for any file |
| **Streaming UX** | Cursor follows the output · **never steals your scroll position** (offers "jump to bottom" instead) · tool calls breathe while running · one-click copy for code blocks and whole messages |
| **Git** | Branch graph (ahead/behind) · diff/log/add/commit · merge · push/pull/fetch · checkout/branch/remote |
| **Search** | Structured `path:line:col` results · cross-platform (no dependency on a grep binary) · jump to line |
| **Replace** | Preview before committing · list of changed files with match counts · identical semantics for regex and literal modes |
| **Knowledge base** | Scans the project structure into a rich Markdown document, rendered by the same renderer as chat |
| **Stats** | Real token usage · 7-day trend chart · call history |
| **Security** | Loopback-only by default · access token enforced for non-loopback · path sandbox (including symlink protection) |
| **Settings** | Five provider presets · approval mode switch · tool inventory · access token · MCP management |
| **Design system** | Eight-step type scale · every contrast pair meets WCAG AA (measured values recorded next to the tokens) · complete light and dark themes (including Monaco, xterm and syntax highlighting) · 44px touch targets |
| **Brand** | Geometric lowercase-d mark (component and favicon share one geometry, guarded by tests) · PNG icons with a maskable safe zone · apple-touch-icon · OG/Twitter metadata · dynamic `theme-color` |
| **Theming / mobile** | Dark/light CSS variables · bottom five-tab navigation · safe-area insets · ARIA · no ⌘/Ctrl hints on touch devices |
| **Onboarding** | Three-step first-run wizard |

---

## Quick start

### Android (Termux)

```bash
# 1. System dependencies
pkg update -y
pkg install -y nodejs git python make clang pkg-config

# 2. Clone
git clone https://github.com/badhope/pocketd.git
cd pocketd

# 3. Install, build and start in one step
chmod +x termux-setup.sh && ./termux-setup.sh
```

The script installs dependencies, builds the frontend, writes `~/.pocketd/env`, then **starts the server in the foreground** (Ctrl+C to stop).

Open `http://localhost:3030` in Chrome for Android and choose **Add to Home screen**. You get a standalone PWA: no address bar, proper icon, dark theme. `pocketd` ships no APK — a Node runtime cannot live inside a Capacitor-style WebView shell, and the editor, terminal and Git are all served by the process inside Termux.

To keep it running in the background:

```bash
termux-wake-lock           # stop the system from reclaiming it
nohup npm start > ~/.pocketd/server.log 2>&1 &
```

### macOS / Linux / Windows

Requires **Node ≥ 24.15** (check with `node -v`). The frontend test suite uses jsdom 30, which needs 24.15 or newer; older 24.x can run the server itself but `npm run test:ui` will be blocked by the engine check.

```bash
git clone https://github.com/badhope/pocketd.git
cd pocketd
npm install
cd ui && npm install && npm run build && cd ..
npm start
```

Then open `http://localhost:3030`.

> Configuration is loaded from `~/.pocketd/env`, and can also be set directly in the browser's Settings panel. [See Configuration](#configuration).

---

## Configuration

AI capability needs an API key. Any OpenAI-compatible provider works (OpenAI, DeepSeek, Moonshot, Groq, Ollama, …).

### Environment variables (`~/.pocketd/env`)

```bash
export POCKETD_API_KEY="sk-xxx"
export POCKETD_API_BASE="https://api.deepseek.com/v1"
export POCKETD_API_MODEL="deepseek-chat"
export POCKETD_WORKSPACE="$HOME/.pocketd/workspace"
export POCKETD_PORT="3030"
export POCKETD_HOST="127.0.0.1"        # 0.0.0.0 forces access-token auth
export POCKETD_APPROVAL_MODE="edits"   # auto | edits | strict
export POCKETD_SHELL=""                # optional, overrides the shell used for commands
```

Legacy `ZCODE_*` names are still read, so existing setups keep working.

### Approval modes

| Mode | Behaviour |
|------|-----------|
| `auto` | Never asks. The hard-deny list still applies (`rm -rf /`, `mkfs`, `dd of=/dev/sd*`, fork bombs and similar are always blocked and cannot be approved) |
| `edits` (default) | File modifications go through; running commands, deleting files and MCP tools require approval |
| `strict` | Everything except read-only tools (read file / list / search / Git inspection) requires approval |

Switch modes in Settings, or send `/approve auto|edits|strict` in chat. When approving, ticking "remember this choice" adds the command's first word or the directory to an allow-list, revocable from Settings in one click.

### Settings panel

Open the ⚙️ **Settings** button in the top right: enter your API key → **Test connection**. Below that you can switch the approval mode, inspect the loaded tool inventory, copy the access token, and add or remove MCP servers (**HTTP remote** or **stdio local**).

| Provider | Base URL | Suggested model |
|----------|----------|-----------------|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Groq (free tier) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1` | `qwen2.5-coder` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |

### MCP servers

```jsonc
// HTTP remote
{ "name": "github", "type": "http", "url": "https://example.com/mcp" }

// stdio local (cwd is the workspace)
{ "name": "my-tool", "type": "stdio", "command": "node", "args": ["/path/to/server.js"] }
```

Configuration lives in `~/.pocketd/state/mcp.json` and reconnects on startup. The model sees tools as `mcp__<server>__<tool>` (normalised to provider function-name rules).

---

## HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | SPA entry point |
| `/assets/*` | GET | Static JS/CSS |
| `/api/status` | GET | Server status: workspace, model, loaded tools, MCP connections |
| `/api/auth/token` | GET | Read the access token (**loopback only**) |
| `/api/config` | GET / POST | View / save API configuration |
| `/api/config/test` | POST | Server-side upstream connectivity test (avoids browser CORS) |
| `/api/files` | GET | `?path=.` list a directory |
| `/api/file` | GET / POST / PUT / DELETE | Read / write / create / delete a file |
| `/api/trash` | GET | List trash entries (with original path and deletion time) |
| `/api/file/raw` | GET | Raw bytes (image/binary preview, download) |
| `/preview/*` | GET | **Serve the workspace as a static site**: files served directly, directories get an index page; same path sandbox, escapes rejected |
| `/api/trash/restore` | POST | Restore a file to its original path |
| `/api/search` | GET | Structured search (`?q=`, `?regex=1`, `?case=1`, `?ext=`) |
| `/api/replace` | POST | Cross-file replace (`dryRun` recommended, preview before committing) |
| `/api/agent/sessions` | GET | Session list |
| `/api/agent/sessions/:id` | GET / PUT / DELETE | Read / overwrite / delete a session |
| `/api/agent/tools` | GET | Currently available tools (built-in + MCP) |
| `/api/agent/policy` | GET / POST | Read / switch the approval policy |
| `/api/agent/policy/always-allow` | DELETE | Revoke a remembered approval |
| `/api/agent/approval` | POST | Answer a pending tool-call approval |
| `/api/git/*` | — | init / status / add / commit / log / diff / branches / checkout / branch / merge / push / pull / fetch / remotes |
| `/api/mcp/servers` | GET / POST / DELETE | MCP server management (POST supports http and stdio) |
| `/api/mcp/servers/:name/toggle` | POST | Enable/disable an MCP server |
| `/api/mcp/reload` | POST | Re-initialise MCP connections |
| `/api/knowledge/generate` | GET | Generate the knowledge document |
| `/api/chat/stream` | POST | Start an agent run (response carries `x-pocketd-run-id`), SSE events below |
| `/api/agent/runs` | GET | Recent runs (to discover tasks still in flight) |
| `/api/agent/runs/:id` | GET | Run status plus event replay (`?from=N`) |
| `/api/agent/runs/:id/stream` | GET | **Reconnect**: replays events after `?from=N`, then goes live |
| `/api/agent/runs/:id/cancel` | POST | Cancel a run (the **run**, not the connection) |

### SSE event contract

| Event | Meaning |
|---|---|
| `run-start` | Run begins, carries the available tool inventory |
| `step` | One upstream round trip |
| `message` / `thinking` | Text delta / reasoning delta |
| `tool-call` / `tool-result` | A tool call and its result (including `isError`) |
| `approval-request` | Approval needed; client answers via POST `/api/agent/approval` |
| `run-status` | Run snapshot (including pending approvals); always the last event of a replay |
| `truncated` | The requested start point was evicted from the ring buffer; the client must rebuild its messages |
| `usage` | Real token usage |
| `run-finish` | Run completes |
| `error` / `warning` / `aborted` | Error / warning (e.g. "N history entries omitted") / cancelled |
| `data: [DONE]` | Stream terminator |
| `: ping` | Heartbeat comment every 20 seconds while waiting for approval |
| `/ws/terminal` | WebSocket | PTY terminal (requires node-pty; token required for non-loopback) |

---

## Repository layout

```
pocketd/
├── server.ts                 # Edge layer: Hono routes, token gate, terminal WS, SPA
├── src/agent/                # Agent core
│   ├── runtime.ts            #   Workspace sandbox, path resolution, trash, secrets, walking
│   ├── tools.ts              #   Built-in tool set + shell execution
│   ├── permissions.ts        #   Approval policy, hard-deny rules, approval broker
│   ├── loop.ts               #   Multi-step agent loop (Vercel AI SDK)
│   ├── mcp.ts                #   MCP client management (official SDK, HTTP + stdio)
│   ├── sessions.ts           #   Session persistence (node:sqlite)
│   ├── search.ts             #   Search and replace (Node standard library)
│   ├── ignore.ts             #   gitignore-semantics ignore rules
│   ├── shell.ts              #   POSIX-shell-first resolution (ADR-003)
│   └── git.ts                #   Git invocation
├── tests/
│   ├── agent.test.ts         # Tool layer / permissions / loop regression tests
│   ├── brand-assets.test.ts  # Pixel-level icon and manifest assertions
│   ├── e2e-server.mts        # Real server + stdio MCP end to end
│   └── fixtures/             # Fake LLM upstream, MCP test server
├── tools/
│   ├── make-icons.mjs        # Generate PNG brand icons (zero dependencies)
│   └── png-read.mjs          # Decoder used to read pixels back for assertions
├── ui/                       # Frontend (Vite + React + TS)
│   ├── src/
│   │   ├── App.tsx / main.tsx / store.ts
│   │   ├── monaco-themes.ts  # Monaco themes aligned with the CSS tokens
│   │   ├── lib/              # API client, dialog API, brand, viewport hooks
│   │   └── components/       # Chat, editor, file tree, terminal, Git, search, stats
│   ├── public/               # Icons (SVG + generated PNG) and manifest
│   └── dist/                 # Build output (gitignored)
├── docs/
│   ├── ARCHITECTURE.md       # Technical deep dive (includes the design system)
│   ├── adr/                  # Architecture decision records
│   └── MOBILE.md             # Mobile and accessibility notes
├── termux-setup.sh           # One-click install / start for Termux
├── TERMUX-QUICKSTART.md
├── CONTRIBUTING.md
└── LICENSE
```

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    Android Device / macOS / Linux              │
│                                                                │
│  ┌──────────────┐        ┌──────────────────────────────────┐  │
│  │ Browser (PWA)│        │ Termux / Localhost               │  │
│  │  Monaco      │        │  ┌────────────────────────────┐  │  │
│  │  xterm       │◀──────▶│  │ server.ts  edge layer      │  │  │
│  │  tools/approve│  SSE  │  │  Hono · token gate · ws    │  │  │
│  └──────────────┘   +WS  │  └────────────┬───────────────┘  │  │
│                          │               │                  │  │
│                          │  ┌────────────▼───────────────┐  │  │
│                          │  │ Agent core (src/agent)     │  │  │
│                          │  │  loop ─ tools ─ permissions│  │  │
│                          │  │  mcp · sessions · search   │  │  │
│                          │  └────────────┬───────────────┘  │  │
│                          │               │                  │  │
│                          │   filesystem / shell / git / MCP  │  │
│                          │              + node-pty          │  │
│                          └──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

The SPA is served from `ui/dist/`. Chat travels over SSE (text deltas, tool calls, approval requests, usage), the terminal over WebSocket. The agent loop runs server-side and its tools act directly on the workspace. All data stays local in `~/.pocketd/`.

> Technical detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); key trade-offs in [docs/adr/](docs/adr/)

---

## Development

```bash
# Server — start (requires ui/dist to exist)
npm install
cd ui && npm install && npm run build && cd ..
npm start

# Frontend — standalone development with HMR
cd ui && npm install && npm run dev

# Type checking (server + frontend)
npm run typecheck

# Tests: server tool layer and agent loop
npm test

# Tests: frontend components (Vitest + Testing Library)
npm run test:ui

# Tests: end to end (real server + real stdio MCP + approval round trip)
npm run test:e2e

# Production build
npm run build

# Regenerate brand icons (needed after changing the mark geometry in Brand.tsx)
npm run icons
```

The server decides based on whether `ui/dist/index.html` exists: present → serve the SPA; absent → return 503 telling you to build the frontend first.

You do not need a real API key to run it: `npm run test:e2e` includes a fake OpenAI-compatible upstream. To smoke-test by hand, start `node tests/fixtures/fake-upstream.mjs 3198` and point `POCKETD_API_BASE=http://127.0.0.1:3198/v1` at it.

### Design system

Colours, type sizes, radii and layers all live as tokens in `ui/src/index.css`; components never hard-code colour or size values. Foreground/background contrast is computed against WCAG 2.1 and the measured values sit next to the tokens. Both themes are complete (Monaco, xterm, syntax highlighting and native control colour-scheme included), and switching them also updates the browser UI's `theme-color`.

Before changing visuals, read the [design-system section of docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#design-system). Changing the brand mark requires updating both `ui/src/components/Brand.tsx` and `ui/public/pocketd-icon.svg` (`npm test` asserts the two share one geometry), then running `npm run icons` to regenerate the PNGs.

---

## Security

| Item | Status |
|------|--------|
| **Binding and auth** | Loopback-only by default; setting `POCKETD_HOST=0.0.0.0` forces an access token (256-bit random, stored in a `0600` file) for non-loopback requests. The terminal WebSocket is checked the same way |
| **Agent command execution** | Routed exclusively through the `bash` tool under the approval policy; the hard-deny list (`rm -rf /`, `mkfs`, block-device writes, fork bombs, …) cannot be approved |
| **File deletion** | Moves to `trash/` with sidecar metadata and is **restorable to the original path**; refusing to target the workspace root |
| **Path sandbox** | Out-of-bounds resolutions rejected, plus `realpath` on the deepest existing ancestor so symlinks cannot lead reads or writes outside the workspace |
| **Markdown XSS** | `react-markdown` + `rehype-sanitize` (custom schema), shared by chat and the knowledge base |
| **Request body limits** | `/api/chat/stream` 10MB, `/api/file` 5MB |
| **Tool output** | Uniformly truncated (30k characters) so one command cannot flood the context window |

Known gaps — fill these before considering public exposure (which is not recommended):

- No rate limiting and no failed-login lockout (the token itself cannot be brute-forced, but defence in depth is missing)
- The `bash` tool is not a sandbox — it is a shell. The approval policy is the only gate; under `auto` it is effectively open
- MCP stdio servers launch as your user; their own security is outside pocketd's control

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| White screen | Frontend not built: `cd ui && npm run build` |
| Terminal not working | `node-pty` missing: `pkg install clang make` (Termux) |
| Chat 502 / error | Check API Base / Key / Model in Settings |
| 503 status | `ui/dist/` missing — build the frontend first |
| 401 unauthorised | When accessing from another device, pass the token: `?token=<token>`; it is shown in Settings on the phone |
| Port conflict | `POCKETD_PORT=4000 npx tsx server.ts` |
| Tools always denied | You are in `strict` mode; switch to `edits` in Settings, or tick "remember this choice" while approving |

---

## Dependencies

**Server** (`package.json`):
- `hono` / `@hono/node-server` — HTTP framework and Node adapter
- `ws` — WebSocket server
- `ai` / `@ai-sdk/openai-compatible` — LLM orchestration and provider adapter
- `@modelcontextprotocol/sdk` — MCP client (HTTP + stdio)
- `zod` — tool argument schemas
- `simple-git` — Git invocation
- `ignore` — gitignore-semantics ignore rules (used by search and `@` candidates)
- `node-pty` *(optional)* — terminal PTY emulation, needs `clang + make`
- Session storage uses Node 24's built-in `node:sqlite`; search uses the Node standard library — neither adds a dependency

**Frontend** (`ui/package.json`):
- `react` / `react-dom` 19 — UI framework
- `zustand` 5 — state management
- `@monaco-editor/react` + `monaco-editor` — code editor
- `@xterm/xterm` 6 + `@xterm/addon-fit` + `@xterm/addon-web-links` — terminal
- `react-markdown` + `remark-gfm` + `rehype-sanitize` + `rehype-highlight` — Markdown and syntax highlighting
- `vite` 8 + `@vitejs/plugin-react` — build tooling
- `vitest` 5 + `@testing-library/*` + `jsdom` 30 — testing

Builds and type checking use **TypeScript 7** (the native implementation; `tsc` remains compatible with 5.x).

There is one `overrides` entry in `ui/package.json`: `dompurify: ^3.4.17`. `monaco-editor` pins dompurify at 3.4.15, which has a published XSS advisory; remove the override once monaco upgrades on its own.

No z.ai / BigModel / OAuth / telemetry dependencies of any kind.

### Frontend bundle cost

highlight.js languages are split into 87 **lazily loaded** chunks (about 468 KB uncompressed in total), downloaded only when a code block in that language appears. The main chunk is about 5.06 MB (1.33 MB gzipped); the bulk is the Monaco editor and its workers (`ts.worker` alone is 6.9 MB). Total build output is roughly 15 MB, cached by the Service Worker after the PWA is installed once.

---

## Related projects

- [Termux](https://termux.dev) — Android terminal emulator
- [Hono](https://hono.dev) — web framework
- [Vercel AI SDK](https://ai-sdk.dev) — LLM orchestration and tool loop

---

## License

[MIT](LICENSE) © pocketd Contributors

### A note on the rename

This project began life as **ZCode**, following the ideas of a desktop agent of the same name. That name collided with an official product, so it was renamed to **pocketd** before the first public release.

The rename is **lossless**. Legacy environment prefixes (`ZCODE_*`), the old data directory (`~/.zcode/`), the old localStorage keys, the old token cookie, the old trash directory and the legacy `.zcodeignore` are all still read on startup, so existing users lose nothing. There is exactly one thing that cannot be made seamless: the PWA `manifest.id` stays `/`, or an already-installed PWA would be treated as a different application and require reinstalling. That is the only real cost, and it is one-time.
