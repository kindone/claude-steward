# Multi-CLI Merge Plan

How the opencode-CLI experiment lives outside this repo, what it proved, and
what we plan to merge back into `claude-steward` (this repo).

> **Status (Apr 2026)** — experiment succeeded (gemma chat via `opencode run`
> works end-to-end). Merge back is planned but **not yet started**. Sessions,
> memory, artifacts, and scheduler state all live in this repo; the experiment
> repo is a sibling clone we don't want to keep diverging.
>
> **Project identity:** the repo / package name `claude-steward` is kept for
> continuity, but the project itself is **no longer Claude-only** as of this
> merge. New CLIs land as additional adapters, not forks. Treat the name as a
> historical artifact, not a scope statement.

---

## The two repos

| Path | Branch | Role |
|---|---|---|
| `/home/ubuntu/claude-steward` | `main` | **Canonical.** All session data, artifacts, scheduler rows, deployed prod + dev. |
| `/home/ubuntu/opencode-steward` | `opencode` | **Experiment.** Same git history, branched off ~8 commits behind to add multi-CLI support and prove opencode integration. |

The experiment branch is **8 commits ahead** of `origin/main` at the time of
writing (see `git log origin/main..HEAD` in opencode-steward). Diff stat
covers ~40 files / ~1,900 insertions.

---

## What the opencode experiment built

Concrete artifacts that already exist on the `opencode` branch and are the
target of the merge:

### 1. `CliAdapter` abstraction
- `server/src/cli/types.ts` (163 lines) — interface, capability flags,
  canonical event types, error codes
- `server/src/cli/claude-adapter.ts` (302 lines) — Claude impl
- `server/src/cli/opencode-adapter.ts` (394 lines) — opencode impl
- `server/src/cli/index.ts` (39 lines) — `getAdapter(name)` dispatch + registry

The interface keeps the spawn lifecycle in `process.ts` / `job-manager.ts`
unchanged; adapters only own CLI-specific concerns: binary path, args, env
scrubbing, stream parsing, error classification, model picker options.

### 2. Sessions schema
- New column `cli TEXT NOT NULL` on `sessions`. Migration default is
  `STEWARD_CLI === 'opencode' ? 'opencode' : 'claude'`, locked at first
  migration time so existing rows on each deployment get marked correctly.
- `claude_session_id` column **kept under that name** (not renamed). The
  experiment treats it as "the previous CLI's opaque resume handle" — see
  refinement note below.
- New type `CliName = 'claude' | 'opencode'`, threaded through queries.

### 3. Routes
- `POST /api/sessions` accepts optional `cli` body field (validates against
  the registry).
- `PATCH /api/sessions/:id` *currently* allows mid-session adapter switch
  with destructive clearing of `claude_session_id` and `model`. **This will
  not be merged** — see refinement below.

### 4. MCP config sync for opencode
- `server/src/mcp/config.ts` adds `syncOpencodeSettings()` (~84 lines added).
  Translates the steward-owned MCP entries from Claude's `~/.claude.json`
  schema (`mcpServers`, `command + args`) into opencode's
  `~/.config/opencode/opencode.json` schema (`mcp`, `command: [array]`,
  `environment`).
- Preserves user-customised entries; only the steward-owned keys get
  overwritten on every server start.
- Test coverage at
  `server/src/__tests__/mcp/syncOpencodeSettings.test.ts` (189 lines).

### 5. Docker / deployment
- Three compose modes: `docker-compose.yml` (minimal), `.evolve.yml`,
  `.shared.yml`.
- Named volumes for opencode state (the critical ones for resume integrity):
  - `opencode-state` → `/root/.local/share/opencode`
  - `opencode-runtime-state` → `/root/.local/state/opencode`
  - `opencode-cache` → `/root/.cache/opencode`
- `/root/.config/opencode` deliberately **not** volume-mounted — rewritten
  on every server start by `syncOpencodeSettings()`.

### 6. Docs split: `AGENTS.md` + `CLAUDE.md`
- `AGENTS.md` (231 lines) — universal, CLI-agnostic agent guidance.
- `CLAUDE.md` (62 lines, down from 171) — Claude-specific layer only.
- `docs/agents/opencode.md` (174 lines) — opencode-specific gotchas: the
  `provider/model` flag form, env-var auth (no credential file), MCP schema
  difference, session-storage volume requirement, no `--system-prompt`
  flag (prepended manually with `---` separator), binary permission mode,
  error classification heuristics.

### 7. Other infrastructure (pulled in alongside)
- `recover.mjs` respects `DATABASE_PATH` env (needed for non-default DB
  locations under docker)
- PM2 ecosystem configs respect inherited `DATABASE_PATH`
- `.gitignore` catches all `.env.*` variants, keeps `.env.example` tracked

---

## Refined design (today's decision)

The experiment landed before we'd settled the per-session CLI lifetime
question. Today's decision: **per-session immutable CLI binding.**

The CLI used by a session is chosen at creation time and never changes.
This sidesteps cross-CLI state translation, mid-session adapter swaps,
and worker-recovery negotiation. Concretely, the merge **drops** these
pieces from the experiment branch:

