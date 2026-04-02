/**
 * Thin wrapper around the Claude CLI for the docs app.
 * Adapted from server/src/claude/process.ts — same patterns, trimmed down.
 *
 * Emits events via a callback rather than writing directly to an HTTP response,
 * so the caller can fan-out to multiple subscribers and survive disconnects.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

type SystemInitChunk = { type: 'system'; subtype: 'init'; session_id: string }
type StreamEventChunk = { type: 'stream_event'; event: { type: string; index?: number; delta?: { type: string; text: string } } }
type AssistantChunk = { type: 'assistant'; message: { content: Array<{ type: string; id?: string; name?: string; text?: string; input?: Record<string, unknown> }> } }
type UserChunk = { type: 'user'; message: { role: 'user'; content: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }> } }
type ResultChunk = { type: 'result'; subtype: string; result: string; session_id: string; is_error: boolean; errors?: string[]; usage?: { input_tokens: number; output_tokens: number } }
type ClaudeChunk = SystemInitChunk | StreamEventChunk | AssistantChunk | UserChunk | ResultChunk

export type ClaudeError = {
  message: string
  code: 'session_expired' | 'context_limit' | 'process_error'
  detail?: string
}

export type SpawnOptions = {
  message: string
  claudeSessionId: string | null
  systemPrompt?: string | null
  model?: string | null
  cwd: string
  /** Called for every SSE event (event name, data payload). Fan-out handled by caller. */
  onEvent: (event: string, data: unknown) => void
  /** Called once when the process terminates and all events have been emitted. */
  onEnd: () => void
  onSessionId: (id: string) => void
  onError?: (err: ClaudeError) => void
  signal?: AbortSignal
}

const CLAUDE_BIN = process.env.CLAUDE_PATH ?? `${process.env.HOME ?? '/usr/local'}/.local/bin/claude`

export function spawnClaude({ message, claudeSessionId, systemPrompt, model, cwd, onEvent, onEnd, onSessionId, onError, signal }: SpawnOptions): void {
  const args = [
    '--print', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', 'acceptEdits',
  ]

  if (claudeSessionId) args.push('--resume', claudeSessionId)
  if (systemPrompt) args.push('--system-prompt', systemPrompt)
  if (model) args.push('--model', model)

  // Strip CLAUDE* env vars to prevent sub-agent IPC hang
  const cleanEnv: NodeJS.ProcessEnv = {}
  for (const [key, val] of Object.entries(process.env)) {
    if (!key.startsWith('CLAUDE')) cleanEnv[key] = val
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    cleanEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL
  }

  const child = spawn(CLAUDE_BIN, args, {
    env: { ...cleanEnv, CI: 'true' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd,
  })

  let intentionalKill = false
  signal?.addEventListener('abort', () => {
    intentionalKill = true
    child.kill('SIGTERM')
  })

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
  let sessionIdEmitted = false
  let stderrOutput = ''

  child.stderr.on('data', (data: Buffer) => {
    stderrOutput += data.toString()
    console.error('[docs-claude stderr]', data.toString())
  })

  rl.on('line', (line) => {
    if (!line.trim()) return

    let chunk: ClaudeChunk
    try { chunk = JSON.parse(line) as ClaudeChunk } catch { return }

    if (chunk.type === 'system' && chunk.subtype === 'init' && !sessionIdEmitted) {
      sessionIdEmitted = true
      onSessionId(chunk.session_id)
    }

    onEvent('chunk', chunk)

    if (chunk.type === 'result') {
      if (chunk.is_error) {
        const errorText = chunk.errors?.join('; ') || chunk.result || `Claude error: ${chunk.subtype}`
        const lower = errorText.toLowerCase()
        const isContextLimit = lower.includes('context') || lower.includes('too long') || lower.includes('token limit')
        const isSessionError = !isContextLimit && (Boolean(claudeSessionId) || lower.includes('session') || lower.includes('conversation'))
        const err: ClaudeError = isContextLimit
          ? { message: 'Context limit reached — your next message will start a fresh conversation.', code: 'context_limit', detail: errorText }
          : isSessionError
          ? { message: 'Session could not be resumed — your next message will start a fresh conversation.', code: 'session_expired', detail: errorText }
          : { message: errorText, code: 'process_error' }
        onError?.(err)
        onEvent('error', err)
      } else {
        onEvent('done', { session_id: chunk.session_id })
      }
      onEnd()
    }
  })

  child.on('error', (err) => {
    const claudeErr: ClaudeError = { message: err.message, code: 'process_error' }
    onError?.(claudeErr)
    onEvent('error', claudeErr)
    onEnd()
  })

  child.on('close', (code) => {
    if (intentionalKill) { onEnd(); return }
    if (code !== 0) {
      const detail = stderrOutput.trim() || undefined
      const claudeErr: ClaudeError = claudeSessionId
        ? { message: 'Session could not be resumed. Your next message will start fresh.', code: 'session_expired', detail }
        : { message: detail ?? `Claude exited with code ${code}`, code: 'process_error', detail }
      onError?.(claudeErr)
      onEvent('error', claudeErr)
    } else {
      onEvent('done', { session_id: '' })
    }
    onEnd()
  })
}
