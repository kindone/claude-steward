# Steward — Agent Instructions

A self-hosted, always-on AI-coding platform. The server wraps an AI-coding
CLI as a subprocess and streams output to the browser via SSE. The app is
**one of its own projects** — the agent driving the chat can edit, build,
and hot-reload it from inside a session.

This branch supports multiple CLI backends behind the `CliAdapter`
abstraction (`server/src/cli/`). The active CLI is picked per-deployment via
`STEWARD_CLI` (default `claude`). Currently supported:

- `claude` — Anthropic Claude CLI (Node-based, token-streaming)
- `opencode` — opencode (Go binary, whole-message text, multi-provider)

This file holds the universal conventions every agent working on this
codebase should follow, regardless of which CLI you're running as. Per-CLI
specifics (spawn gotchas, env policy, model formats) live in:

- `CLAUDE.md` — Claude CLI specifics. Auto-loaded by Claude Code.
- `docs/agents/opencode.md` — opencode CLI specifics. Auto-loaded? Depends
  on your client; opencode itself reads `AGENTS.md` (this file) by
  convention, but the deeper opencode notes are kept separate so the
  universal file stays vendor-neutral.

For deeper architectural docs, start with `docs/architecture.md`, then the
relevant program doc.

---

## Mental Model

**Testing and testability is our highest value.** Every design,
implementation, and deployment decision must be made with tests in mind.

- **Design for testability first** — prefer pure functions over side effects,
  injectable dependencies over hard-coded ones, clear module boundaries over
  tangled internals. If something is hard to test, that's a design signal,
  not a test problem.
- **No feature is done without tests** — new code ships with coverage. A
  working implementation without a test is a draft, not a deliverable.
- **Property-based testing (jsproptest) over example-based where possible** —
  jsproptest is not just for pure functions; it has a stateful testing
  framework too. Use it to model state machines (session lifecycle, worker
  job states, auth flows) and generate random command sequences to find
  invariant violations. Example-based tests (Vitest) for routes, components,
  and cases where specific scenarios matter more than exploration. See
  `/writing_test` for the full property-writing playbook.
- **Tests pass before reload** — `npm test` must exit 0 before
  `POST /api/admin/reload`. A broken test suite means the build doesn't ship.
- **Read before editing** — understand existing code before changing it.
  Don't propose modifications to files you haven't read.
- **Minimal scope** — change only what the task requires. Don't refactor
  bystander code, add unsolicited features, or over-engineer. Three similar
  lines are better than a premature abstraction.
- **Verify your work** — after every change: build (`npm run build`),
  type-check (`tsc --noEmit`), test (`npm test`). Don't hand back unverified
  work.
- **Adapter parity over ad-hoc branching** — when two CLI backends differ,
  surface the difference through `CliAdapter` (capabilities, parser, args)
  rather than `if (cli === 'claude') …` scattered through the worker /
  routes. Adapter changes carry their own test fixture under
  `server/src/__tests__/cli/`.

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
npm test                             # fast: server unit/prop/contract + client component (~10s, no servers, no CLI spawn)
npm run test:e2e                     # slow: worker e2e (real CLI spawn) + Playwright smoke tests
npm run test:all                     # everything: npm test + npm run test:e2e
npm test --workspace=server          # server fast tests only
npm test --workspace=client          # client tests only
npm run test:e2e --workspace=server  # worker e2e only (real CLI spawn, ~90s per test)

# Operations
npm run status                       # health-check all ports
npm run logs:dev / logs:prod / logs:safe

