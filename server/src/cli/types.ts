/**
 * CliAdapter — abstract interface for AI-coding CLI subprocesses.
 *
 * Steward originally hard-coded the Claude CLI's behavior throughout
 * `server/src/claude/process.ts` and `server/src/worker/job-manager.ts`:
 * binary path, args, env-scrubbing policy, stream-json parsing, error
 * classification. This interface gathers all of that into one seam so a
 * second CLI (opencode, aider, codex, …) can be plugged in without rewriting
 * the spawn lifecycle, error handling, or callback shapes.
 *
 * The interface intentionally does **not** own the spawn lifecycle. Both
 * call sites (the SSE-stream path and the worker path) keep their existing
 * spawn / timer / abort / persistence logic; they only delegate the
 * CLI-specific concerns to the adapter.
 */

/** Canonical error class for any CLI failure that surfaces to the user. */
export type ErrorCode = 'session_expired' | 'context_limit' | 'provider_quota' | 'process_error'

/** Short user-facing string for a terminal error, using the raw text only when the code is generic. */
export function defaultUserMessageForErrorCode(code: ErrorCode, rawErrorText: string): string {
  if (code === 'provider_quota') {
    return 'The AI provider rate limit or quota was reached. Check billing, usage, and plan limits in your provider dashboard, or try again in a few minutes.'
  }
  if (code === 'context_limit') {
    return 'Context limit reached — your next message will start a fresh conversation.'
  }
  if (code === 'session_expired') {
    return 'The previous session could not be resumed — your next message will start a fresh conversation.'
  }
  return rawErrorText
}

/**
 * Provider-agnostic launch options.
 *
 * `resumeId` is the CLI-side conversation handle (e.g. Claude's
 * `--resume <session-id>`, cline's `-T <taskId>`). Steward stores this
 * separately from its own stable `sessions.id` — see the two-ID design
 * note in CLAUDE.md.
 */
export type LaunchOptions = {
  prompt: string
  resumeId: string | null
  systemPrompt: string | null
  permissionMode: string | null
  model: string | null
  mcpConfigPath: string | null
  /**
   * Absolute (or resolvable) project root. Passed to the child process as `cwd` by
   * the worker; opencode also receives `--dir` so its internal project root matches.
   */
  workingDirectory?: string | null
}

/**
 * Canonical events emitted by an adapter parser.
 *
 * The parser also returns `rawChunk` so consumers can relay the original
 * provider-shaped chunk over SSE / worker IPC. Adapter-internal logic
 * works off the canonical events.
 */
export type CanonicalEvent =
  | { type: 'session_id'; externalId: string }
  | { type: 'text_block_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; output: string; isError: boolean }
  | { type: 'result_done'; externalId: string }
  | {
      type: 'result_error'
      code: ErrorCode
      /** Human-facing message; may be a friendly substitution for the raw error. */
      message: string
      /** Original error text, preserved for logging. */
      errorText: string
      detail?: string
    }

/**
 * Capability flags. The chat UI / worker may light up or gray out features
 * based on these — e.g. live-token streaming indicator, structured tool-use
 * panels, per-CLI MCP affordances.
 */
export type CliCapabilities = {
  /** Emits text deltas as tokens stream (Claude: yes; cline stdout-JSON: no). */
  streamingTokens: boolean
  /** Tool calls arrive as structured `tool_use` events vs flattened text. */
  toolUseStructured: boolean
  /** Adapter knows how to wire MCP servers via a CLI flag. */
  supportsMcp: boolean
  /** Supports resuming from an arbitrary turn (forking) vs linear continue-only. */
  branchResume: boolean
}

/**
 * One option in the model picker.
 *
 * `value` is the exact string the adapter will hand to the CLI's `--model`
 * flag, so it must be in whatever shape that CLI expects (Claude takes a
 * bare slug like `claude-opus-4-6`; opencode takes `provider/model` like
 * `google/gemma-4-31b-it`). `value: null` means "no --model flag passed",
 * letting the CLI / env fall back to its own default.
 */
export type ModelOption = {
  value: string | null
  label: string
}

/**
 * Per-spawn parser. Stateful: e.g. ensures session_id is emitted at most once.
 * Construct one parser per spawn; throw it away when the child exits.
 */
export interface CliParser {
  /**
   * Parse one line of stdout.
   *
   * @returns `rawChunk` — the parsed provider chunk (for SSE / worker relay), or `null` for unparseable lines.
   *          `events`   — zero or more canonical events derived from the chunk.
   */
  parseLine(line: string): { rawChunk: unknown | null; events: CanonicalEvent[] }
}

/**
 * Stateless adapter. One singleton per CLI; selected via {@link getAdapter}.
 */
export interface CliAdapter {
  readonly name: 'claude' | 'opencode'
  readonly capabilities: CliCapabilities

  /**
   * Curated model picker options surfaced in the chat UI. Each adapter owns
   * the list (and the slug shape — Claude bare names vs opencode
   * `provider/model`) so a single dropdown can render the right options for
   * whichever CLI is active without hardcoding model names in the client.
   * The first entry should always be `{ value: null, label: 'Default' }`.
   */
  readonly models: ModelOption[]

  /**
   * Model to pre-select for newly created sessions. When set, `POST
   * /api/sessions` automatically calls `updateModel` after insert so the
   * session starts with this model rather than null (CLI's own default).
   * Leave undefined to keep null behaviour (let the CLI pick).
   */
  readonly defaultModel?: string | null

  /** Resolve the binary path (env-overridable). */
  binaryPath(): string

  /** Build CLI args for the streaming-chat path from normalized launch options. */
  buildArgs(opts: LaunchOptions): string[]

  /**
   * Build a sanitized env for spawning. Implementers must ensure the policy
   * doesn't accidentally re-admit env vars that cause the CLI to misbehave
   * (e.g. CLAUDECODE=1 sub-agent hang for Claude).
   */
  buildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv

  /** Construct a fresh parser for one spawn lifetime. */
  createParser(opts: LaunchOptions): CliParser

  /**
   * Classify an error message (from result chunk or stderr at process close)
   * into a canonical {@link ErrorCode}. `hadResume` indicates whether the
   * spawn was attempting to resume an existing session — useful heuristic
   * for distinguishing session-expired from other process errors.
   */
  classifyError(text: string, hadResume: boolean): ErrorCode
}
