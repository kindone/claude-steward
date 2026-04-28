/**
 * opencode CLI adapter — concentrates everything opencode-specific behind
 * the {@link CliAdapter} interface.
 *
 * opencode is a Go binary by opencode-ai (https://opencode.ai) — embedding-
 * first, lighter than Node-based agent CLIs, supports both spawn-per-turn
 * (`opencode run --format json`) and a long-lived HTTP server (`opencode
 * serve`). This adapter implements the spawn-per-turn path; the HTTP
 * server path is a future refactor.
 *
 * ## opencode JSON event schema (captured empirically from `opencode run --format json`)
 *
 * Every line is one event with shape:
 *   { type, timestamp, sessionID, part: {...} }
 *
 * Observed `type` values:
 *   - "step_start"   — agent began a new step (no content)
 *   - "text"         — assistant text (whole-message, no token streaming)
 *   - "tool_use"     — tool call + result, bundled. state.input has the call
 *                      args, state.output the result, state.status the lifecycle
 *                      ("completed" / etc.)
 *   - "step_finish"  — step ended; reason: "stop" (terminal) or "tool-calls"
 *                      (more steps follow). tokens + cost reported here.
 *   - "error"        — terminal error; error: { name, data: { message, ... } }
 *
 * ## Mapping to canonical events
 *   - First event with sessionID → session_id (once)
 *   - text → text_block_start + text_delta (entire text as one delta)
 *   - tool_use (status=completed) → tool_use AND tool_result (synthesized pair)
 *   - step_finish (reason=stop) → result_done
 *   - error → result_error
 *   - step_start, step_finish (reason=tool-calls) → ignored (no canonical equivalent)
 *
 * ## Known limitations
 *   - **No token-level streaming** — opencode `run` emits whole-message text.
 *     The chat UI will show responses appearing all at once instead of token-
 *     by-token. To restore streaming UX we'd need `opencode serve` (HTTP+SSE)
 *     instead of `run`.
 *   - **System prompt prepended to user message** — opencode `run` has no
 *     `--system-prompt` flag. We concatenate with a separator. Not perfectly
 *     faithful to system-prompt semantics, but functional.
 *   - **MCP wired via config file, not per-spawn flag** — opencode reads MCP
 *     servers from its own config dir. First version doesn't wire MCP; that's
 *     a follow-up via the entrypoint or syncClaudeSettings.
 *   - **Permission mode is binary** — opencode requires `--dangerously-skip-
 *     permissions` for any non-interactive tool use. There's no plan-only mode.
 *     The flag is always passed (steward's container caps via cgroup contain
 *     the blast radius).
 */

import type {
  CanonicalEvent,
  CliAdapter,
  CliCapabilities,
  CliParser,
  ErrorCode,
  LaunchOptions,
  ModelOption,
} from './types.js'
import { defaultUserMessageForErrorCode } from './types.js'
import path from 'node:path'

// Allow overriding the opencode binary path via env var. Default to the
// official installer's actual destination — `curl -fsSL https://opencode.ai/install | bash`
// drops the binary at $HOME/.opencode/bin/opencode. Mirrors the claude-adapter
// pattern (which defaults to $HOME/.local/bin/claude). Container builds end up
// at /root/.opencode/bin/opencode (HOME=/root) so the same default works there
// without the Dockerfile's symlink to /usr/local/bin/opencode (which becomes
// redundant — kept for now for back-compat with anything else that points at
// /usr/local/bin).
function resolveBinary(): string {
  return process.env.OPENCODE_PATH ?? `${process.env.HOME ?? '/root'}/.opencode/bin/opencode`
}

const CAPABILITIES: CliCapabilities = {
  // opencode `run` emits whole-message text, no token deltas.
  streamingTokens: false,
  // tool calls arrive as structured events with input/output bundled.
  toolUseStructured: true,
  // MCP supported, but via config file rather than per-spawn flag.
  supportsMcp: true,
  // --fork supported alongside -s/--session for branching off a prior turn.
  branchResume: true,
}

