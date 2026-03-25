# Claude Steward — Agent Instructions

A self-hosted, always-on Claude Code platform. The server wraps the `claude` CLI as a subprocess and streams output to the browser via SSE. The app is **one of its own projects** — Claude can edit, build, and hot-reload it from chat.

For full details start with `docs/architecture.md`, then the relevant program doc.

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
npm test                             # server Vitest + client Vitest (~4s, no servers needed)
npm run test:e2e                     # Playwright smoke tests (auto-starts dev servers)
npm run test:all                     # everything
npm test --workspace=server          # server only
npm test --workspace=client          # client only

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
- **Do not commit autonomously.** Never run `git add + git commit` without explicit user request.
- **Update docs alongside code.** When a feature lands, update the relevant `docs/` file and `MEMORY.md` in the same working set before asking the user to commit.

---

## Working Conventions

- **ESM + dotenv ordering**: `dotenv.config()` runs in `index.ts`'s body, *after* all imports evaluate. Read `process.env.*` inside functions (lazy), never at module top-level — or you'll get `undefined`.
- **PM2 env caching**: `pm2 restart` keeps the old env snapshot. To apply new env vars: `pm2 restart ecosystem.dev.config.cjs --only steward-server --update-env`.
- **Run `tsc` after client changes.** The language server misses some errors that only surface at compile time. Always run `npm run build --workspace=client` (or `cd client && npx tsc --noEmit`) after TypeScript changes in `client/`.
- **Dev vs prod routing**: nginx routes `dev.steward.jradoo.com → :5173` (Vite, HMR over WSS). nginx routes `steward.jradoo.com → :3001` (prod, built static files). Do not set `build.watch` non-null in `vite.config.ts` unconditionally — that activates watch mode for all builds including production.

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
| `/tmp/claude-worker.sock` | steward-worker | both |

---

## Key Decisions (brief)

- **`node:sqlite` not `better-sqlite3`** — `better-sqlite3` fails on Node 23 (V8 ABI mismatch); `node:sqlite` is built-in.
- **`fetch()` + manual SSE parser, not `EventSource`** — `EventSource` doesn't support custom headers; auth requires `Authorization: Bearer`.
- **Two-ID session design** — `sessions.id` (stable client UUID) vs `sessions.claude_session_id` (CLI handle, set after first message, cleared on failed resume).
- **Worker process** — separate PM2 process on Unix socket so in-flight Claude jobs survive HTTP server restarts. See `docs/worker-protocol.md`.
- **`safe/` zero dependencies** — survival guarantee requires no npm install step.

---

## Current Open Issues

See `TODO.md` for planned work, `BUGS.md` for known defects.
Notable active gaps: server-restart error bubble (scenario 2), worker-restart 90s hang (scenario 3), per-session model selection, rich chat rendering (Mermaid/images/HTML).
