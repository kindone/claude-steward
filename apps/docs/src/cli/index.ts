import path from 'node:path'

export type CliName = 'claude' | 'opencode'

export type ErrorCode = 'session_expired' | 'context_limit' | 'provider_quota' | 'process_error'

export type ModelOption = {
  value: string | null
  label: string
}

export type CliCapabilities = {
  streamingTokens: boolean
  toolUseStructured: boolean
  branchResume: boolean
}

export type LaunchOptions = {
  prompt: string
  resumeId: string | null
  systemPrompt: string | null
  model: string | null
  workingDirectory: string
}

export type CanonicalEvent =
  | { type: 'session_id'; externalId: string }
  | { type: 'text_block_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; output: string; isError: boolean }
  | { type: 'result_done'; externalId: string }
  | { type: 'result_error'; code: ErrorCode; message: string; errorText: string }

export interface CliParser {
  parseLine(line: string): { rawChunk: unknown | null; events: CanonicalEvent[] }
}

export interface CliAdapter {
  readonly name: CliName
  readonly label: string
  readonly models: ModelOption[]
  readonly capabilities: CliCapabilities
  binaryPath(): string
  buildArgs(opts: LaunchOptions): string[]
  buildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  createParser(opts: LaunchOptions): CliParser
  classifyError(text: string, hadResume: boolean): ErrorCode
}

export function defaultUserMessageForErrorCode(code: ErrorCode, rawErrorText: string): string {
  if (code === 'provider_quota') return 'The AI provider rate limit or quota was reached. Try again later.'
  if (code === 'context_limit') return 'Context limit reached — sending a new message will start a fresh conversation.'
  if (code === 'session_expired') return 'Previous session could not be resumed — sending a new message will start a fresh one.'
  return rawErrorText
}

function classifyCommonError(text: string): ErrorCode {
  const lower = (text || '').toLowerCase()
  if (
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('resource exhausted') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('529')
  ) return 'provider_quota'

  if (
    lower.includes('context') ||
    lower.includes('too long') ||
    lower.includes('too many tokens') ||
    lower.includes('token limit')
  ) return 'context_limit'

  if (
    lower.includes('session not found') ||
    lower.includes('session expired') ||
    lower.includes('conversation not found') ||
    lower.includes('could not resume')
  ) return 'session_expired'

  return 'process_error'
}

function parseJson(line: string): Record<string, any> | null {
  if (!line.trim()) return null
  try { return JSON.parse(line) as Record<string, unknown> } catch { return null }
}

function cleanClaudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, val] of Object.entries(env)) {
    if (val === undefined) continue
    if (key.startsWith('CLAUDE')) continue
    if (key === 'ANTHROPIC_API_KEY') continue  // force OAuth, not API billing
    out[key] = val
  }
  // Re-admit the explicit allowlist (see CLAUDE.md — Claude CLI Spawn Gotchas)
  if (env.ANTHROPIC_BASE_URL) out.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL
  // Support both the canonical name and the steward-specific alias
  const oauthToken = env.CLAUDE_CODE_OAUTH_TOKEN ?? env.STEWARD_TEST_OAUTH_TOKEN
  if (oauthToken) out.CLAUDE_CODE_OAUTH_TOKEN = oauthToken
  return out
}

function buildOpencodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, val] of Object.entries(env)) {
    if (val === undefined) continue
    if (key === 'CLAUDECODE') continue
    out[key] = val
  }
  if (!('OPENCODE_ENABLE_EXA' in out)) out.OPENCODE_ENABLE_EXA = '1'
  return out
}

class ClaudeParser implements CliParser {
  private sessionIdEmitted = false

  constructor(private readonly opts: LaunchOptions) {}

  parseLine(line: string): { rawChunk: unknown | null; events: CanonicalEvent[] } {
    const chunk = parseJson(line)
    if (!chunk) return { rawChunk: null, events: [] }

    const events: CanonicalEvent[] = []

    if (chunk.type === 'system' && chunk.subtype === 'init' && !this.sessionIdEmitted) {
      this.sessionIdEmitted = true
      events.push({ type: 'session_id', externalId: String(chunk.session_id ?? '') })
    }

    if (chunk.type === 'stream_event') {
      const ev = chunk.event as Record<string, unknown> | undefined
      const delta = ev?.delta as Record<string, unknown> | undefined
      if (ev?.type === 'content_block_start') events.push({ type: 'text_block_start' })
      if (ev?.type === 'content_block_delta' && delta?.type === 'text_delta') {
        events.push({ type: 'text_delta', text: String(delta.text ?? '') })
      }
    }

    if (chunk.type === 'assistant') {
      const blocks = Array.isArray(chunk.message?.content) ? chunk.message.content as Array<Record<string, unknown>> : []
      for (const block of blocks) {
        if (block.type === 'tool_use' && block.id && block.name) {
          events.push({ type: 'tool_use', id: String(block.id), name: String(block.name), input: (block.input as Record<string, unknown>) ?? {} })
        }
      }
    }

    if (chunk.type === 'user') {
      const content = Array.isArray(chunk.message?.content) ? chunk.message.content as Array<Record<string, unknown>> : []
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          events.push({
            type: 'tool_result',
            toolUseId: String(block.tool_use_id),
            output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
            isError: (block.is_error as boolean) ?? false,
          })
        }
      }
    }

    if (chunk.type === 'result') {
      if (chunk.is_error) {
        const errorText = (chunk.errors?.join('; ') || chunk.result || `Claude error: ${chunk.subtype}`) as string
        const code = classifyCommonError(errorText)
        events.push({ type: 'result_error', code, message: defaultUserMessageForErrorCode(code, errorText), errorText })
      } else {
        events.push({ type: 'result_done', externalId: String(chunk.session_id ?? '') })
      }
    }

    return { rawChunk: chunk, events }
  }
}

