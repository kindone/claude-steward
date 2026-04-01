# Claude Steward — Agent Instructions

A self-hosted, always-on Claude Code platform. The server wraps the `claude` CLI as a subprocess and streams output to the browser via SSE. The app is **one of its own projects** — Claude can edit, build, and hot-reload it from chat.

For full details start with `docs/architecture.md`, then the relevant program doc.

---

## Mental Model

**Testing and testability is our highest value.** Every design, implementation, and deployment decision must be made with tests in mind.

- **Design for testability first** — prefer pure functions over side effects, injectable dependencies over hard-coded ones, clear module boundaries over tangled internals. If something is hard to test, that's a design signal, not a test problem.
- **No feature is done without tests** — new code ships with coverage. A working implementation without a test is a draft, not a deliverable.
- **Property-based testing (jsproptest) over example-based where possible** — jsproptest is not just for pure functions; it has a stateful testing framework too. Use it to model state machines (session lifecycle, worker job states, auth flows) and generate random command sequences to find invariant violations. Example-based tests (Vitest) for routes, components, and cases where specific scenarios matter more than exploration. See `/writing_test` for the full property-writing playbook.
- **Tests pass before reload** — `npm test` must exit 0 before `POST /api/admin/reload`. A broken test suite means the build doesn't ship.
- **Read before editing** — understand existing code before changing it. Don't propose modifications to files you haven't read.
- **Minimal scope** — change only what the task requires. Don't refactor bystander code, add unsolicited features, or over-engineer. Three similar lines are better than a premature abstraction.
- **Verify your work** — after every change: build (`npm run build`), type-check (`tsc --noEmit`), test (`npm test`). Don't hand back unverified work.

---

## Commands

```bash
# Development
npm run dev                          # server :3002 (tsx watch) + client :5173 (Vite HMR)
npm run up:dev                       # PM2 daemon mode (dev) — survives SSH disconnect
npm run up                           # PM2 daemon mode (production)
npm run down / restart / logs / status

# Build
npm run build                        # client (tsc + vite build) → server/public/; server (tsc) → dist/
npm run build --workspace=client     # client only
npm run build --workspace=server     # server only

# Type-check without building
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit

# Test
npm test                             # fast: server unit/prop/contract + client component (~10s, no servers, no Claude)
npm run test:e2e                     # slow: worker e2e (real Claude CLI) + Playwright smoke tests
npm run test:all                     # everything: npm test + npm run test:e2e
npm test --workspace=server          # server fast tests only
npm test --workspace=client          # client tests only
npm run test:e2e --workspace=server  # worker e2e only (real Claude CLI, ~90s per test)

# Operations
npm run status                       # health-check all ports
npm run logs:dev / logs:prod / logs:safe
```

---

## Self-Upgrade Flow

Claude edits source → `npm run build` → `POST /api/admin/reload` → server broadcasts `reload` SSE → `process.exit(0)` → PM2 restarts → clients auto-refresh.

When deploying changes: **build must succeed before reload**. Always verify `npm run build` exits 0 first.

---

## Hard Constraints

- **`safe/` is frozen.** Never modify `safe/server.js`, `safe/index.html`, or `safe/package.json`. It's the emergency fallback that survives main app crashes; any npm dependency or code change breaks that guarantee.
- **Do not commit autonomously.** Never run `git add + git commit` without the user explicitly asking to commit in that specific message. Approval to do work is not approval to commit. A prior commit request does not carry forward — each commit requires its own explicit request.
- **Update docs alongside code.** When a feature lands, update the relevant `docs/` file and `MEMORY.md` in the same working set before asking the user to commit.

---

## Working Conventions

- **ESM + dotenv ordering**: `dotenv.config()` runs in `index.ts`'s body, *after* all imports evaluate. Read `process.env.*` inside functions (lazy), never at module top-level — or you'll get `undefined`.
- **PM2 env caching**: `pm2 restart` keeps the old env snapshot. To apply new env vars: `pm2 restart ecosystem.dev.config.cjs --only steward-server --update-env`.
- **Run `tsc` after client changes.** The language server misses some errors that only surface at compile time. Always run `npm run build --workspace=client` (or `cd client && npx tsc --noEmit`) after TypeScript changes in `client/`.
- **Dev vs prod routing**: nginx routes `dev.steward.jradoo.com → :5173` (Vite, HMR over WSS). nginx routes `steward.jradoo.com → :3001` (prod, built static files). Do not set `build.watch` non-null in `vite.config.ts` unconditionally — that activates watch mode for all builds including production.
- **Scheduling: use `<schedule>` blocks, not CronCreate.** This project has a custom scheduler (see `docs/scheduler.md`). When the user asks to schedule something, emit a `<schedule>` JSON block in your response — the server will intercept it, store it in the DB, and manage it. `CronCreate` is ephemeral and session-only; it's only for quick testing, never for user-facing features. The `<schedule>` block system persists across server restarts, supports `update: true` semantics, and is visible in the UI.
- **Get current time via Bash, not system prompt.** The system prompt contains current time at session start, but it becomes stale as the conversation progresses. When scheduling, run `date "+%H:%M:%S %Z" && date -u "+%H:%M:%S UTC"` via Bash to get the accurate current time, then calculate the cron expression relative to that.

---

## Claude CLI Gotchas

These have caused significant bugs — do not skip:

1. **`CLAUDECODE=1` causes hanging** — child inherits this var from a parent Claude session and waits for IPC that never comes. Strip all env vars starting with `CLAUDE` from the spawn env (except `ANTHROPIC_BASE_URL`). See `server/src/claude/process.ts`.
2. **`CI=true` is required** — `--output-format stream-json` produces no output when stdout is a pipe (TTY detection). Always set `CI=true` in the spawn env.
3. **Close stdin** — use `stdio: ['ignore', 'pipe', 'pipe']`; otherwise Claude may block on stdin.
4. **`res.on('close')` not `req.on('close')`** — Express fires `req.on('close')` when the request body is consumed, not on client disconnect. SSE cleanup must use `res.on('close')`.
5. **No `assistant` chunk fallback** — with `--include-partial-messages`, the final `assistant` chunk duplicates the full accumulated text. Only handle `content_block_delta`; ignore the `assistant` chunk type.

---

## Port Map

| Port | Process | When |
|---|---|---|
| 3001 | steward-main (prod) | production |
| 3002 | steward-server (dev) | dev |
| 5173 | steward-client (Vite) | dev |
| 3003 | steward-safe | always |
| 4001–4010 | steward-apps (mini-apps) | both; slot N → port 400N → `app{N}.steward.jradoo.com` |
| `/tmp/claude-worker.sock` | steward-worker | both |
| `/tmp/claude-apps.sock` | steward-apps sidecar | both |

---

## Key Decisions (brief)

- **`node:sqlite` not `better-sqlite3`** — `better-sqlite3` fails on Node 23 (V8 ABI mismatch); `node:sqlite` is built-in.
- **`fetch()` + manual SSE parser, not `EventSource`** — `EventSource` doesn't support custom headers; auth requires `Authorization: Bearer`.
- **Two-ID session design** — `sessions.id` (stable client UUID) vs `sessions.claude_session_id` (CLI handle, set after first message, cleared on failed resume).
- **Worker process** — separate PM2 process on Unix socket so in-flight Claude jobs survive HTTP server restarts. See `docs/worker-protocol.md`.
- **`safe/` zero dependencies** — survival guarantee requires no npm install step.

---

## Current Open Issues

See `TODO.md` for planned work, `BUGS.md` for known defects. Move completed works and fixed defects into `archived_tasks.md`.