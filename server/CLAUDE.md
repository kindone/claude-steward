# Server — Agent Instructions

Node.js 23 + TypeScript (ESM) + Express 5. See `docs/server.md` for full route reference and `docs/worker-protocol.md` for the worker IPC design.

## Commands

```bash
npm run dev --workspace=server       # tsx watch (hot-reload)
npm run build --workspace=server     # tsc → dist/
npm test --workspace=server          # Vitest (isolated temp DB per test file)
cd server && npx tsc --noEmit        # type-check only
```

## Key Patterns

**Database** — `node:sqlite` (built-in, not `better-sqlite3`). All queries go through `server/src/db/index.ts`. Pattern: `db.prepare('...').get/all/run()`. Schema migrations run idempotently on startup — add columns with `IF NOT EXISTS`, never drop.

**Routes** — all under `server/src/routes/`. Auth middleware (`requireAuth`) is applied in `app.ts` after public auth routes. Add new routes in their own file and mount in `app.ts`.

**SSE** — set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Send keepalive pings every 30s for nginx. Use `res.on('close')` (not `req.on('close')`) for cleanup.

**Worker path vs direct spawn** — `chat.ts` prefers the worker (Unix socket); falls back to `spawnClaude()` in `process.ts` when worker is down. Tool calls are only persisted on the worker path.

**Env vars** — read inside functions, never at module top-level (ESM + dotenv ordering; see root `CLAUDE.md`).

## Testing

Each test file gets its own isolated SQLite DB via `server/src/__tests__/setup.ts` (temp file, cleaned up after). `spawnClaude` is mocked in `chat.test.ts` — no real CLI calls. Use `supertest` against `createApp()` (not the bound server).

## Critical Gotchas

See root `CLAUDE.md` → "Claude CLI Gotchas" for the full list. The most dangerous: strip `CLAUDE*` env vars before spawning, set `CI=true`, use `res.on('close')`.