type OpencodeChunk = Record<string, any>

class OpencodeParser implements CliParser {
  private sessionIdEmitted = false

  constructor(private readonly opts: LaunchOptions) {}

  parseLine(line: string): { rawChunk: unknown | null; events: CanonicalEvent[] } {
    const chunk = parseJson(line) as OpencodeChunk | null
    if (!chunk) return { rawChunk: null, events: [] }

    const events: CanonicalEvent[] = []
    const sessionID = chunk.sessionID ?? (chunk.part as { sessionID?: string } | undefined)?.sessionID
    if (sessionID && !this.sessionIdEmitted) {
      this.sessionIdEmitted = true
      events.push({ type: 'session_id', externalId: sessionID })
    }

    if (chunk.type === 'text') {
      const text = chunk.part?.text as string | undefined
      if (text) {
        events.push({ type: 'text_block_start' })
        events.push({ type: 'text_delta', text })
      }
    }

    if (chunk.type === 'tool_use') {
      const part = chunk.part
      if (part?.tool && part.callID) {
        events.push({ type: 'tool_use', id: String(part.callID), name: String(part.tool), input: (part.state?.input as Record<string, unknown>) ?? {} })
        if (part.state?.output !== undefined) {
          events.push({
            type: 'tool_result',
            toolUseId: String(part.callID),
            output: typeof part.state.output === 'string' ? part.state.output : JSON.stringify(part.state.output),
            isError: Boolean(part.state.metadata?.exit && part.state.metadata.exit !== 0),
          })
        }
      }
    }

    if (chunk.type === 'step_finish' && chunk.part?.reason === 'stop') {
      events.push({ type: 'result_done', externalId: sessionID ?? '' })
    }

    if (chunk.type === 'error') {
      const errorText = chunk.error?.data?.message ?? chunk.error?.name ?? 'opencode error'
      const code = classifyCommonError(errorText)
      events.push({ type: 'result_error', code, message: defaultUserMessageForErrorCode(code, errorText), errorText })
    }

    return { rawChunk: chunk, events }
  }
}

const claudeModels: ModelOption[] = [
  { value: null,                label: 'Default' },
  { value: 'claude-opus-4-6',   label: 'Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5',  label: 'Haiku 4.5' },
]

const opencodeModels: ModelOption[] = [
  { value: null, label: 'Default (env)' },
  // opencode-hosted — no API key required; free, rate-limited by opencode
  { value: 'opencode/big-pickle',           label: 'Big Pickle (opencode, free)' },
  { value: 'opencode/gpt-5-nano',           label: 'GPT-5 Nano (opencode, free)' },
  { value: 'opencode/nemotron-3-super-free',label: 'Nemotron 3 Super (opencode, free)' },
  { value: 'opencode/minimax-m2.5-free',    label: 'MiniMax M2.5 (opencode, free)' },
  { value: 'opencode/hy3-preview-free',     label: 'HY3 Preview (opencode, free)' },
  // Third-party providers — API key required
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'google/gemma-4-31b-it', label: 'Gemma 4 31B' },
  { value: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6 (OC)' },
  { value: 'openai/gpt-5.1', label: 'GPT-5.1' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
]

export const claudeAdapter: CliAdapter = {
  name: 'claude',
  label: 'Claude',
  models: claudeModels,
  capabilities: { streamingTokens: true, toolUseStructured: true, branchResume: true },
  binaryPath: () => process.env.CLAUDE_PATH ?? `${process.env.HOME ?? '/usr/local'}/.local/bin/claude`,
  buildArgs: (opts) => {
    const args = ['--print', opts.prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'acceptEdits']
    if (opts.resumeId) args.push('--resume', opts.resumeId)
    if (opts.systemPrompt) args.push('--system-prompt', opts.systemPrompt)
    if (opts.model) args.push('--model', opts.model)
    return args
  },
  buildEnv: cleanClaudeEnv,
  createParser: (opts) => new ClaudeParser(opts),
  classifyError: classifyCommonError,
}

export const opencodeAdapter: CliAdapter = {
  name: 'opencode',
  label: 'OpenCode',
  models: opencodeModels,
  capabilities: { streamingTokens: false, toolUseStructured: true, branchResume: true },
  binaryPath: () => process.env.OPENCODE_PATH ?? `${process.env.HOME ?? '/root'}/.opencode/bin/opencode`,
  buildArgs: (opts) => {
    const args = ['run', '--dir', path.resolve(opts.workingDirectory), '--format', 'json', '--dangerously-skip-permissions']
    const model = opts.model ?? process.env.OPENCODE_DEFAULT_MODEL ?? null
    if (model) args.push('--model', model)
    if (opts.resumeId) args.push('-s', opts.resumeId)
    const prompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n---\n\n${opts.prompt}` : opts.prompt
    args.push('--', prompt)
    return args
  },
  buildEnv: buildOpencodeEnv,
  createParser: (opts) => new OpencodeParser(opts),
  classifyError: classifyCommonError,
}

export const adapters: Record<CliName, CliAdapter> = {
  claude: claudeAdapter,
  opencode: opencodeAdapter,
}

export function normalizeCliName(value: unknown): CliName {
  return value === 'opencode' ? 'opencode' : 'claude'
}

export function defaultCliName(): CliName {
  return normalizeCliName(process.env.DOCS_DEFAULT_CLI)
}

export function getAdapter(name?: unknown): CliAdapter {
  return adapters[normalizeCliName(name ?? defaultCliName())]
}
