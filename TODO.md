# Steward — TODO

Canonical task list. Completed items → `archived_tasks.md`. Bugs → `BUGS.md`. Milestone context → `docs/roadmap.md`.

---

## Notes

- **Verify fixes after reload** — bug fixes only take effect after `npm run build` + server reload (`POST /api/admin/reload`). Any fix applied during an active coding session won't be live until the next reload. Worth smoke-testing each fix after deploying.

---

## Planned

### Mini-App Platform
- [ ] **Project templates** — starters for `docs` (MkDocs-style), `notebook` (live code cells + output), `webapp` (Vite + React + Leaflet for travel-type apps)
- [ ] **App start health-check** — after the sidecar reports a process is running, the slot status flips to `running` (green) immediately, but the app process may still be initialising (e.g. Node startup, MkDocs build). nginx returns 502 in the iframe during this window. Fix: after `start`, poll `http://localhost:{port}/` (or a dedicated `GET /healthz`) every ~500 ms until it returns 2xx (or a timeout of ~15 s), keeping status as `starting` (orange) until then. The sidecar already has a `starting` status value — it just never stays there long enough to matter.
- [ ] **Live sidecar status in panel** — `GET /api/projects/:id/apps` currently reads DB only (stale if sidecar diverges mid-run). Query the sidecar's live `status` reply and merge into the response so the panel always reflects ground truth, not cached DB state. Currently the DB is only reconciled on `onReconnected` and `onCrashed` events.

### Scheduler
- [x] **Complex schedule support** — design settled (Apr 2026), two orthogonal additions:
  - **`condition` field** (`TEXT`, JSON) on the schedules row — evaluated at fire time before spawning the job; cron still fires cheaply on a simple cadence (e.g. daily), condition skips the run if not met. Condition types to implement: `every_n_days` (with `ref` ISO date anchor), `last_day_of_month`, `nth_weekday` (n + weekday). Covers: every 10 days, biweekly (every_n_days n=14), last day of month, 2nd Tuesday, etc.
  - **`expires_at` field** (`INTEGER`, unix seconds) — scheduler checks `now > expires_at` before firing and auto-deletes. Generalises the existing `once: true` flag. Covers: "every 3 minutes until 5pm", time-boxed polling loops, etc. `once` stays as a convenience alias.
  - **Schedule groups** (Approach A from original note) — deferred; only needed for "fire at multiple times as one toggle unit"; lower priority than condition+expires_at.
  - **Agent warning**: if computed next fire(s) under the new condition/expiry would result in 0 or 1 actual runs, warn the user (same spirit as the existing >1-week-away warning).
  - Schema delta: `ALTER TABLE schedules ADD COLUMN condition TEXT; ALTER TABLE schedules ADD COLUMN expires_at INTEGER;`
  - MCP tool surface: `schedule_create` / `schedule_update` gain optional `condition` and `expires_at` params; prompt fragment updated to explain plain-language → structured translation.

