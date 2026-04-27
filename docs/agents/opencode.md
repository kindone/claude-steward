# opencode CLI — Agent Notes

Per-CLI specifics for the opencode adapter. Pair this file with
[`AGENTS.md`](../../AGENTS.md) (universal) and the `CliAdapter` interface
in `server/src/cli/types.ts`. The opencode adapter itself lives at
`server/src/cli/opencode-adapter.ts`.

---

## What opencode is

A Go-based AI-coding CLI by opencode-ai (https://opencode.ai). Embedding-
first design, lighter per-invocation startup than Node-based agent CLIs,
multi-provider (Google, Anthropic, OpenAI, …). Steward currently uses the
spawn-per-turn path (`opencode run --format json`). The HTTP server path
(`opencode serve`) is a future refactor — not wired up yet.

---

## Model selection — `provider/model` form is mandatory

opencode's `--model` flag expects `provider/model`, not a bare slug:

| Wrong | Right |
|---|---|
| `claude-sonnet-4-6` | `anthropic/claude-sonnet-4-6` |
| `gemini-2.5-flash`  | `google/gemini-2.5-flash` |
| `gpt-4o-mini`       | `openai/gpt-4o-mini` |

Bare slugs are silently rejected and opencode falls back to
`OPENCODE_DEFAULT_MODEL` (env). The chat UI's model picker is fed by
`opencodeAdapter.models` for exactly this reason — keeping the dropdown
adapter-correct prevents that silent fallback.

When adding new models to the picker, edit the `MODELS` constant in
`server/src/cli/opencode-adapter.ts`. Each provider entry requires its
corresponding API key in the env:

| Provider prefix | Required env var |
|---|---|
| `google/`     | `GEMINI_API_KEY` (also exported as `GOOGLE_GENERATIVE_AI_API_KEY` for AI-SDK) |
| `anthropic/`  | `ANTHROPIC_API_KEY` |
| `openai/`     | `OPENAI_API_KEY` |

Without the key, opencode rejects the call at runtime — there is no
pre-flight gate. If you add a model whose key may not be present in all
deployments, expect runtime errors and document the dependency.

---

## Auth — opencode reads env vars, not credential files

Unlike Claude (long-lived OAuth token via `claude setup-token`), opencode
uses provider API keys directly from the environment. No setup flow, no
credential file rotation. `opencode auth list` shows what it sees.

GEMINI_API_KEY is forked into both `GEMINI_API_KEY` and
`GOOGLE_GENERATIVE_AI_API_KEY` in the compose file because opencode's
`auth list` detects the former while the AI-SDK Google provider call
requires the latter. One source-of-truth in `.env`, two exports.

---

## MCP wiring — different file, different schema

opencode reads MCP servers from `$XDG_CONFIG_HOME/opencode/opencode.json`
(or `$HOME/.config/opencode/opencode.json`). Schema differs from Claude's:

```jsonc
// Claude (~/.claude.json)
{
  "mcpServers": {
    "steward-schedules": {
      "type": "stdio",
      "command": "node",
      "args": ["/app/server/dist/mcp/schedule-server.js"],
      "env": { … }
    }
  }
}

// opencode (~/.config/opencode/opencode.json)
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "steward-schedules": {
      "type": "local",
      "command": ["node", "/app/server/dist/mcp/schedule-server.js"],
      "environment": { … }
    }
  }
}
```

`syncOpencodeSettings()` in `server/src/mcp/config.ts` translates
schemas and writes the opencode file on every server startup.
Existing user customizations and unrelated MCP servers in that file are
preserved (only the steward-owned entries are overwritten).

`opencode mcp list` confirms whether the registrations are picked up.
Tests for the sync function live at
`server/src/__tests__/mcp/syncOpencodeSettings.test.ts`.

---

## Session storage — outside the writable layer in containers

opencode persists per-conversation state in
`/root/.local/share/opencode/` (`opencode.db`, `snapshot/`, `storage/`)
plus `/root/.cache/opencode` and `/root/.local/state/opencode`.

In the container, these paths are bound to **named volumes** in
`docker-compose.yml`:

```
opencode-state          → /root/.local/share/opencode
opencode-runtime-state  → /root/.local/state/opencode
opencode-cache          → /root/.cache/opencode
```

Without these mounts, every `docker compose up --build` wipes opencode's
session DB but leaves steward's `sessions.claude_session_id` pointing at
gone IDs — symptom is "past session responds with empty content" on
resume. Don't drop the volume mounts.

`/root/.config/opencode` is intentionally **not** volume-mounted.
`syncOpencodeSettings()` rewrites it on every server start, so persistence
would only stash a stale `MCP_NOTIFY_SECRET` that gets clobbered anyway.

---

## Output: whole-message, not token-streaming

`opencode run --format json` emits one JSON object per event, but the
`text` event contains the whole assistant message (no per-token deltas).
The adapter signals this via `capabilities.streamingTokens = false`; the
chat UI shows the message materialising at once instead of typing
token-by-token.

If we ever need real token streaming, the `opencode serve` HTTP+SSE path
is the place to look — that's a separate adapter rewrite.

---

## System prompt — prepended, not flagged

opencode `run` has no `--system-prompt` flag. The adapter prepends the
system prompt to the user message with a `---` separator. Not perfectly
faithful to system-prompt semantics (the model sees it as an earlier user
turn), but functional and reproducible. If opencode adds a real flag in
a later release, switch the adapter and update the docstring.

---

## Permission mode — binary

opencode requires `--dangerously-skip-permissions` for any non-interactive
tool use. There's no plan-only / acceptEdits middle ground. The adapter
always passes the flag; steward's container cgroup limits + sandboxed
execution contain the blast radius. If steward ever needs finer control,
that's an opencode upstream issue, not an adapter one.

---

## Error classification

opencode's `NotFoundError` for resumed sessions ("Session not found:
ses_…") flows out on stderr, not as a JSON error chunk. The adapter's
`classifyError()` catches it via the substring match `'session' || 'not
found'` and routes it to canonical `session_expired`, so the worker
clears the stale ID and surfaces a friendly "your next message will start
a fresh conversation" to the user — same handling as Claude's analogous
session expiry. See `classifyError` in `opencode-adapter.ts` for the
full pattern set (auth, quota, context limit).
