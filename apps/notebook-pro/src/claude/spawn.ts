/**
 * Thin wrapper around the Claude CLI for the notebook app.
 * Adapted from server/src/claude/process.ts — same patterns, trimmed down.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Response } from 'express'

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
  cwd: string
  res: Response
  onSessionId: (id: string) => void
  onChunk?: (chunk: Record<string, unknown>) => void
  onComplete?: () => void
  onError?: (err: ClaudeError) => void
  signal?: AbortSignal
  /** Path to an MCP config JSON file for --mcp-config (tool calling). */
  mcpConfigPath?: string
  /** Claude model to use, e.g. 'claude-sonnet-4-5'. Omit to use CLI default. */
  model?: string | null
}

function sendSse(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const CLAUDE_BIN = process.env.CLAUDE_PATH ?? `${process.env.HOME ?? '/usr/local'}/.local/bin/claude`

export function spawnClaude({ message, claudeSessionId, systemPrompt, cwd, res, onSessionId, onChunk, onComplete, onError, signal, mcpConfigPath, model }: SpawnOptions): void {
  const args = [
    '--print', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', 'acceptEdits',
  ]

  if (model) args.push('--model', model)
  if (claudeSessionId) args.push('--resume', claudeSessionId)
  if (systemPrompt) args.push('--system-prompt', systemPrompt)
  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath)
    // Allow all notebook-pro MCP tools without interactive permission prompts
    args.push('--allowedTools', 'mcp__notebook-pro__run_cell,mcp__notebook-pro__create_cell,mcp__notebook-pro__list_cells,mcp__notebook-pro__delete_cell,mcp__notebook-pro__edit_cell')
  }

  // Strip CLAUDE* env vars to prevent sub-agent IPC hang
  const cleanEnv: NodeJS.ProcessEnv = {}
  for (const [key, val] of Object.entries(process.env)) {
    if (!key.startsWith('CLAUDE') && key !== 'ANTHROPIC_BASE_URL') {
      cleanEnv[key] = val
    }
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
    console.error('[notebook-claude stderr]', data.toString())
  })

  rl.on('line', (line) => {
    if (!line.trim()) return

    let chunk: ClaudeChunk
    try { chunk = JSON.parse(line) as ClaudeChunk } catch { return }

    if (chunk.type === 'system' && chunk.subtype === 'init' && !sessionIdEmitted) {
      sessionIdEmitted = true
      onSessionId(chunk.session_id)
    }

    onChunk?.(chunk as Record<string, unknown>)
    sendSse(res, 'chunk', chunk)

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
        sendSse(res, 'error', err)
      } else {
        onComplete?.()
        sendSse(res, 'done', { session_id: chunk.session_id })
      }
      if (!res.writableEnded) res.end()
    }
  })

  child.on('error', (err) => {
    const claudeErr: ClaudeError = { message: err.message, code: 'process_error' }
    onError?.(claudeErr)
    sendSse(res, 'error', claudeErr)
    if (!res.writableEnded) res.end()
  })

  child.on('close', (code) => {
    if (intentionalKill) { if (!res.writableEnded) res.end(); return }
    if (code !== 0 && !res.writableEnded) {
      const detail = stderrOutput.trim() || undefined
      const claudeErr: ClaudeError = claudeSessionId
        ? { message: 'Session could not be resumed. Your next message will start fresh.', code: 'session_expired', detail }
        : { message: detail ?? `Claude exited with code ${code}`, code: 'process_error', detail }
      onError?.(claudeErr)
      sendSse(res, 'error', claudeErr)
    }
    if (!res.writableEnded) { sendSse(res, 'done', { session_id: '' }); res.end() }
  })
}

/**
 * Run a one-shot Claude prompt (non-streaming) and return the text result.
 * Used for compaction summarization.
 */
export function runClaudePrompt(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanEnv: NodeJS.ProcessEnv = {}
    for (const [key, val] of Object.entries(process.env)) {
      if (!key.startsWith('CLAUDE') && key !== 'ANTHROPIC_BASE_URL') cleanEnv[key] = val
    }
    if (process.env.ANTHROPIC_BASE_URL) cleanEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL

    const child = spawn(CLAUDE_BIN, [
      '--print', prompt,
      '--output-format', 'json',
      '--permission-mode', 'acceptEdits',
    ], { env: { ...cleanEnv, CI: 'true' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(stderr.trim() || `Claude exited ${code}`)); return }
      try {
        const parsed = JSON.parse(stdout.trim()) as { result?: string }
        resolve(parsed.result ?? stdout.trim())
      } catch {
        resolve(stdout.trim())
      }
    })
    child.on('error', reject)
  })
}