### Rate Limit Widget
- [ ] **Show Anthropic rate limits in UI** — lightweight SDK probe reads `anthropic-ratelimit-*` response headers and surfaces remaining requests/tokens in the sidebar. Requires `ANTHROPIC_API_KEY` in `.env` (OAuth tokens don't work with the SDK); existing CLI subprocess is untouched.
  - `server/package.json` — add `@anthropic-ai/sdk`
  - `server/src/claude/rateLimits.ts` — background probe (~40 lines): fires on startup + every 60s using a minimal 1-token haiku call; caches last-known headers in memory
  - `server/src/routes/rateLimits.ts` — `GET /api/rate-limits` returns cached values (or `null` if no API key configured)
  - `server/src/index.ts` — wire route + start probe
  - `.env.example` — add `ANTHROPIC_API_KEY=` entry with comment
  - `client/src/components/RateLimitWidget.tsx` — mini widget (~40 lines): polls `/api/rate-limits` every 60s, shows requests and tokens remaining as numbers or progress bar
  - `client/src/components/SessionSidebar.tsx` (or `App.tsx`) — mount widget in sidebar footer

### Core UX
- [ ] **`after=<id>` message fetch endpoint** — `GET /api/sessions/:id/messages?after=<messageId>` returns only messages newer than the given ID; client uses it on visibility-change to append new messages without replacing the full view. Currently the visibility-change re-fetch loads the latest 50 and replaces state, which loses scroll position if the user had paged into older messages. Low priority — >50 new messages while backgrounded is practically impossible in a chat app.

### Push Notifications (hardening)
- [ ] **Push notification improvements** — (send bugs tracked in `BUGS.md`); remaining feature gaps:
  - No per-session or per-user targeting (all subscribers get all notifications); prerequisite for the scheduler per-session opt-in
  - iOS requires "Add to Home Screen" with no in-app guidance; add a dismissible install prompt or at least a tooltip on the bell icon

### Workspace / Files
- [ ] **MCP support** — pass `--mcp-config <path>` to spawn args; `mcp_configs` table per project; UI to manage JSON configs

### Multi-CLI Support
The multi-CLI merge from opencode-steward landed on main in Apr 2026 — see `docs/multi-cli-merge.md` for the design context and `archived_tasks.md` for the merge checklist. Remaining future work:
- [ ] **Revisit Cerebras / extra Groq models when free-tier limits change** — Apr 2026 evaluation: Cerebras free tier on the steward host's `CEREBRAS_API_KEY` is unusable for opencode's agentic flow. `gpt-oss-120b` and `zai-glm-4.7` return 404 (no free access on this key); `llama3.1-8b` has only 8K context (opencode's system prompt + tool defs alone is ~13K tokens); `qwen-3-235b-a22b-instruct-2507` works for plain prompts (~110s cold-start) but tool-use turns time out beyond 180s. Most Groq models are similarly capped — `llama-3.3-70b`/`qwen3-32b`/`gpt-oss-20b`/`gpt-oss-120b` hit 6-12K TPM limits on opencode's first turn (system prompt + tool defs ~50K). `groq/meta-llama/llama-4-scout-17b-16e-instruct` has the highest TPM cap on free Groq (30K) — survives 1-3 turns of an agent loop before cumulative TPM exceeds 30K. Sustained agent work needs Groq Dev Tier (250-500K TPM). Revisit if (a) the user upgrades Cerebras tier, (b) Groq raises free TPM limits, or (c) opencode's prompt shrinks (unlikely). Test command pattern: `opencode run --format json -m <slug> --dangerously-skip-permissions "list files in /tmp using bash"`.
- [ ] **Pre-flight model availability check before opencode commits a turn** — Apr 2026 incidents: when an `opencode run --resume` call fails at the model API layer (404 model not found, 401 invalid auth, 429 quota), the **failure point matters for session integrity**. Failing on turn 1 leaves opencode's local session DB clean (no accumulated function_call state) — the user retries and continues normally (observed: session `ses_226648f6bffexl5k65vDlt20QV`, "Model not found: groq/llama-4-scout" on first turn, fully recovered on retry). Failing on turn N where N has accumulated tool-call history leaves opencode with a **half-formed function_call turn awaiting a function_response that will never arrive** — every subsequent resume sends that malformed history back to the model, which Gemini/Gemma's API rejects with `"Please ensure that function call turn comes immediately after a user turn or after a function response turn."` — session is permanently wedged (observed: `ses_22b5b09ceffeenswENk1q383Dx`, model-swap-then-fail at turn 37 of a Pikchr-related session, all 10 subsequent turns including `/compact` and "hi" returned the same protocol error). The wedging is irrecoverable through the steward UI — the manual `⊡ Compact` button (Claude-bound) routes through the same broken pipe; typing `/compact` is just a user message that opencode also fails to process. Fix path: in `routes/chat.ts` (or the worker's pre-spawn path for opencode), do a lightweight **pre-flight check** before the agent loop — `opencode models <provider>` to confirm the model slug is registered, plus a HEAD/whoami call to the provider with the configured API key, plus a quick TPM budget estimate against the historic message length. On failure, return a clean error to the user **without** invoking `opencode run` at all, so opencode's session DB stays untouched. Cheap and would have prevented both observed wedgings. Lower-priority companion: write a session-rescue tool (script) that surgically deletes the half-formed turn from `~/.local/share/opencode/opencode.db` for already-wedged sessions.
- [ ] **Surface opencode model-side rate-limit / quota errors more cleanly** — Two observed flavors of bad UX, same root cause (provider returns 429 / quota error):
  - **Silent hang flavor**: when the upstream returns a retryable error mid-stream that opencode classifies as retryable (observed: Gemini 2.5 Pro free tier returns `AI_APICallError` 429 `RESOURCE_EXHAUSTED`), opencode logs `ERROR service=llm ... isRetryable:true` to stderr but **never exits and never emits a stdout `error` chunk** — agent retries internally forever. Chat hangs until our 90s TTFB timeout aborts the SSE → blank assistant bubble.
  - **Raw-error flavor**: when opencode does emit an `error` chunk (observed: Groq Llama 4 Scout 30K TPM exceeded after a few turns), our adapter surfaces it via `result_error` but the user sees the verbose Groq message: "Request too large for model `…` in organization `org_…` service tier `on_demand` on tokens per minute (TPM): Limit 30000, Requested 32859, please reduce your message size and try again. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing". Functional but ugly.
  - Fix: in the worker's stderr watcher (`job-manager.ts:110`), parse opencode's `ERROR service=llm` lines for `AI_APICallError` markers (status 429/403/quota-exhausted), and emit a synthetic `result_error` with `code: 'rate_limited'` + a friendly canonical message ("Rate limit hit. Wait ~60s or switch model.") + kill the child. Then in `classifyError` (opencode-adapter.ts:240+), pattern-match the "tokens per minute (TPM)", "RESOURCE_EXHAUSTED", and "rate_limit_exceeded" substrings to map to the same `rate_limited` code so the success path also normalizes. Reproducers: (a) select `google/gemini-2.5-pro` with free-tier `GEMINI_API_KEY` — silent hang; (b) select `groq/meta-llama/llama-4-scout-17b-16e-instruct` and chat for ~5 turns until cumulative tokens >30K — raw error.
- [ ] **Multi-CLI in mini-apps** — `apps/docs`, `apps/notebook`, `apps/notebook-pro` each ship their own `src/claude/spawn.ts` + Claude-bound `routes/chat.ts`, modelled on steward's pre-merge architecture. Port the same `CliAdapter` pattern (`server/src/cli/{types,claude-adapter,opencode-adapter}.ts`) into each app so users can pick a CLI per-session in the embedded chat panel. Strategy: extract the adapter interface + adapters into a shareable workspace package (e.g. `packages/cli-adapters/`) rather than copy-paste three times — apps already share patterns and would all benefit from one place to fix bugs (the `classifyError` "not found" issue would have been three fixes otherwise). Order of attack: (1) extract package, (2) port `apps/docs` (smallest), (3) port `apps/notebook`, (4) port `apps/notebook-pro`. Per-session immutable CLI semantics (same as steward) — no mid-session swap.
- [ ] **Tighten opencode adapter `classifyError` "not found" catchall** — `server/src/cli/opencode-adapter.ts:238` matches bare `'not found'` as the final fallback for `session_expired`. This catches `ProviderModelNotFoundError` (the user-visible "Model not found: google/<x>" error) as if the session expired, surfacing a misleading "previous session could not be resumed — your next message will start a fresh conversation" to the user when the real problem is an invalid model slug or missing provider key. Tighten to either `'session not found'` / `'ses_'` substrings (opencode's actual session-not-found error format) or gate on `hadResume` AND the session/conversation keyword pair, falling through to `process_error` for everything else. Add unit tests covering: ProviderModelNotFoundError → process_error, "Session not found: ses_xyz" → session_expired, hadResume + generic session-related error → session_expired.
- [ ] **Session clone with different CLI** *(future, lower priority — visit much later)* — port `scripts/recover.mjs`'s message-history extraction into a server endpoint that takes session A's transcript and seeds a new session B under a different CLI. The mechanical part is mostly there; the unsolved problem is **tool-call fidelity**: the target CLI didn't run any of A's tool calls, so B's context is "here's a transcript of what another agent did", not "here's what I did". Fine for continuing a discussion, bad for continuing an active edit loop. Worth flagging as a UX caveat in any clone affordance, not a blocker.

### Integrations
- [ ] **Amazing Marvin** — scheduled session that pulls tasks from Marvin API, summarizes via Claude, pushes updates back

### Rate-Limit Resilience
Initial recovery tooling landed: `scripts/recover.mjs` (default = most-recently-updated session, surfaces every `error_code='session_expired'` hit, the unanswered user prompt, and last 6 messages) — invoked manually on a hint from the user. `AGENTS.md` → "Rate-limit recovery" documents the pattern. Two follow-ups to make recovery seamless:
- [ ] **Auto-recovery context injection** — when a new turn starts on a session whose most recent assistant message has `error_code='session_expired'`, server-side prepend a brief "previous turn hit a usage limit at <ts>; unanswered prompt: <text>; last completed exchange: <summary>" block to the system prompt. Avoids the user having to hint at all. Cost: a few hundred prompt tokens for the first turn after a limit hit; gate on `expires_at < now` so it only fires when the limit has actually reset. Implement in the system-prompt builder (where `session_id` is already injected); reuse the same DB queries `scripts/recover.mjs` already does.
- [ ] **Persist streaming partials more aggressively** — assistant rows stuck at `status='streaming'` after a limit hit can have `len=0` even when the model produced text before being cut off (observed: 09:52 UTC row in session `0368fee5…`). Periodic flush to the DB (every ~500 ms or every N tokens) so recovery surfaces partial output. Worker path writes `tool_calls` already; needs the same treatment for the streaming `content` column. Direct-spawn path inherits the same fix.

### Dev Hot-Reload Resilience
- [ ] **Server restart → error bubble (scenario 2)** — when `sendMessage` SSE drops without a terminal event (e.g. tsx watch restarts the server mid-stream), `onError` fires and marks the assistant bubble as a permanent error, even though the worker keeps running and the message completes successfully. Fix: in `handleSend`'s `onError`, detect connection-drop errors (stream ended without `done`/`error`) and switch to `watchSession` mode instead of marking error — same recovery path Tab 2 already uses correctly.
- [ ] **Worker restart → SSE hangs for 90 seconds (scenario 3)** — when the worker process restarts (tsx watch), the in-flight Claude job is killed (irrecoverable). The worker client clears its subscription handlers without notifying them, leaving the client's `sendMessage` SSE open and idle until the 90-second inactivity timeout fires. Fix: either (a) reduce the inactivity timeout significantly (e.g. 10–15s), or (b) have `WorkerClient` emit a synthetic error event to active handlers on socket close so the SSE closes immediately with a clean error.
- [ ] **Tool calls on direct-spawn path** — worker + `result_reply` recovery now persist `tool_calls` to steward.db (`worker.db.jobs.tool_calls`, shared `extractToolDetail` in `server/src/claude/toolDetail.ts`). **Direct-spawn** fallback (`process.ts`) still does not write `tool_calls`; add if parity needed when worker is down.

### Claude Code Project Structure
- [ ] **`.mcp.json`** — MCP server config; a custom MCP server querying steward.db or wrapping pm2/nginx commands would be natural for self-management
- [ ] **ADRs in `docs/adr/`** — structured Architecture Decision Records capturing *why* key decisions were made (node:sqlite over better-sqlite3, worker IPC over in-process, safe/ freeze policy); helps Claude judge whether constraints are load-bearing

### Dev / Production Workflow
- [ ] **Production deploy workflow** — develop + test on `dev.steward.yourdomain.com` → `npm run build` → `POST /api/admin/reload` hot-reloads `steward.yourdomain.com`; document and wire up the build step so deploying is a single command
- [ ] **Environment switcher UI** — floating toggle (authenticated users only) to navigate between `steward.yourdomain.com` (prod) and `dev.steward.yourdomain.com` (dev); consider long-press on header to avoid accidental switches; works in Capacitor WebView too

### Operational Reliability
- [ ] **Enhanced `npm run status`** — extend beyond port checks to cover: PM2 process names + states, required env vars present (`APP_DOMAIN`, `VAPID_PUBLIC_KEY`), nginx `proxy_pass` targets match expected ports, live nginx config matches repo copy (`config/nginx-*.conf`), `server/public/` freshness for prod, TLS cert expiry days
- [ ] **External health monitor** — GitHub Actions scheduled workflow (every 5 min) that `curl`s all three public URLs (`steward`, `dev.steward`, `safe.steward`) and sends a push notification on failure; catches EC2-level and nginx-level outages that an on-server check cannot

### Safe Core
- [ ] **Extending safe core** — discuss splitting into multiple focused safe-cores: current one stays as the Claude Code emergency interface; a second could expose read-only DB queries (session/project browser); further cores could cover other admin tasks. Consider shared port-allocation convention and a lightweight process registry.

### Permissions
- [ ] **Fine-grained tool permissions per session** — the current Plan/Edit/Full triad is coarse. Explore `--allowedTools` / `--disallowedTools` CLI flags (support patterns like `Bash(npm:*)`) to allow command-level whitelists and blacklists. Possible UX: an "Advanced" mode in the session header that exposes an editable allowed-tools list, stored as `allowed_tools TEXT` on the sessions row and passed via `--allowedTools` at spawn time.

### Testing
- [ ] **Migration unit tests** — cover the three startup scenarios in Vitest: (1) fresh DB → `seedStewardProject` creates the project with correct name/path; (2) existing DB with orphaned sessions → `migrateOrphanedSessions` reassigns them; (3) existing DB with steward project already present → both functions are true no-ops (no duplicates). Each test gets its own `DATABASE_PATH` temp file via the existing `setup.ts` pattern.
- [ ] **Fresh-install integration test** — container or isolated-directory smoke test that simulates a real first-run: clone (or copy) the repo, create a minimal `.env`, run `npm install && npm start`, then assert: steward project present in `GET /api/projects`, server returns 200 on `/api/meta`, safe-mode reachable on `:3003`. Candidate approaches: a `Dockerfile.test` (most hermetic) or a GitHub Actions job on a clean runner with no pre-existing DB.

### Packaging
- [ ] **Capacitor shell** — thin native wrapper (iOS + Android + desktop) using Capacitor's remote URL mode pointing at the server; `mobile/` package in monorepo with `capacitor.config.ts`; no bundled assets — always loads from server URL
