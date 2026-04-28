/**
 * Claude CLI adapter — concentrates everything Claude-specific from the
 * legacy `server/src/claude/process.ts` and `server/src/worker/job-manager.ts`
 * spawn paths into a single {@link CliAdapter} implementation.
 *
 * The adapter does NOT own the spawn lifecycle (that stays in the call
 * sites for backward compat). It owns: binary path, args construction,
 * env policy, stream-json parsing, and error classification.
 */

import { buildCleanEnv } from '../claude/clean-env.js'
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

// Allow overriding the claude binary path via env var, with ~/.local/bin fallback.
// Resolved lazily (inside binaryPath) so test/CI envs that change CLAUDE_PATH
// after import time still take effect.
function resolveBinary(): string {
  return process.env.CLAUDE_PATH ?? `${process.env.HOME ?? '/usr/local'}/.local/bin/claude`
}

const CAPABILITIES: CliCapabilities = {
  streamingTokens: true,
  toolUseStructured: true,
  supportsMcp: true,
  branchResume: true,
}

/**
 * Curated dropdown options for the Claude CLI. Slugs are bare model names
 * (no `provider/` prefix) — Claude CLI rejects the prefixed form. Names
 * verified against `claude --model …` accepted values for the installed
 * release. `null` = no `--model` flag, lets Claude pick its own default.
 */
const MODELS: ModelOption[] = [
  { value: null,                 label: 'Default' },
  { value: 'claude-opus-4-6',    label: 'Opus 4.6' },
  { value: 'claude-sonnet-4-6',  label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-5',    label: 'Opus 4.5' },
  { value: 'claude-sonnet-4-5',  label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5',   label: 'Haiku 4.5' },
]

// ── Provider-shaped chunk types (Claude stream-json output format) ────────────

type SystemInitChunk = {
  type: 'system'
  subtype: 'init'
  session_id: string
}

type StreamEventChunk = {
  type: 'stream_event'
  event: {
    type: string
    index?: number
    content_block?: { type: string; name?: string }
    delta?: { type: string; text: string }
  }
}

type AssistantChunk = {
  type: 'assistant'
  message: {
    content: Array<{
      type: string
      id?: string
      name?: string
      text?: string
      input?: Record<string, unknown>
    }>
  }
}

type UserChunk = {
  type: 'user'
  message: {
    content: Array<{
      type: 'tool_result'
      tool_use_id: string
      content: unknown
      is_error: boolean
    }>
  }
}

type ResultChunk = {
  type: 'result'
  subtype: string
  result: string
  session_id: string
  is_error: boolean
  errors?: string[]
  usage?: { input_tokens: number; output_tokens: number }
  total_cost_usd?: number
}

type ClaudeChunk =
  | SystemInitChunk
  | StreamEventChunk
  | AssistantChunk
  | UserChunk
  | ResultChunk
  | { type: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize a tool_result content value to a plain string. The Claude API
 * allows tool result content to be either a string or an array of text blocks.
 * Mirrors the legacy worker normalization so behavior is preserved.
 */
function normalizeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((b) => b?.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
  }
  return String(content ?? '')
}

/**
 * Heuristic error classification. Inspects the raw error text. Centralized
 * here (was previously duplicated across spawnClaude / JobManager / their
 * close handlers).
 *
 * Order matters: quota / context / model checks short-circuit ahead of the
 * session-expired branch.
 *
 * The `hadResume` flag is intentionally NOT used as a fallback. Earlier
 * versions tagged any error during a resume as `session_expired`, which
 * produced the misleading "previous session could not be resumed" banner
 * for unrelated transient failures (model rejection, network blip, etc.).
 * Now we require explicit session-failure phrasing — anything else falls
 * through to `process_error`, which displays a generic "something went
 * wrong; retry" instead of falsely declaring the session dead.
 */
function classifyError(text: string, _hadResume: boolean): ErrorCode {
  const lower = (text || '').toLowerCase()
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

  // Model / provider rejection. Catches Claude's "Invalid model" and the
  // analogous opencode signal in case it ever surfaces here too.
  const isModelError =
    lower.includes('invalid model') ||
    lower.includes('unknown model') ||
    lower.includes('model not found') ||
    (lower.includes('model') && lower.includes('not found'))
  if (isModelError) return 'process_error'

  // Session expired — explicit phrasing only.
  const isSessionExpired =
    lower.includes('session not found') ||
    lower.includes('session expired') ||
    lower.includes('session has expired') ||
    lower.includes('no such session') ||
    lower.includes('could not resume') ||
    lower.includes('could not be resumed') ||
    lower.includes('conversation not found') ||
    lower.includes('no conversation found')
  if (isSessionExpired) return 'session_expired'

  return 'process_error'
}

// ── Parser ────────────────────────────────────────────────────────────────────

class ClaudeParser implements CliParser {
  private sessionIdEmitted = false

  constructor(private readonly opts: LaunchOptions) {}

  parseLine(line: string): { rawChunk: unknown | null; events: CanonicalEvent[] } {
    if (!line.trim()) return { rawChunk: null, events: [] }

    let chunk: ClaudeChunk
    try {
      chunk = JSON.parse(line) as ClaudeChunk
    } catch {
      return { rawChunk: null, events: [] }
    }

    const events: CanonicalEvent[] = []

    // system/init: emit external session id once per spawn.
    if (
      chunk.type === 'system' &&
      (chunk as SystemInitChunk).subtype === 'init' &&
      !this.sessionIdEmitted
    ) {
      this.sessionIdEmitted = true
      events.push({ type: 'session_id', externalId: (chunk as SystemInitChunk).session_id })
    }

    // stream_event: text-block boundaries and text deltas.
    if (chunk.type === 'stream_event') {
      const ev = (chunk as StreamEventChunk).event
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
        events.push({ type: 'text_block_start' })
      }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        events.push({ type: 'text_delta', text: ev.delta.text })
      }
    }

    // assistant chunk: assembled tool_use blocks.
    if (chunk.type === 'assistant') {
      const content = (chunk as AssistantChunk).message?.content ?? []
      for (const block of content) {
        if (block.type === 'tool_use' && block.name && block.id) {
          events.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: (block.input as Record<string, unknown>) ?? {},
          })
        }
      }
    }

    // user chunk: tool_result blocks emitted back to Claude.
    if (chunk.type === 'user') {
      const content = (chunk as UserChunk).message?.content ?? []
      for (const block of content) {
        if (block.type === 'tool_result') {
          events.push({
            type: 'tool_result',
            toolUseId: block.tool_use_id,
            output: normalizeToolResultContent(block.content),
            isError: block.is_error ?? false,
          })
        }
      }
    }

    // result: terminal — either done or error.
    if (chunk.type === 'result') {
      const r = chunk as ResultChunk
      if (r.is_error) {
        const errorText = r.errors?.join('; ') || r.result || `Claude error: ${r.subtype}`
        const code = classifyError(errorText, Boolean(this.opts.resumeId))
        const message = defaultUserMessageForErrorCode(code, errorText)
        events.push({ type: 'result_error', code, message, detail: errorText, errorText })
      } else {
        events.push({ type: 'result_done', externalId: r.session_id })
      }
    }

    return { rawChunk: chunk, events }
  }
}

