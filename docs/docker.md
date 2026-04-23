# Docker — Containerized Test Environment

Steward can run as a self-contained container for end-to-end testing without
touching the production install. The operational runbook (prerequisites,
commands, troubleshooting) lives next to the files it describes:
[`docker/README.md`](../docker/README.md). This doc covers the design
decisions and architectural boundaries.

---

## Why

Two separate problems motivated the container:

1. **Reproducibility.** The prod install on the host has a decade of
   accumulated state — `~/.claude/projects/`, old DB migrations, mixed npm
   versions, half-edited worktrees. Any end-to-end run that matters needs to
   boot from a deterministic baseline.
2. **Auth isolation.** The first-attempt strategy of mounting `~/.claude/`
   into the container broke the host login every time the container ran —
   see [auth strategy](#auth-strategy) for why. The container now uses a
   long-lived OAuth token that's independent of the host's rotating
   credentials.

---

## What runs in the container

PM2 launches the same three processes as production, in a single container:

| Process | Port | Purpose |
|---|---|---|
| `steward-main` | 3001 → host `13001` | Express API + static client bundle |
| `steward-worker` | Unix socket | Claude CLI subprocess manager |
| `steward-safe` | 3003 → host `13003` | Emergency fallback (zero deps) |

Mini-apps (ports 4001–4010) are **not** exposed by default; tests that need
them must add port mappings in `docker-compose.yml`.

SQLite lives on a named Docker volume (`steward-data`), so `docker compose
down` preserves the DB but `docker compose down -v` wipes it. Tests that
need a clean slate use `-v`.

---

## Auth strategy

### First attempt: share `~/.claude/` (broken)

Original design mounted a stripped clone of `~/.claude/` read-only, copied
it to a writable `/root/.claude/` inside the container, and let the CLI
auto-refresh tokens as normal. This failed because:

- Anthropic's OAuth server **rotates refresh tokens on use** — each refresh
  invalidates the previous one server-side.
- The host and container started with the same refresh token. Whichever one
  refreshed first got a new valid pair; the other's stored refresh token
  was already dead at the auth server.
- Running the container invalidated the host's prod login, every time.

### Current design: independent OAuth token

`claude setup-token` generates a long-lived OAuth token that is a separate
grant from the rotating `~/.claude/.credentials.json` pair. Same Anthropic
account, independent credentials — the container's token doesn't rotate, so
nothing it does can invalidate the host's session. Setup:

```bash
CLAUDE_CONFIG_DIR=$HOME/.claude-test claude setup-token
# Add the printed token to .env as STEWARD_TEST_OAUTH_TOKEN
```

`docker-compose.yml` passes it into the container as
`CLAUDE_CODE_OAUTH_TOKEN`, which the Claude CLI reads directly — no
credentials file needed.

### The `cleanEnv` gotcha

When the server spawns the Claude CLI, it strips the entire `CLAUDE*` env
family to avoid the `CLAUDECODE=1` sub-agent hang (see root `CLAUDE.md` →
"Claude CLI Gotchas"). That would also strip `CLAUDE_CODE_OAUTH_TOKEN`,
leaving the CLI unauthenticated.

The strip/allowlist policy is now consolidated in
[`server/src/claude/clean-env.ts`](../server/src/claude/clean-env.ts) and
used by all three spawn sites (main SSE path, compaction path, worker).
`CLAUDE_CODE_OAUTH_TOKEN` is explicitly re-admitted after the strip, and
the test suite (`server/src/__tests__/claude/clean-env.test.ts`) pins the
contract so it can't regress.

---

## Bootstrap: `/root/.claude.json`

The server's MCP registration path (`syncClaudeSettings` in
`server/src/mcp/config.ts`) silently no-ops if `~/.claude.json` doesn't
exist — and inside a fresh container, it doesn't. Without the file, the
`steward-schedules` and `steward-artifacts` MCP servers don't register, so
Claude CLI sessions inside the container can't use scheduling or artifact
tools.

The entrypoint pre-creates `/root/.claude.json` as `{}` before starting
PM2, so `syncClaudeSettings` has a file to populate on first run.

---

## Explicit non-goals

- **No prod parity.** The container is for testing only. It uses
  `APP_DOMAIN=test.steward.jradoo.com`, exposes non-prod ports, and has a
  throwaway API key. Don't copy this config onto a real server.
- **No data persistence across teardowns.** `docker compose down -v` is
  expected to wipe the DB. Session history lives in SQLite on the named
  volume; session tool calls and conversations are ephemeral by design.
- **No mini-app testing by default.** The 4001–4010 port range is
  unmapped. Add explicit port mappings if the test target needs them.