/**
 * Curated dropdown options for the opencode CLI. Slugs use opencode's
 * `provider/model` form — anything else is silently rejected by the CLI
 * and falls back to OPENCODE_DEFAULT_MODEL, which is exactly the bug this
 * list exists to prevent. Each provider here requires its corresponding
 * API key in the env (GEMINI_API_KEY → google/*, ANTHROPIC_API_KEY →
 * anthropic/*); without the key, opencode rejects the call at runtime.
 *
 * `null` = no `--model` flag, lets opencode read OPENCODE_DEFAULT_MODEL
 * (set per-deployment in compose).
 */
const MODELS: ModelOption[] = [
  { value: null,                            label: 'Default (env)' },
  // Google — Gemini API key
  { value: 'google/gemini-2.5-pro',         label: 'Gemini 2.5 Pro' },
  { value: 'google/gemini-2.5-flash',       label: 'Gemini 2.5 Flash' },
  { value: 'google/gemma-4-31b-it',         label: 'Gemma 4 31B' },
  // Anthropic — via opencode (separate from the Claude CLI adapter)
  { value: 'anthropic/claude-opus-4-6',     label: 'Opus 4.6 (via opencode)' },
  { value: 'anthropic/claude-sonnet-4-6',   label: 'Sonnet 4.6 (via opencode)' },
  { value: 'anthropic/claude-haiku-4-5',    label: 'Haiku 4.5 (via opencode)' },
]

// ── Provider-shaped chunk types (opencode JSON output format) ─────────────────

type StepStartChunk = {
  type: 'step_start'
  timestamp: number
  sessionID: string
  part: { id: string; messageID: string; sessionID: string; type: 'step-start' }
}

type TextChunk = {
  type: 'text'
  timestamp: number
  sessionID: string
  part: {
    id: string
    messageID: string
    sessionID: string
    type: 'text'
    text: string
    time?: { start: number; end: number }
  }
}

type ToolUseChunk = {
  type: 'tool_use'
  timestamp: number
  sessionID: string
  part: {
    id: string
    messageID: string
    sessionID: string
    type: 'tool'
    tool: string
    callID: string
    state: {
      status: string
      input: Record<string, unknown>
      output?: unknown
      metadata?: { exit?: number; output?: string; truncated?: boolean; description?: string }
      title?: string
      time?: { start: number; end: number }
    }
  }
}

type StepFinishChunk = {
  type: 'step_finish'
  timestamp: number
  sessionID: string
  part: {
    id: string
    messageID: string
    sessionID: string
    type: 'step-finish'
    reason: 'stop' | 'tool-calls' | string
    tokens?: { total: number; input: number; output: number; reasoning: number; cache: { write: number; read: number } }
    cost?: number
  }
}

type ErrorChunk = {
  type: 'error'
  timestamp: number
  sessionID: string
  error: { name: string; data?: { message?: string; providerID?: string;[k: string]: unknown } }
}

type OpencodeChunk =
  | StepStartChunk
  | TextChunk
  | ToolUseChunk
  | StepFinishChunk
  | ErrorChunk
  | { type: string;[k: string]: unknown }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Coerce opencode's tool output (string | unknown) to a string. */
function toolOutputToString(out: unknown): string {
  if (typeof out === 'string') return out
  if (out == null) return ''
  return JSON.stringify(out)
}

/**
 * Heuristic error classification for opencode failures. Mirrors the Claude
 * adapter's policy so canonical {@link ErrorCode} values stay consistent
 * across adapters, with one refinement: auth/credential errors short-circuit
 * to process_error before the session-expired catchall, since those errors
 * have nothing to do with session state and would otherwise be misclassified
 * when a resume was in flight.
 */