# Containers
docker compose up                                                  # minimal mode
docker compose -f docker-compose.yml -f docker-compose.evolve.yml up   # evolve (full source baked in)
docker compose -f docker-compose.yml -f docker-compose.shared.yml up   # shared (host bind-mount)
```

---

## Self-Upgrade Flow

Agent edits source → `npm run build` → `POST /api/admin/reload` → server
broadcasts `reload` SSE → `process.exit(0)` → PM2 restarts → clients
auto-refresh.

When deploying changes: **build must succeed before reload**. Always verify
`npm run build` exits 0 first.

In containers: the `evolve` mode carries full source + dev deps + git, so
the same loop runs in-container. The `minimal` mode only carries built
artefacts and cannot self-upgrade — use `evolve` or `shared` for that.

---

## Hard Constraints

- **`safe/` is frozen.** Never modify `safe/server.js`, `safe/index.html`, or
  `safe/package.json`. It's the emergency fallback that survives main app
  crashes; any npm dependency or code change breaks that guarantee.
- **Do not commit autonomously.** Never run `git add + git commit` without
  the user explicitly asking to commit in that specific message. Approval
  to do work is not approval to commit. A prior commit request does not
  carry forward — each commit requires its own explicit request.
- **Update docs alongside code.** When a feature lands, update the relevant
  `docs/` file and `MEMORY.md` in the same working set before asking the
  user to commit. Adapter changes additionally update
  `docs/agents/<cli>.md`.

---

## Working Conventions

- **ESM + dotenv ordering**: `dotenv.config()` runs in `index.ts`'s body,
  *after* all imports evaluate. Read `process.env.*` inside functions
  (lazy), never at module top-level — or you'll get `undefined`.
- **PM2 env caching**: `pm2 restart` keeps the old env snapshot. To apply
  new env vars: `pm2 restart ecosystem.dev.config.cjs --only steward-server
  --update-env`. Ecosystem configs respect inherited `DATABASE_PATH` so
  containerized deployments can override via compose `environment:`.
- **Run `tsc` after client changes.** The language server misses some errors
  that only surface at compile time. Always run `npm run build
  --workspace=client` (or `cd client && npx tsc --noEmit`) after TypeScript
  changes in `client/`.
- **Dev vs prod routing**: nginx routes `dev.steward.yourdomain.com → :5173`
  (Vite, HMR over WSS). nginx routes `steward.yourdomain.com → :3001`
  (prod, built static files). Do not set `build.watch` non-null in
  `vite.config.ts` unconditionally — that activates watch mode for all
  builds including production.
- **Scheduling: use the `steward-schedules` MCP tools.** `schedule_list`,
  `schedule_create`, `schedule_update`, `schedule_delete` are exposed via
  MCP. The steward server auto-syncs the registration to *both* CLIs'
  config files on every startup (Claude reads `~/.claude.json`; opencode
  reads `~/.config/opencode/opencode.json`) — see `syncClaudeSettings` and
  `syncOpencodeSettings` in `server/src/mcp/config.ts`. The `session_id`
  is injected into every system prompt — no DB query needed. Never emit
  `<schedule>` text blocks (old mechanism, no longer processed) and never
  call `CronCreate` / `CronDelete` (session-only harness tools, not
  persisted). See `docs/scheduler.md` for architecture;
  `docs/scheduler-usage.md` for tool usage.
- **Get current time via Bash, not the system prompt.** The system prompt
  contains current time at session start, but it becomes stale as the
  conversation progresses. When scheduling, run `date "+%H:%M:%S %Z" &&
  date -u "+%H:%M:%S UTC"` via Bash to get the accurate current time, then
  calculate the cron expression relative to that.
- **Memory-safe builds.** The instance has ~4GB RAM and a 2GB swapfile.
  Repeated `npm install` + build cycles can exhaust memory and freeze the
  system (observed: `systemd-journald: Under memory pressure`). Rules:
  (1) diagnose dep issues first, then do **one** clean `npm install
  --include=dev`; never retry blindly. (2) Run `npm run build
  --workspace=client` and `--workspace=server` **sequentially**, not the
  combined `npm run build` which runs both concurrently. (3) Avoid running
  builds while CLI spawn processes are active when possible.
- **mdart edits need TWO builds, not one.** mdart is consumed in two
  places with different resolution strategies: the **server** imports
  `mdart/dist/index.js` (Node `exports`, cached at boot), and the
  **client** imports `'mdart'` which Vite's alias rewrites to
  `node_modules/mdart/src/index.ts` (a symlink to `~/mdart/packages/mdart`)
  and inlines into the bundle at build time. After editing mdart source:
  (1) `npm run build --workspace=packages/mdart` in `~/mdart/` so the
  server's `dist/` is fresh, (2) `npm run build --workspace=client` in
  `~/claude-steward/` so the client bundle re-bakes the source,
  (3) `POST /api/admin/reload` to PM2-restart the server and broadcast
  the SSE reload that nudges connected browsers to the new bundle. Skip
  step (2) and `MessageBubble.tsx` / `MdArtView.tsx` will keep rendering
  with the stale parser even though `/api/mdart/render` is correct.
- **Registering mini-apps.** Use `POST /api/internal/register-app` — a
  localhost-only endpoint that requires no session cookie. It finds or
  creates the project by name and creates the app_config in one call:
  ```bash
  curl -s -X POST http://localhost:3001/api/internal/register-app \
    -H 'Content-Type: application/json' \
    -d '{
      "project": "claude-steward",
      "name": "my-docs",
      "type": "docs",
      "commandTemplate": "node /home/ubuntu/claude-steward/apps/docs/dist/server.js {port} --docs-dir /home/ubuntu/my-docs",
      "workDir": "/home/ubuntu/my-docs"
    }'
  ```
  Pass `"projectPath": "/path/to/dir"` alongside `"project"` only when
  the project doesn't exist yet (it will be created). The endpoint
  validates that `workDir` exists and that `commandTemplate` contains
  `{port}`. Do **not** do raw SQLite inserts — use this endpoint instead.
- **Rate-limit recovery.** When the user hints at hitting a usage/rate
  limit ("we hit the limit again", "recover from the db", "what were we
  working on"), run `node scripts/recover.mjs` first. It defaults to the
  most recently updated session and prints: limit-hit timestamps, any
  unanswered user prompt (the one that the limit cut off), and the last 6
  messages. Pass a session ID to query a different one, or `--full` for
  un-truncated content. The script respects `DATABASE_PATH` so it works
  inside containers too. opencode session-not-found errors are also
  classified as session_expired and surface here, since the recovery
  pattern is the same.

---

## Port Map

| Port | Process | When |
|---|---|---|
| 3001 | steward-main (prod) | production |
| 3002 | steward-server (dev) | dev |
| 5173 | steward-client (Vite) | dev |
| 3003 | steward-safe | always |
| 4001–4010 | steward-apps (mini-apps) | both; slot N → port 400N → `app{N}.steward.yourdomain.com` |
| `/tmp/claude-worker.sock` | steward-worker | both |
| `/tmp/claude-apps.sock` | steward-apps sidecar | both |
| `23001`, `23003` | opencode-steward container (host-mapped) | when running the docker compose for this branch |

---

## Key Decisions (brief)

- **`node:sqlite` not `better-sqlite3`** — `better-sqlite3` fails on Node 23
  (V8 ABI mismatch); `node:sqlite` is built-in.
- **`fetch()` + manual SSE parser, not `EventSource`** — `EventSource`
  doesn't support custom headers; auth requires `Authorization: Bearer`.
- **Two-ID session design** — `sessions.id` (stable client UUID) vs
  `sessions.claude_session_id` (CLI handle, set after first message,
  cleared on failed resume). The column name predates multi-CLI; despite
  the name it stores whichever CLI's session handle is in use (Claude
  bare ID or opencode `ses_…`).
- **Worker process** — separate PM2 process on Unix socket so in-flight
  CLI jobs survive HTTP server restarts. See `docs/worker-protocol.md`.
- **`CliAdapter` abstraction** — the seam for plugging in a CLI without
  touching the spawn lifecycle. Each adapter owns its binary path, args,
  env policy, output parser (line-at-a-time → canonical events), error
  classifier, and curated model list for the chat picker. See
  `server/src/cli/types.ts` and `docs/agents/<cli>.md` per CLI.
- **`safe/` zero dependencies** — survival guarantee requires no npm
  install step.

---

## Current Open Issues

See `TODO.md` for planned work, `BUGS.md` for known defects. Move completed
works and fixed defects into `archived_tasks.md`.
