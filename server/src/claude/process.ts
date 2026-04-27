import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Response } from 'express'
import { getAdapter } from '../cli/index.js'
import type { ErrorCode } from '../cli/types.js'
import { defaultUserMessageForErrorCode } from '../cli/types.js'

export type ClaudeError = {
  message: string
  /** session_expired | context_limit | provider_quota | process_error */
  code: ErrorCode
  detail?: string
}

export type SpawnOptions = {
  message: string
  claudeSessionId: string | null
  systemPrompt?: string | null
  permissionMode?: string | null
  model?: string | null
  /** Adapter for this turn. Optional for back-compat; absent → STEWARD_CLI
   *  env default. New call sites should pass session.cli. */
  cli?: 'claude' | 'opencode' | null
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

export function spawnClaude({ message, claudeSessionId, systemPrompt, permissionMode, model, cli, res, onSessionId, onComplete, onError, onToolResult, signal, cwd }: SpawnOptions): void {
  // All Claude-specific knowledge — binary path, args, env policy, parsing,
  // and error classification — lives behind the CliAdapter interface. This
  // function now owns only the spawn lifecycle (process, readline, abort,
  // close handlers) and the SSE response shape.
  const adapter = getAdapter(cli ?? undefined)
  const launchOpts = {
    prompt: message,
    resumeId: claudeSessionId,
    systemPrompt: systemPrompt ?? null,
    permissionMode: permissionMode ?? null,
    model: model ?? null,
    mcpConfigPath: process.env.MCP_CONFIG_PATH ?? null,
    workingDirectory: cwd ?? null,
  }
  const args = adapter.buildArgs(launchOpts)
  const cleanEnv = adapter.buildEnv(process.env)
  const parser = adapter.createParser(launchOpts)

  const child = spawn(adapter.binaryPath(), args, {
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
  let accumulatedText = ''
  let stderrOutput = ''

  child.stderr.on('data', (data: Buffer) => {
    const text = data.toString()
    stderrOutput += text
    console.error('[claude stderr]', text)
  })

  rl.on('line', (line) => {
    const { rawChunk, events } = parser.parseLine(line)
    if (rawChunk === null) return

    for (const ev of events) {
      switch (ev.type) {
        case 'session_id':
          onSessionId(ev.externalId)
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
        case 'tool_result':
          onToolResult?.(ev.toolUseId, ev.output, ev.isError)
          break
        // tool_use is a no-op for the SSE path (consumer doesn't track tool calls
        // here — the worker path does).
        case 'tool_use':
          break
        case 'result_done':
          break
        case 'result_error':
          break
      }
    }

    sendSseEvent(res, 'chunk', rawChunk)

    // Terminal events fire after the SSE relay so the client sees the raw
    // result chunk before the synthesized done/error.
    for (const ev of events) {
      if (ev.type === 'result_error') {
        const claudeErr: ClaudeError = { message: ev.message, code: ev.code, detail: ev.detail }
        onError?.(claudeErr)
        sendSseEvent(res, 'error', claudeErr)
        if (!res.writableEnded) res.end()
        return
      }
      if (ev.type === 'result_done') {
        onComplete?.(accumulatedText)
        sendSseEvent(res, 'done', { session_id: ev.externalId })
        if (!res.writableEnded) res.end()
      }
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
      const errCode = adapter.classifyError(detail ?? '', Boolean(claudeSessionId))
      const message = defaultUserMessageForErrorCode(errCode, detail ?? `Claude exited with code ${code}`)
      const claudeErr: ClaudeError = { message, code: errCode, detail }
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
 *
 * Args differ from the streaming path: prompt is passed via stdin (avoids
 * E2BIG when transcripts are large) and permission-mode is hardcoded to
 * `plan`. Output parsing is delegated to the adapter parser so a future
 * opencode-shaped one-shot path slots in cleanly.
 */
export function runClaudePrompt(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const adapter = getAdapter()
    const launchOpts = {
      prompt: '', // unused — prompt goes via stdin
      resumeId: null,
      systemPrompt: null,
      permissionMode: 'plan',
      model: null,
      mcpConfigPath: null,
    }

    // One-shot args — distinct from buildArgs(launchOpts) because we don't pass
    // --print (prompt via stdin) and intentionally skip MCP / system-prompt /
    // resume. The parser, env, and binary still flow through the adapter.
    const args = [
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', 'plan',
    ]

    const cleanEnv = adapter.buildEnv(process.env)
    const parser = adapter.createParser(launchOpts)

    const child = spawn(adapter.binaryPath(), args, {
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
      if (settled) return
      const { rawChunk, events } = parser.parseLine(line)
      if (rawChunk === null) return
      for (const ev of events) {
        if (ev.type === 'text_delta') {
          accumulated += ev.text
        } else if (ev.type === 'result_done') {
          settled = true
          // Preserve legacy fallback: if no text deltas were observed, fall back
          // to the result chunk's `.result` field. Pulled from rawChunk since
          // the canonical event doesn't carry it.
          const fallback = (rawChunk as { result?: string })?.result ?? ''
          resolve(accumulated || fallback)
        } else if (ev.type === 'result_error') {
          settled = true
          reject(new Error(ev.errorText))
        }
      }
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