// ── Args ──────────────────────────────────────────────────────────────────────

function buildArgs(opts: LaunchOptions): string[] {
  const args: string[] = [
    '--print',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]

  if (opts.resumeId) args.push('--resume', opts.resumeId)
  if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt)

  // 'default' means interactive prompts — unusable in our non-interactive spawn;
  // skip the flag entirely and let Claude use its own default.
  if (opts.permissionMode && opts.permissionMode !== 'default') {
    args.push('--permission-mode', opts.permissionMode)
  }

  if (opts.model) args.push('--model', opts.model)

  // MCP schedule tools: load steward's schedule server and block the harness
  // cron tools (CronCreate/CronDelete) — those are session-only and would
  // confuse schedule management. CronList is allowed for read-only inspection.
  if (opts.mcpConfigPath) {
    args.push('--mcp-config', opts.mcpConfigPath)
    args.push('--disallowed-tools', 'CronCreate,CronDelete')
  }

  return args
}

// ── Adapter export ────────────────────────────────────────────────────────────

export const claudeAdapter: CliAdapter = {
  name: 'claude',
  capabilities: CAPABILITIES,
  models: MODELS,
  binaryPath: resolveBinary,
  buildArgs,
  buildEnv: (env) => buildCleanEnv(env),
  createParser: (opts) => new ClaudeParser(opts),
  classifyError,
}