function classifyError(text: string, hadResume: boolean): ErrorCode {
  const lower = (text || '').toLowerCase()

  // Auth / credential / authorization failures → process_error regardless of
  // resume state. opencode's `ProviderAuthError` and similar surface here.
  const isAuthError =
    lower.includes('api key') ||
    lower.includes('apikey') ||
    lower.includes('credential') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('authentic')
  if (isAuthError) return 'process_error'

  const isProviderQuota =
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('resource exhausted') ||
    lower.includes('resource has been exhausted') ||
    lower.includes('too many requests') ||
    lower.includes('exceeded your') ||
    lower.includes('check your plan and billing') ||
    lower.includes('429') ||
    lower.includes('overload') ||
    lower.includes('overloaded') ||
    lower.includes('529') ||
    (lower.includes('over capacity') && lower.includes('request'))
  if (isProviderQuota) return 'provider_quota'

  const isContextLimit =
    lower.includes('context') ||
    lower.includes('too long') ||
    lower.includes('too many tokens') ||
    lower.includes('maximum') ||
    lower.includes('token limit')
  if (isContextLimit) return 'context_limit'

  if (hadResume || lower.includes('session') || lower.includes('not found')) {
    return 'session_expired'
  }
  return 'process_error'
}

// ── Parser ────────────────────────────────────────────────────────────────────

class OpencodeParser implements CliParser {
  private sessionIdEmitted = false

  constructor(private readonly opts: LaunchOptions) {}

  parseLine(line: string): { rawChunk: unknown | null; events: CanonicalEvent[] } {
    if (!line.trim()) return { rawChunk: null, events: [] }

    let chunk: OpencodeChunk
    try {
      chunk = JSON.parse(line) as OpencodeChunk
    } catch {
      return { rawChunk: null, events: [] }
    }

    const events: CanonicalEvent[] = []

    // Emit session_id from the first event that carries one.
    const sessionID = (chunk as { sessionID?: string }).sessionID
    if (sessionID && !this.sessionIdEmitted) {
      this.sessionIdEmitted = true
      events.push({ type: 'session_id', externalId: sessionID })
    }

    if (chunk.type === 'text') {
      const text = (chunk as TextChunk).part?.text ?? ''
      if (text) {
        // Mirror Claude's emission: text_block_start lets the consumer apply
        // paragraph-break heuristics if a tool use preceded this text.
        events.push({ type: 'text_block_start' })
        events.push({ type: 'text_delta', text })
      }
    } else if (chunk.type === 'tool_use') {
      const part = (chunk as ToolUseChunk).part
      if (part?.tool && part.callID) {
        // Synthesize the canonical pair (tool_use + tool_result) from one
        // opencode event. Claude emits these as separate stream events; the
        // consumer (JobManager) treats them as such.
        events.push({
          type: 'tool_use',
          id: part.callID,
          name: part.tool,
          input: part.state?.input ?? {},
        })
        if (part.state?.status === 'completed') {
          const output = toolOutputToString(part.state.output)
          // Bash exit code != 0 is the strongest error signal we have here.
          // Other tools may not populate metadata.exit; default to false.
          const isError =
            typeof part.state.metadata?.exit === 'number' && part.state.metadata.exit !== 0
          events.push({
            type: 'tool_result',
            toolUseId: part.callID,
            output,
            isError,
          })
        }
      }
    } else if (chunk.type === 'step_finish') {
      const reason = (chunk as StepFinishChunk).part?.reason
      if (reason === 'stop') {
        events.push({ type: 'result_done', externalId: sessionID ?? '' })
      }
      // reason === 'tool-calls' marks an intermediate step; no canonical event.
    } else if (chunk.type === 'error') {
      const err = (chunk as ErrorChunk).error
      const errorText = err?.data?.message ?? err?.name ?? 'opencode error'
      const code = classifyError(errorText, Boolean(this.opts.resumeId))
      const message = defaultUserMessageForErrorCode(code, errorText)
      events.push({ type: 'result_error', code, message, detail: errorText, errorText })
    }

    return { rawChunk: chunk, events }
  }
}

// ── Args ──────────────────────────────────────────────────────────────────────

