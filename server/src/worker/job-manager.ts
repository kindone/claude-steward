/**
 * Manages CLI subprocesses (Claude / opencode / …) for long-running jobs.
 *
 * No Express/HTTP dependency — communicates entirely via callbacks. The
 * worker's socket layer wraps these callbacks to relay events back to
 * connected clients over NDJSON.
 *
 * CLI-specific knowledge (binary path, args, env, parsing, error
 * classification) lives behind {@link CliAdapter} (see `../cli/`). This
 * file owns the spawn lifecycle, DB persistence, and event broadcasting.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { extractToolDetail } from '../claude/toolDetail.js'
import { getAdapter } from '../cli/index.js'
import { defaultUserMessageForErrorCode } from '../cli/types.js'
import { jobQueries } from './db.js'
import type { WorkerEvent } from './protocol.js'

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
  /** Adapter name for this turn. Optional for back-compat with workers
   *  spawned before the per-session adapter landed; absent → falls back
   *  to STEWARD_CLI env via getAdapter()'s own default. New code paths
   *  should always set this from session.cli. */
  cli?: 'claude' | 'opencode' | null
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
    const { sessionId, prompt, claudeSessionId, projectPath, permissionMode, systemPrompt, model, cli } = opts

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

    // Prefer the session's adapter (passed in); fall back to env-default.
    const adapter = getAdapter(cli ?? undefined)
    const launchOpts = {
      prompt,
      resumeId: claudeSessionId,
      systemPrompt,
      permissionMode,
      model: model ?? null,
      mcpConfigPath: process.env.MCP_CONFIG_PATH ?? null,
      workingDirectory: projectPath,
    }
    const args = adapter.buildArgs(launchOpts)
    const cleanEnv = adapter.buildEnv(process.env)
    const parser = adapter.createParser(launchOpts)

    const child = spawn(adapter.binaryPath(), args, {
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
      const { rawChunk, events } = parser.parseLine(line)
      if (rawChunk === null) return

      // Emit raw chunk so HTTP server can relay to SSE client.
      this.onEvent({ type: 'chunk', sessionId, chunk: rawChunk as Record<string, unknown> })

      for (const ev of events) {
        switch (ev.type) {
          case 'session_id':
            if (!sessionIdEmitted) {
              sessionIdEmitted = true
              this.onEvent({ type: 'session_id', sessionId, claudeSessionId: ev.externalId })
            }
            break

          case 'text_block_start':
            // New text block starting after a tool use — inject paragraph break.
            if (accumulatedText.length > 0 && !accumulatedText.endsWith('\n')) {
              accumulatedText += '\n\n'
            }
            break

          case 'text_delta':
            accumulatedText += ev.text
            break

          case 'tool_use':
            toolCallsMap.set(ev.id, {
              id: ev.id,
              name: ev.name,
              detail: extractToolDetail(ev.name, ev.input),
            })
            break

          case 'tool_result': {
            const existing = toolCallsMap.get(ev.toolUseId)
            if (existing) {
              existing.output = ev.output
              existing.isError = ev.isError
            }
            this.onEvent({
              type: 'tool_result',
              sessionId,
              toolUseId: ev.toolUseId,
              output: ev.output,
              isError: ev.isError,
            })
            break
          }

          case 'result_done':
            finish('complete')
            this.onEvent({ type: 'done', sessionId, content: accumulatedText, claudeSessionId: ev.externalId })
            break

          case 'result_error':
            finish('interrupted', ev.code)
            this.onEvent({ type: 'error', sessionId, errorCode: ev.code, message: ev.message, content: accumulatedText })
            break
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
        const errorCode = adapter.classifyError(detail, Boolean(claudeSessionId))
        finish('interrupted', errorCode)
        this.onEvent({
          type: 'error',
          sessionId,
          errorCode,
          message: defaultUserMessageForErrorCode(errorCode, detail),
          content: accumulatedText,
        })
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

  /** Number of in-flight jobs. Used by the worker shutdown path to drain
   *  before exiting. Pure read, no side effects. */
  activeCount(): number {
    return this.jobs.size
  }
}
