# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through either channel:

- GitHub Security Advisories — the "Report a vulnerability" button on the repository's Security tab (preferred)
- Email — see the repository profile for the maintainer address

Include what you can of: affected version or commit, a description of the issue, reproduction steps, and the impact you believe it has. A proof of concept helps enormously.

We aim to acknowledge within 72 hours and to provide an initial assessment within a week. Please give us a reasonable window to ship a fix before public disclosure.

## Threat model — read this before reporting

`pocketd` is a **local-first developer tool that runs a coding agent with real shell access**. It is designed to be bound to loopback on a device you control. Some properties that look like vulnerabilities are deliberate design decisions, and reports about them will be closed as working-as-intended:

| Not a vulnerability | Why |
|---|---|
| The agent can run arbitrary shell commands | That is the product. It is gated by the approval policy, and the hard-deny list cannot be approved through |
| `auto` mode runs commands without prompting | Documented behaviour of that mode. Use `edits` or `strict` if you want a gate |
| `bash` is not a sandbox | Documented. The shell is the execution primitive; the approval policy is the gate |
| MCP servers can point at any URL | MCP servers are addresses the user configures on purpose; blocking them would break the primary use case. Sources are labelled in the approval card instead |
| The workspace path is readable via `/api/config` | This is a local application; the path is visible to the local user anyway |

## Things we do want to hear about

- Any way to escape the workspace path sandbox, including symlink and Windows alternate-path tricks
- Any way to reach an API endpoint or the terminal WebSocket from a non-loopback address without the access token
- XSS in rendered Markdown, tool output, or file previews
- Credential leakage — into logs, into the npm tarball, into error messages, or anywhere else
- Authentication bypass, token prediction, or token leakage to an unintended origin

## Supported versions

Fixes land on `main` and are released as patch versions. Only the latest release line is supported.

## Known gaps

These are documented limitations rather than secrets, listed so you can judge your own exposure:

- No rate limiting and no failed-authentication lockout
- No base-URL allow-list on `/api/config/test`
- MCP stdio servers launch with your privileges; their own security is outside our control

Exposing this service to the public internet is **not** a supported configuration.
