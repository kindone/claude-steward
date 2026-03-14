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
    delta?: { type: string; text: string }
  }
}

type AssistantChunk = {
  type: 'assistant'
  message: { content: Array<{ type: string; text: string }> }
}

type ResultChunk = {
  type: 'result'
  subtype: string
  result: string
  session_id: string
  is_error: boolean
}

type ClaudeChunk = SystemInitChunk | StreamEventChunk | AssistantChunk | ResultChunk

export type ClaudeError = {
  message: string
  /** 'session_expired' when a --resume attempt failed; 'process_error' for other failures */
  code: 'session_expired' | 'process_error'
  detail?: string
}

export type SpawnOptions = {
  message: string
  claudeSessionId: string | null
  res: Response
  onSessionId: (id: string) => void
  onComplete?: (text: string) => void
  onError?: (err: ClaudeError) => void
  signal?: AbortSignal
  cwd?: string
}

function sendSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// Allow overriding the claude binary path via env var, with ~/.local/bin fallback
const CLAUDE_BIN = process.env.CLAUDE_PATH ?? `${process.env.HOME ?? '/usr/local'}/.local/bin/claude`

export function spawnClaude({ message, claudeSessionId, res, onSessionId, onComplete, onError, signal, cwd }: SpawnOptions): void {
  const args = [
    '--print', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]

  if (claudeSessionId) {
    args.push('--resume', claudeSessionId)
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

  signal?.addEventListener('abort', () => {
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

    if (
      chunk.type === 'stream_event' &&
      chunk.event.type === 'content_block_delta' &&
      chunk.event.delta?.type === 'text_delta'
    ) {
      accumulatedText += chunk.event.delta.text
    }

    sendSseEvent(res, 'chunk', chunk)

    if (chunk.type === 'result') {
      onComplete?.(accumulatedText)
      sendSseEvent(res, 'done', { session_id: chunk.session_id })
      res.end()
    }
  })

  child.on('error', (err) => {
    const claudeErr: ClaudeError = { message: err.message, code: 'process_error' }
    onError?.(claudeErr)
    sendSseEvent(res, 'error', claudeErr)
    res.end()
  })

  child.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) {
      const isResumeAttempt = Boolean(claudeSessionId)
      const detail = stderrOutput.trim() || undefined
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
      res.end()
    }
  })
}