- `sessionQueries.updateCli(...)` and the `updateCliStmt` prepared statement
- The `cli` field handler in `PATCH /api/sessions/:id`
- Any UI affordance for switching CLI mid-session (none yet implemented)

What to keep instead:
- `cli` field in the **create** payload only
- Adapter dispatch driven by `session.cli` at every spawn
- Session-list / session-header UI shows a small CLI badge (read-only)
- If a target CLI doesn't support resume, its adapter ignores `resumeId`
  and that CLI's sessions are effectively single-shot — accepted trade-off

A future *clone-with-different-CLI* feature is the escape hatch if a user
genuinely wants to migrate a conversation across CLIs (see TODO.md
"Multi-CLI Support" section, second bullet).

---

## What is **not** changing

- `safe/` stays Claude-only. It's frozen per CLAUDE.md (zero-dep survival
  guarantee). Adapter dispatch lives only in `server/`.
- The `claude_session_id` column name stays. It's still the column where
  the per-session opaque resume handle lives; renaming would touch too
  many call sites for no functional gain. The TODO.md entry that proposed
  `cli_handle` is superseded by this doc — column stays as-is.
- `STEWARD_CLI` env stays as the **migration-time default** for legacy
  rows. New rows always have an explicit value from the create route.

---

## Merge-back plan (high level)

1. **Sync upstream first.** Bring `opencode-steward/main` up to current
   `claude-steward/main`. This minimises the diff that has to be reviewed
   in step 2.
2. **Cherry-pick or three-way merge the 8 ahead-commits** into a feature
   branch in this repo. Order roughly: docs/AGENTS split → schema →
   adapter interface + claude adapter → opencode adapter → MCP sync →
   docker volume mounts → recover.mjs / PM2 fixes.
3. **Strip the mid-session swap.** Remove `updateCli`, the PATCH handler
   for `cli`, and the prepared statement. Update any tests that
   exercised it.
4. **Verify**: `npm test` (server fast suite covering the adapter
   interface and MCP sync), then `npm run test:e2e` (hits real Claude
   CLI), then a manual smoke of an opencode session if `OPENCODE_BINARY`
   is configured locally.
5. **Update `TODO.md`** — move the foundation entry from
   "Multi-CLI Support" planned to "shipped"; the future clone-with-CLI
   bullet stays.
6. **Update `MEMORY.md`** with a one-line entry pointing here, since
   the merge represents a significant architectural shift agents will
   need to understand.

---

## Files of interest (when starting the merge)

```
opencode-steward/
  AGENTS.md                                          # universal, NEW
  CLAUDE.md                                          # Claude-only, slimmer
  docs/agents/opencode.md                            # NEW per-CLI doc
  server/src/cli/                                    # NEW directory
    types.ts                  (interface)
    claude-adapter.ts         (impl)
    opencode-adapter.ts       (impl)
    index.ts                  (registry)
  server/src/db/index.ts                             # cli column + queries
  server/src/routes/sessions.ts                      # cli on POST (DROP PATCH)
  server/src/mcp/config.ts                           # syncOpencodeSettings()
  server/src/__tests__/mcp/syncOpencodeSettings.test.ts
  server/src/__tests__/sessions.test.ts              # cli-aware tests
  server/src/claude/process.ts                       # delegates to adapter
  server/src/worker/job-manager.ts                   # delegates to adapter
  docker-compose.yml + .evolve.yml + .shared.yml     # opencode volumes
  scripts/recover.mjs                                # DATABASE_PATH respected
```

---

## Decisions locked in

- **Adopt the `AGENTS.md` + `CLAUDE.md` split** (Apr 2026). `AGENTS.md`
  carries universal, CLI-agnostic guidance; `CLAUDE.md` shrinks to a thin
  Claude-specific layer; `docs/agents/opencode.md` mirrors that pattern
  for opencode. Future CLIs add their own `docs/agents/<cli>.md`. The
  split lands as part of the merge, not as a follow-up.
- **Per-session immutable CLI binding** (Apr 2026). Strip the experiment
  branch's `PATCH /api/sessions/:id` `cli` handler and `sessionQueries.updateCli`
  on the way in.
- **Project name unchanged.** `claude-steward` stays as the repo / package
  name; the README and top-of-`AGENTS.md` should note that the project is
  multi-CLI despite the name.
- **MEMORY.md stays Claude-only, referenced from `AGENTS.md`** (Apr 2026).
  The auto-memory file at
  `~/.claude/projects/-home-ubuntu-claude-steward/memory/MEMORY.md` is
  Claude-Code-harness-specific (the harness auto-loads it; opencode
  doesn't). Don't try to make it portable. `AGENTS.md` notes it exists
  so opencode sessions can pull it in explicitly via Read when relevant
  context lives there; Claude sessions continue to receive it
  automatically with no change in behavior.

## Open questions (decide before merge)

- **Default `STEWARD_CLI` for this deployment** — confirm `claude` (the
  current default in the experiment migration) is correct for the
  production claude-steward instance. New sessions will all carry an
  explicit value from the create route, so this only matters for the
  migration-time backfill of legacy rows.
- **Mid-session swap rollback** — confirm no UI or scripts in the
  experiment depend on the PATCH-cli path before stripping it.
