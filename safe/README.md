# ⚠ Safe-Mode Core — DO NOT MODIFY

This directory contains the emergency terminal for Claude Steward.

## What it is

A minimal, dependency-free web terminal providing direct access to the `claude` CLI when the main app is unavailable. Plain Node.js (`server.js`) + vanilla JS HTML (`index.html`). No TypeScript, no React, no npm packages, no build step.

## How to run

```bash
node safe/server.js
```

Listens on `SAFE_PORT` (default `3003`). Uses `API_KEY` and `CLAUDE_PATH` from `.env`.

In production, this is managed as a separate PM2 process (`steward-safe`) that runs independently of the main app.

## Freeze policy

**This directory must not be modified after initial stabilization.**

- Do not edit `server.js` or `index.html`
- Do not add dependencies
- Do not include `safe/` in build or deploy scripts
- Claude sessions working on the steward project must treat this directory as read-only

The safe-mode core's value comes entirely from its independence from the rest of the codebase. If the main app is broken, this still works. That guarantee is only valid if `safe/` is never touched.

## Features

- Bearer token auth (same `API_KEY` as main app)
- Streaming SSE response from `claude` CLI
- **Full permissions** — runs with `--dangerously-skip-permissions`; no approval prompts for file writes or bash commands. This is intentional for an emergency recovery tool.
- Session continuity: `claudeSessionId` stored in browser JS state, sent with each message
- Stop button: `SIGTERM` on the claude subprocess
- Distinct red/orange UI with "⚠ SAFE MODE" banner
