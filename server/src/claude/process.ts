import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Response } from 'express'

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
  message: { content: Array<{ type: string; id?: string; name?: string; text?: string; input?: Record<string, unknown> }> }
}

type UserChunk = {
  type: 'user'
  message: {
    role: 'user'
    content: Array<{
      type: 'tool_result'
      tool_use_id: string
      content: string
      is_error: boolean
    }>
  }
  tool_use_result?: {
    stdout: string
    stderr: string
    interrupted: boolean
    isImage: boolean
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

type ClaudeChunk = SystemInitChunk | StreamEventChunk | AssistantChunk | UserChunk | ResultChunk

export type ClaudeError = {
  message: string
  /** 'session_expired' when a --resume attempt failed; 'context_limit' when context window exceeded; 'process_error' for other failures */
  code: 'session_expired' | 'context_limit' | 'process_error'
  detail?: string
}

export type SpawnOptions = {
  message: string
  claudeSessionId: string | null
  systemPrompt?: string | null
  permissionMode?: string | null
  model?: string | null
  res: Response
  onSessionId: (id: string) => void
  onComplete?: (text: string) => void
  onError?: (err: ClaudeError) => void
  onToolResult?: (toolUseId: string, output: string, isError: boolean) => void
  signal?: AbortSignal
  cwd?: string
}

function sendSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// Allow overriding the claude binary path via env var, with ~/.local/bin fallback
const CLAUDE_BIN = process.env.CLAUDE_PATH ?? `${process.env.HOME ?? '/usr/local'}/.local/bin/claude`

export function spawnClaude({ message, claudeSessionId, systemPrompt, permissionMode, model, res, onSessionId, onComplete, onError, onToolResult, signal, cwd }: SpawnOptions): void {
  const args = [
    '--print', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]

  if (claudeSessionId) {
    args.push('--resume', claudeSessionId)
  }

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt)
  }

  // 'default' means interactive prompts — unusable in our non-interactive spawn;
  // skip the flag entirely and let Claude use its own default (which may stall).
  // All other modes are passed explicitly.
  if (permissionMode && permissionMode !== 'default') {
    args.push('--permission-mode', permissionMode)
  }

  if (model) {
    args.push('--model', model)
  }

  // MCP schedule tools — same as the worker path.
  if (process.env.MCP_CONFIG_PATH) {
    args.push('--mcp-config', process.env.MCP_CONFIG_PATH)
    args.push('--disallowed-tools', 'CronCreate,CronDelete')
  }

  // Strip all Claude Code session vars. Inheriting CLAUDECODE=1 makes claude
  // think it's a sub-agent and wait for IPC from the parent session, hanging forever.
  // The spawned process will auth via ~/.claude/ stored credentials instead.
  const cleanEnv: NodeJS.ProcessEnv = {}
  for (const [key, val] of Object.entries(process.env)) {
    if (!key.startsWith('CLAUDE') && key !== 'ANTHROPIC_BASE_URL') {
      cleanEnv[key] = val
    }
  }
  // Keep the base URL so requests go to the right endpoint
  if (process.env.ANTHROPIC_BASE_URL) {
    cleanEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL
  }

  const child = spawn(CLAUDE_BIN, args, {
    // CI=true suppresses TTY detection so claude writes to pipes correctly.
    // stdin: 'ignore' prevents blocking if claude tries to read from stdin.
    env: { ...cleanEnv, CI: 'true' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
  })

  let intentionalKill = false
  signal?.addEventListener('abort', () => {
    intentionalKill = true
    child.kill('SIGTERM')
  })

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
  let sessionIdEmitted = false
  let accumulatedText = ''
  let stderrOutput = ''

  child.stderr.on('data', (data: Buffer) => {
    const text = data.toString()
    stderrOutput += text
    console.error('[claude stderr]', text)
  })

  rl.on('line', (line) => {
    if (!line.trim()) return

    let chunk: ClaudeChunk
    try {
      chunk = JSON.parse(line) as ClaudeChunk
    } catch {
      return
    }

    if (chunk.type === 'system' && chunk.subtype === 'init' && !sessionIdEmitted) {
      sessionIdEmitted = true
      onSessionId(chunk.session_id)
    }

    // New text block starting after a tool use — inject paragraph break
    if (
      chunk.type === 'stream_event' &&
      chunk.event.type === 'content_block_start' &&
      chunk.event.content_block?.type === 'text' &&
      accumulatedText.length > 0 &&
      !accumulatedText.endsWith('\n')
    ) {
      accumulatedText += '\n\n'
    }

    if (
      chunk.type === 'stream_event' &&
      chunk.event.type === 'content_block_delta' &&
      chunk.event.delta?.type === 'text_delta'
    ) {
      accumulatedText += chunk.event.delta.text
    }

    if (chunk.type === 'user') {
      for (const block of chunk.message?.content ?? []) {
        if (block.type === 'tool_result') {
          onToolResult?.(block.tool_use_id, block.content, block.is_error)
        }
      }
    }

    sendSseEvent(res, 'chunk', chunk)

    if (chunk.type === 'result') {
      if (chunk.is_error) {
        // Claude exited cleanly (code 0) but reported a logical error in the result.
        // "No conversation found with session ID" is the canonical resume-failure message.
        const errorText = chunk.errors?.join('; ') || chunk.result || `Claude error: ${chunk.subtype}`
        const lowerError = errorText.toLowerCase()
        const isContextLimit =
          lowerError.includes('context') ||
          lowerError.includes('too long') ||
          lowerError.includes('too many tokens') ||
          lowerError.includes('maximum') ||
          lowerError.includes('token limit')
        const isOverload =
          lowerError.includes('overload') ||
          lowerError.includes('529')
        const isSessionError = !isContextLimit && !isOverload && (
          Boolean(claudeSessionId) ||
          lowerError.includes('session') ||
          lowerError.includes('conversation')
        )
        const claudeErr: ClaudeError = isContextLimit
          ? {
              message: 'Context limit reached — your next message will start a fresh conversation.',
              code: 'context_limit',
              detail: errorText,
            }
          : isSessionError
          ? {
              message: 'The previous session could not be resumed — your next message will start a fresh conversation.',
              code: 'session_expired',
              detail: errorText,
            }
          : {
              message: errorText,
              code: 'process_error',
            }
        onError?.(claudeErr)
        sendSseEvent(res, 'error', claudeErr)
        if (!res.writableEnded) res.end()
        return
      }
      onComplete?.(accumulatedText)
      sendSseEvent(res, 'done', { session_id: chunk.session_id })
      if (!res.writableEnded) res.end()
    }
  })

  child.on('error', (err) => {
    const claudeErr: ClaudeError = { message: err.message, code: 'process_error' }
    onError?.(claudeErr)
    sendSseEvent(res, 'error', claudeErr)
    if (!res.writableEnded) res.end()
  })

  child.on('close', (code: number | null) => {
    if (intentionalKill) {
      // User-initiated stop — close the response cleanly without error or DB persistence.
      if (!res.writableEnded) res.end()
      return
    }
    if (code !== 0 && !res.writableEnded) {
      const detail = stderrOutput.trim() || undefined
      const lowerDetail = (detail ?? '').toLowerCase()
      const isOverload = lowerDetail.includes('overload') || lowerDetail.includes('529')
      const isResumeAttempt = !isOverload && Boolean(claudeSessionId)
      const claudeErr: ClaudeError = isResumeAttempt
        ? {
            message: 'The previous Claude session could not be resumed. Your next message will start a fresh conversation.',
            code: 'session_expired',
            detail,
          }
        : {
            message: detail ?? `Claude exited with code ${code}`,
            code: 'process_error',
            detail,
          }
      onError?.(claudeErr)
      sendSseEvent(res, 'error', claudeErr)
      if (!res.writableEnded) res.end()
      return
    }
    // Code 0: ensure response always ends so the client stream completes (and can run onDone fallback).
    // The normal path sends "event: done" + res.end() from the result chunk; this handles races where
    // the process exits before the last line is processed.
    if (!res.writableEnded) {
      sendSseEvent(res, 'done', { session_id: '' })
      res.end()
    }
  })
}

/**
 * Run a one-shot Claude prompt and return the text response.
 * No SSE streaming — resolves when Claude finishes, rejects on error.
 * Used for compact summarization where we don't need a live stream.
 */
export function runClaudePrompt(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Pass prompt via stdin to avoid E2BIG when the transcript is large.
    // With CI=true and stdin piped, Claude auto-detects non-interactive mode.
    const args = [
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', 'plan',
    ]

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
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    child.stdin.write(prompt)
    child.stdin.end()

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    let accumulated = ''
    let stderr = ''
    let settled = false

    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    rl.on('line', (line) => {
      if (!line.trim() || settled) return
      try {
        const chunk = JSON.parse(line) as ClaudeChunk
        if (
          chunk.type === 'stream_event' &&
          chunk.event.type === 'content_block_delta' &&
          chunk.event.delta?.type === 'text_delta'
        ) {
          accumulated += chunk.event.delta.text
        }
        if (chunk.type === 'result') {
          settled = true
          if (chunk.is_error) {
            reject(new Error(chunk.errors?.join('; ') || chunk.result || 'Claude error'))
          } else {
            resolve(accumulated || chunk.result)
          }
        }
      } catch { /* ignore malformed lines */ }
    })

    child.on('error', (err) => { if (!settled) { settled = true; reject(err) } })
    child.on('close', (code: number | null) => {
      if (settled) return
      settled = true
      if (code !== 0) reject(new Error(stderr.trim() || `Claude exited with code ${code}`))
      else resolve(accumulated)
    })
  })
}
