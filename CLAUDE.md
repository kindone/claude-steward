# Claude Steward — Claude CLI Notes

> **Universal conventions live in [`AGENTS.md`](./AGENTS.md).** Read that first;
> this file only adds Claude-specific gotchas you need when working with the
> Claude CLI subprocess (its env, stdio, stream-json output) or while running
> as Claude Code yourself.
>
> For opencode CLI specifics see [`docs/agents/opencode.md`](./docs/agents/opencode.md).

---

## Claude CLI Spawn Gotchas

These have caused significant bugs — do not skip:

1. **`CLAUDECODE=1` causes hanging** — child inherits this var from a parent
   Claude session and waits for IPC that never comes. Strip all env vars
   starting with `CLAUDE` from the spawn env, then re-admit the explicit
   allowlist: `CLAUDE_CODE_OAUTH_TOKEN` (long-lived headless-auth token from
   `claude setup-token`) and `ANTHROPIC_BASE_URL` (endpoint override). See
   `server/src/claude/process.ts` and `server/src/worker/job-manager.ts`.
2. **`CI=true` is required** — `--output-format stream-json` produces no
   output when stdout is a pipe (TTY detection). Always set `CI=true` in
   the spawn env.
3. **Close stdin** — use `stdio: ['ignore', 'pipe', 'pipe']`; otherwise
   Claude may block on stdin.
4. **`res.on('close')` not `req.on('close')`** — Express fires
   `req.on('close')` when the request body is consumed, not on client
   disconnect. SSE cleanup must use `res.on('close')`.
5. **No `assistant` chunk fallback** — with `--include-partial-messages`,
   the final `assistant` chunk duplicates the full accumulated text. Only
   handle `content_block_delta`; ignore the `assistant` chunk type.

The above policy is implemented inside `server/src/cli/claude-adapter.ts`
(`buildEnv` + `buildCleanEnv` + parser). Mirror any new gotchas there
rather than scattering them through the worker.

---

## MCP Configuration

Claude Code reads MCP server registrations from `~/.claude.json`. The
steward server auto-syncs `steward-schedules` and `steward-artifacts` into
that file on every startup via `syncClaudeSettings()` in
`server/src/mcp/config.ts`. Don't edit the steward-owned entries by hand;
they'll be overwritten on next restart. (For opencode, the parallel sync
target is `~/.config/opencode/opencode.json` with a different schema —
see `docs/agents/opencode.md`.)

`session_id` is injected into the system prompt for every chat turn so MCP
tools can resolve it without a DB query.

---

## When you're running *as* Claude Code (not just spawning it)

- **Don't emit `<schedule>` text blocks.** That was an old mechanism, no
  longer processed. Use the `steward-schedules` MCP tools.
- **Don't call `CronCreate` / `CronDelete`.** Those are session-only harness
  tools that don't persist across sessions; use the MCP equivalents.
- **`/loop` and `/schedule` skills** are surfaced by the harness — use them
  for recurring tasks rather than rolling your own.
