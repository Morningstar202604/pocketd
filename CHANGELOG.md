# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-15

First public release.

### The agent

- Multi-step agent loop built on the Vercel AI SDK, up to 40 steps, with tool-call visualisation and real token accounting
- 11 built-in tools: `read_file`, `write_file`, `edit_file`, `replace_in_files`, `list_dir`, `glob`, `grep`, `bash`, `delete_path`, `git_status`, `git_diff`
- Three approval modes (`auto`, `edits`, `strict`) with a hard-deny list (`rm -rf /`, `mkfs`, block-device writes, fork bombs) that cannot be approved through
- "Remember this choice" to allow-list a command or directory, revocable in one click
- MCP client on the official SDK with **both HTTP and stdio** transports, tools discovered and registered automatically

### Runs outlive the browser tab

- Runs are owned by the server, not the HTTP connection. Closing the page or locking the screen does not interrupt work
- Reopening the page reattaches automatically and replays the event history
- Approval window of 15 minutes; a stale card is marked explicitly
- Cancellation targets the run, not the connection

### The workspace

- Monaco editor with multiple tabs, syntax highlighting and `Ctrl+S`
- File tree with fuzzy filter, create, drag-and-drop upload, and deletion to a **restorable** trash
- Preview: images render directly, Markdown renders, HTML runs in a sandboxed iframe, and the whole workspace can be browsed as a static site at `/preview/`
- Search and replace with structured `path:line:col` results, preview-before-commit, and consistent regex/literal semantics
- Git panel: branch graph, diff/log/add/commit, merge, push/pull/fetch, checkout/branch/remote
- Terminal over xterm.js and node-pty
- `@` file candidates and search honour gitignore semantics via `.gitignore` (read live), `.pocketdignore` and the legacy `.zcodeignore`; ignored entries stay visible and openable

### Security

- Loopback-only by default; `POCKETD_HOST=0.0.0.0` forces a 256-bit access token for non-loopback requests, including the terminal WebSocket
- Path sandbox rejects out-of-bounds resolutions and `realpath`s the deepest existing ancestor, so symlinks cannot escape
- Markdown sanitised through `rehype-sanitize`; chat and the knowledge base share one renderer
- Request body limits on the chat and file endpoints; uniform tool-output truncation

### Interface

- Dark and light themes, every contrast pair measured against WCAG 2.1 AA
- Mobile-first layout: chat is the landing view, five-tab bottom navigation, 44px touch targets, safe-area insets
- Server-owned sessions with one-tap restore, plus slash commands, attachments and vision input
- Installable PWA with a hash-aware Service Worker

### Compatibility

- Any OpenAI-compatible provider: OpenAI, DeepSeek, Moonshot, Groq, Ollama and others
- Node ≥ 24 (session storage uses the built-in `node:sqlite`)
- No cloud account, no OAuth, no telemetry

### Notes on the rename

This project was originally named **ZCode**. It was renamed to **pocketd** before the first public release because the old name collided with an official product. The rename is lossless: legacy `ZCODE_*` environment prefixes, the `~/.zcode/` data directory, old localStorage keys, the old token cookie, the old trash directory and `.zcodeignore` are all still read. The single exception is the PWA `manifest.id`, which must remain `/` or installed apps would be treated as a different application.

[1.0.0]: https://github.com/badhope/pocketd/releases/tag/v1.0.0