function buildArgs(opts: LaunchOptions): string[] {
  const args: string[] = [
    'run',
  ]

  // Pin project root explicitly — spawn cwd alone is not always respected for tool
  // sandboxes; without --dir opencode may infer a different root (e.g. `apps/`).
  if (opts.workingDirectory) {
    args.push('--dir', path.resolve(opts.workingDirectory))
  }

  args.push(
    '--format', 'json',
    // Required for non-interactive tool use. Without this, the agent cannot
    // execute tool calls and emits 0 output tokens. Steward's container
    // cgroup limits + sandboxed execution contain the blast radius.
    '--dangerously-skip-permissions',
  )

  // Model selection. opencode uses provider/model format (e.g.
  // google/gemma-4-31b-it, google/gemini-2.5-flash, anthropic/…). When the session
  // doesn't specify a model, fall back to OPENCODE_DEFAULT_MODEL so deployments
  // can pin a tier-appropriate default (free-tier keys often don't have access
  // to opencode's auto-detected paid default like gemini-3-pro-preview).
  const model = opts.model ?? process.env.OPENCODE_DEFAULT_MODEL ?? null
  if (model) args.push('--model', model)

  // Session resume — opencode session id (format: ses_<id>).
  if (opts.resumeId) args.push('-s', opts.resumeId)

  // System prompt: opencode `run` has no --system-prompt flag. Prepend to the
  // user message with a clear separator. Not perfectly faithful to system-
  // prompt semantics (the model sees it as an earlier user turn), but
  // functional and reproducible.
  const fullPrompt = opts.systemPrompt
    ? `${opts.systemPrompt}\n\n---\n\n${opts.prompt}`
    : opts.prompt

  // `--` ends option parsing; safe even when prompt doesn't start with `-`.
  args.push('--', fullPrompt)

  return args
}

// ── Env ───────────────────────────────────────────────────────────────────────

/**
 * opencode reads provider keys directly from env (GOOGLE_GENERATIVE_AI_API_KEY,
 * ANTHROPIC_API_KEY, etc.) and doesn't have Claude-style sub-agent IPC vars to
 * scrub. Pass env through largely untouched.
 *
 * We still strip `CLAUDECODE`/`CLAUDE_CODE_*` proactively so an opencode child
 * can't accidentally trigger Claude-CLI sub-agent behavior if it ever spawns
 * claude as a downstream tool (defensive, not currently required).
 *
 * ## OPENCODE_ENABLE_EXA gate
 *
 * opencode's built-in `websearch` tool is gated behind this env var (or
 * picking the OpenCode/Zen provider — not our path). Without it, the tool is
 * never registered, so the model never sees it and `permission.websearch:
 * "allow"` in opencode.json is permission for nothing. We default it to '1'
 * so steward sessions get web search out of the box. Deployments that want
 * to disable can set `OPENCODE_ENABLE_EXA=` (empty) in the host env — that
 * gets passed through unchanged and opencode reads it as falsy.
 *
 * Backing service is Exa AI's anonymous MCP at mcp.exa.ai/mcp (no API key
 * required, aggressive but unpublished rate limit). Set `EXA_API_KEY` in the
 * host env for the free 1k/mo tier; it's already passed through by the
 * loop above.
 */
function buildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, val] of Object.entries(env)) {
    if (val === undefined) continue
    if (key === 'CLAUDECODE') continue
    out[key] = val
  }
  // Default ON. Deployment can opt out by exporting OPENCODE_ENABLE_EXA=''
  // (empty string passes through above and opencode treats it as falsy).
  if (!('OPENCODE_ENABLE_EXA' in out)) {
    out.OPENCODE_ENABLE_EXA = '1'
  }
  return out
}

// ── Adapter export ────────────────────────────────────────────────────────────

export const opencodeAdapter: CliAdapter = {
  name: 'opencode',
  capabilities: CAPABILITIES,
  models: MODELS,
  binaryPath: resolveBinary,
  buildArgs,
  buildEnv,
  createParser: (opts) => new OpencodeParser(opts),
  classifyError,
}
