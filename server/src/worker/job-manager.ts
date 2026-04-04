/**
 * Manages Claude CLI subprocesses. No Express/HTTP dependency — communicates
 * entirely via callbacks. The worker's socket layer wraps these callbacks to
 * relay events back to connected clients over NDJSON.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { extractToolDetail } from '../claude/toolDetail.js'
import { jobQueries } from './db.js'
import type { WorkerEvent } from './protocol.js'

// Allow overriding the claude binary path via env var, with ~/.local/bin fallback
const CLAUDE_BIN = process.env.CLAUDE_PATH ?? `${process.env.HOME ?? '/usr/local'}/.local/bin/claude`

/**
 * Normalize a tool_result content value to a plain string.
 * The Claude API allows content to be either a string or an array of text blocks.
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

// How often to flush accumulated text to worker.db (ms)
const FLUSH_INTERVAL_MS = 3_000

type JobOptions = {
  sessionId: string
  prompt: string
  claudeSessionId: string | null
  projectPath: string
  permissionMode: string | null
  systemPrompt: string | null
  model?: string | null
}

type ActiveJob = {
  abort: AbortController
  flushTimer: ReturnType<typeof setInterval>
}

export class JobManager {
  private jobs = new Map<string, ActiveJob>()

  /** Broadcast callback — set by the socket layer to relay events to all clients */
  onEvent: (event: WorkerEvent) => void = () => {}

  start(opts: JobOptions): void {
    const { sessionId, prompt, claudeSessionId, projectPath, permissionMode, systemPrompt, model } = opts

    if (this.jobs.has(sessionId)) {
      console.warn(`[worker] job already running for session ${sessionId}, ignoring start`)
      return
    }

    jobQueries.insert(sessionId)

    const abort = new AbortController()
    let accumulatedText = ''
    let stderrOutput = ''
    let sessionIdEmitted = false
    let resolved = false // prevent double done/error
    const toolCallsMap = new Map<string, { id: string; name: string; detail?: string; output?: string; isError?: boolean }>()

    const flush = () => jobQueries.updateContent(sessionId, accumulatedText)

    const flushTimer = setInterval(flush, FLUSH_INTERVAL_MS)

    const finish = (status: 'complete' | 'interrupted', errorCode: string | null = null) => {
      if (resolved) return
      resolved = true
      clearInterval(flushTimer)
      const toolCallsJson = toolCallsMap.size > 0 ? JSON.stringify([...toolCallsMap.values()]) : null
      jobQueries.updateStatus(sessionId, status, errorCode, accumulatedText, toolCallsJson)
      this.jobs.delete(sessionId)
    }

    this.jobs.set(sessionId, { abort, flushTimer })

    const args = [
      '--print', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]

    if (claudeSessionId) args.push('--resume', claudeSessionId)
    if (systemPrompt) args.push('--system-prompt', systemPrompt)
    if (permissionMode && permissionMode !== 'default') {
      args.push('--permission-mode', permissionMode)
    }
    if (model) args.push('--model', model)

    // Strip all Claude Code session vars to prevent sub-agent IPC hang
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
      cwd: projectPath,
    })

    let intentionalKill = false
    abort.signal.addEventListener('abort', () => {
      intentionalKill = true
      child.kill('SIGTERM')
    })

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderrOutput += text
      console.error('[worker stderr]', text.trim())
    })

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })

    rl.on('line', (line) => {
      if (!line.trim()) return

      let chunk: Record<string, unknown>
      try {
        chunk = JSON.parse(line)
      } catch {
        return
      }

      // Emit raw chunk so HTTP server can relay to SSE client
      this.onEvent({ type: 'chunk', sessionId, chunk })

      // Resolve Claude session ID from system init
      if (chunk.type === 'system' && chunk.subtype === 'init' && !sessionIdEmitted) {
        sessionIdEmitted = true
        this.onEvent({ type: 'session_id', sessionId, claudeSessionId: chunk.session_id as string })
      }

      // Accumulate text deltas
      if (
        chunk.type === 'stream_event' &&
        (chunk.event as Record<string, unknown>)?.type === 'content_block_delta' &&
        ((chunk.event as Record<string, unknown>)?.delta as Record<string, unknown>)?.type === 'text_delta'
      ) {
        accumulatedText += (((chunk.event as Record<string, unknown>)?.delta as Record<string, unknown>)?.text as string) ?? ''
      }

      // Assembled tool_use blocks (same shape as chat route / recovery)
      if (chunk.type === 'assistant') {
        const content = (chunk.message as Record<string, unknown>)?.content as Array<Record<string, unknown>> ?? []
        for (const block of content) {
          if (block.type === 'tool_use' && block.name && block.id) {
            toolCallsMap.set(block.id as string, {
              id: block.id as string,
              name: block.name as string,
              detail: extractToolDetail(block.name as string, (block.input as Record<string, unknown>) ?? {}),
            })
          }
        }
      }

      // Tool results
      if (chunk.type === 'user') {
        const content = (chunk.message as Record<string, unknown>)?.content as Array<Record<string, unknown>> ?? []
        for (const block of content) {
          if (block.type === 'tool_result') {
            const tid = block.tool_use_id as string
            const existing = toolCallsMap.get(tid)
            if (existing) {
              existing.output = normalizeToolResultContent(block.content)
              existing.isError = (block.is_error as boolean) ?? false
            }
            this.onEvent({
              type: 'tool_result',
              sessionId,
              toolUseId: tid,
              output: normalizeToolResultContent(block.content),
              isError: block.is_error as boolean,
            })
          }
        }
      }

      // Result chunk — job complete or errored
      if (chunk.type === 'result') {
        if (chunk.is_error) {
          const errorText = (chunk.errors as string[] | undefined)?.join('; ') || (chunk.result as string) || `Claude error: ${chunk.subtype}`
          const lower = errorText.toLowerCase()
          const errorCode = lower.includes('context') || lower.includes('too long') || lower.includes('token limit')
            ? 'context_limit'
            : Boolean(claudeSessionId) || lower.includes('session') || lower.includes('conversation')
            ? 'session_expired'
            : 'process_error'
          finish('interrupted', errorCode)
          this.onEvent({ type: 'error', sessionId, errorCode, message: errorText, content: accumulatedText })
        } else {
          finish('complete')
          this.onEvent({ type: 'done', sessionId, content: accumulatedText, claudeSessionId: chunk.session_id as string })
        }
      }
    })

    child.on('error', (err) => {
      finish('interrupted', 'process_error')
      this.onEvent({ type: 'error', sessionId, errorCode: 'process_error', message: err.message, content: accumulatedText })
    })

    child.on('close', (code) => {
      if (intentionalKill) {
        finish('interrupted', null)
        // Signal clients that the job ended so they can close their stream
        this.onEvent({ type: 'done', sessionId, content: accumulatedText, claudeSessionId: '' })
        return
      }
      if (code !== 0 && !resolved) {
        const detail = stderrOutput.trim() || `Claude exited with code ${code}`
        const errorCode = Boolean(claudeSessionId) ? 'session_expired' : 'process_error'
        finish('interrupted', errorCode)
        this.onEvent({ type: 'error', sessionId, errorCode, message: detail, content: accumulatedText })
        return
      }
      // Code 0 but result chunk already handled — ensure job is cleaned up
      if (!resolved) {
        finish('complete')
        this.onEvent({ type: 'done', sessionId, content: accumulatedText, claudeSessionId: '' })
      }
    })
  }

  stop(sessionId: string): void {
    const job = this.jobs.get(sessionId)
    if (job) {
      job.abort.abort()
    }
  }

  status(sessionId: string): 'running' | 'idle' {
    return this.jobs.has(sessionId) ? 'running' : 'idle'
  }

  /** Returns partial content from DB for a session that may be running */
  partialContent(sessionId: string): string {
    return jobQueries.find(sessionId)?.content ?? ''
  }
}
