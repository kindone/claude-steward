# Claude Steward — Agent Memory

Read this first. For details, see `docs/` — start with `docs/architecture.md`.

---

## Working Conventions

- **Do not commit autonomously.** Never run `git add + git commit` without the user explicitly asking. Build and lint checks after changes are fine; committing is not.
- **Update docs and `MEMORY.md` alongside code changes.** When a feature lands, update the relevant `docs/` file and this file in the same working set, before asking the user to commit.
- **Dedicated doc per significant idea.** Each new subsystem, feature area, or cross-cutting concept gets its own `docs/<name>.md` file when it grows beyond a single section. New doc files must link back to their parent doc (usually `docs/architecture.md` or the relevant program doc) and forward to any child docs.
- **ESM + dotenv ordering gotcha**: In ESM, `import` statements are fully evaluated before the importing module's body runs. `dotenv.config()` is called in `index.ts`'s body, so any module that reads `process.env.*` at its top level will see undefined values. Always read env vars **inside functions** (lazy), never at module initialisation time. Also: PM2's plain `pm2 restart` does not apply new ecosystem config env vars — use `pm2 restart ecosystem.dev.config.cjs --only <name> --update-env`.
- **Run `tsc` after every client change.** `ReadLints` uses the language server and misses some TypeScript errors that only surface at compile time. Always run `npm run build --workspace=client` (or `cd client && npx tsc --noEmit`) after making client-side TypeScript changes to catch type errors before the user sees them.

## Documentation Rules

- **Keep docs current.** When code changes, update the relevant doc in the same working set. Stale docs are worse than no docs.
- **Parent doc owns the interface; child doc owns the internals.** If a subsystem grows large enough for its own file, the parent doc keeps a section describing what it is, how other parts connect to it, and what it exposes. The child doc covers how it works inside. An agent reading only the parent should understand the system well enough to reason about it.
- **One doc per program or major subsystem.** `docs/server.md`, `docs/client.md`, `docs/safe.md` each cover one deployable unit. New features that have their own lifecycle, config, or deployment concern (scheduler, mini-app platform, MCP) get their own doc when they outgrow a section.
- **`docs/architecture.md` is the map, not the territory.** It covers only: repo layout, port map, cross-program interfaces, auth boundary, shared config, and the DB schema. No internal implementation details belong there.
- **`MEMORY.md` is for agents, not humans.** Keep it short. Only include things an LLM needs that aren't obvious from the code or docs: vision, current state, key *why* decisions, hard constraints, and dangerous gotchas. Do not duplicate content already in `docs/`.
For user-facing introduction, see `README.md`

---

## What This Is

A self-hosted, always-on Claude Code environment accessible from desktop and mobile. The key idea: you run it on a server you control, it wraps the `claude` CLI, and you chat with it from any browser. It is **not** a Claude.ai clone — it's a platform for running Claude Code sessions remotely against real project directories.

Core properties (brief):
- **Project-centric** — each project maps to a real server directory; sessions run `claude` with that directory as `cwd`
- **Remote-first** — VPS/home server, accessed over the web
- **Self-managing** — the steward app is one of its own projects; Claude can edit, build, and hot-reload it via chat
- **Safe-mode core** (`safe/`) — frozen emergency terminal, survives main app crashes, never touched by the upgrade cycle
- **Scheduled reminders** *(planned)* — `node-cron` + push notifications to resume conversations
- **Mini-app platform** *(planned)* — projects can be embeddable web apps with a `steward-app.json` manifest

---

## Current Implementation State

Built and working:
- Project CRUD + file browser (server routes + client UI)
- Session management scoped to projects
- Chat streaming via Claude CLI subprocess → SSE → React client
- Session reordering, inline rename, delete, keyboard shortcuts
- Copy button on assistant messages
- Structured error handling for failed `--resume` (clears `claude_session_id`, shows amber/red banner)
- App-level SSE for live reload (`/api/events`)
- Self-upgrade via `POST /api/admin/reload` → `process.exit(0)` → PM2 restart
- Safe-mode core on `:3003` (frozen)
- Vitest integration tests (server + client), Playwright E2E smoke tests
- `npm run status` — checks all three ports
- PM2 daemon mode for both dev (`up:dev`) and prod (`up`); `npm run down/logs/restart`
- Tailwind CSS v4 — fully mobile-responsive; sidebar drawer on mobile; touch targets fixed
- nginx reverse proxy on EC2; HTTPS via Let's Encrypt for `steward.jradoo.com` and `safe.steward.jradoo.com`; currently proxying production (`:3001`)
- Passkeys (WebAuthn) auth — `AuthPage` gates the UI; session cookie issued on successful assertion; API key still accepted as fallback during rollout

See `TODO.md` for what's next. See `archived_tasks.md` for completed work.

---

## Key Decisions & Why

**`node:sqlite` not `better-sqlite3`** — `better-sqlite3` fails to compile on Node 23 due to a V8 ABI mismatch. `node:sqlite` is built-in and works. Downside: it's marked experimental; the API is `db.prepare().get/all/run()`.

**`fetch()` + manual SSE parser, not `EventSource`** — `EventSource` doesn't support custom headers. Every request needs `Authorization: Bearer`, so the client uses a `ReadableStream` parser.

**`--resume <claude_session_id>` for continuity** — The session has two IDs: a server UUID (`id`) and a CLI handle (`claude_session_id`). The CLI handle comes from the first `system.init` chunk and is stored in the DB. Failed resumes clear it automatically so the next message starts fresh.

**`safe/` has zero dependencies** — its value is survival when the main app is broken. Introducing any `npm install` dependency would make it part of the build cycle and break that guarantee.

**Capacitor (not Tauri) for mobile packaging** — Capacitor supports remote URL mode so there are no bundled assets; the app always loads from the server URL. This means updates to the server are immediately reflected on mobile without an app store release.

---

## Hard Constraints

**`safe/` is frozen.** `safe/server.js`, `safe/index.html`, and `safe/package.json` must not be modified once stabilized. Claude sessions working on the steward project must treat `safe/` as read-only.

---

## Claude CLI Gotchas

These have caused significant bugs — do not skip:

1. **`CLAUDECODE=1` causes hanging** — when spawned from inside a Claude Code session, the child inherits this var and waits for IPC that never comes. Strip all `CLAUDE*` vars from the spawn env (except `ANTHROPIC_BASE_URL`). See `server/src/claude/process.ts`.
2. **`CI=true` is required** — `--output-format stream-json --verbose` produces no output when stdout is a pipe without it (TTY detection).
3. **Close stdin** — use `stdio: ['ignore', 'pipe', 'pipe']`; otherwise Claude may block on stdin.
4. **Use `res.on('close')` not `req.on('close')`** — Express fires `req.on('close')` when the request body is consumed, not on client disconnect. SSE cleanup must use `res.on('close')`.
5. **Don't process both `content_block_delta` and `assistant` chunks** — with `--include-partial-messages`, the final `assistant` chunk duplicates the full accumulated text. Only handle `content_block_delta`.
