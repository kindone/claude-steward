import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { getAdapter, defaultUserMessageForErrorCode, type CliName, type LaunchOptions, type CanonicalEvent } from './index.js'

export type SpawnOptions = {
  cli: CliName
  prompt: string
  resumeId: string | null
  systemPrompt: string | null
  model: string | null
  cwd: string
  onEvent: (event: string, data: unknown) => void
  onEnd: () => void
  onSessionId: (id: string) => void
  onError?: (err: { message: string; code: string; detail?: string }) => void
  signal?: AbortSignal
}

export function spawnCliJob(opts: SpawnOptions): void {
  const adapter = getAdapter(opts.cli)
  const launchOpts: LaunchOptions = {
    prompt: opts.prompt,
    resumeId: opts.resumeId,
    systemPrompt: opts.systemPrompt,
    model: opts.model,
    workingDirectory: opts.cwd,
  }

  const args = adapter.buildArgs(launchOpts)
  const env = adapter.buildEnv(process.env)
  const parser = adapter.createParser(launchOpts)

  const child = spawn(adapter.binaryPath(), args, {
    env: { ...env, CI: 'true' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: opts.cwd,
  })

  let intentionalKill = false
  let ended = false
  const endOnce = (): void => {
    if (ended) return
    ended = true
    opts.onEnd()
  }
  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity })
  let stderrOutput = ''

  opts.signal?.addEventListener('abort', () => {
    intentionalKill = true
    child.kill('SIGTERM')
  })

  child.stderr.on('data', (data: Buffer) => {
    stderrOutput += data.toString()
    console.error('[docs-cli stderr]', data.toString())
  })

  stdout.on('line', (line) => {
    const { events } = parser.parseLine(line)
    // Emit only adapter-normalized events. Claude already speaks a similar
    // stream-json shape, but forwarding raw chunks plus normalized chunks makes
    // the browser process some deltas twice.
    for (const evt of events) handleCanonicalEvent(evt, opts, endOnce)
  })

  child.on('error', (err) => {
    const detail = err.message
    const code = adapter.classifyError(detail, Boolean(opts.resumeId))
    const message = defaultUserMessageForErrorCode(code, detail)
    opts.onError?.({ message, code, detail })
    opts.onEvent('error', { message, code, detail })
    endOnce()
  })

  child.on('close', (code) => {
    if (intentionalKill) { endOnce(); return }
    if (code !== 0) {
      const detail = stderrOutput.trim() || `CLI exited with code ${code}`
      const errCode = adapter.classifyError(detail, Boolean(opts.resumeId))
      const message = defaultUserMessageForErrorCode(errCode, detail)
      opts.onError?.({ message, code: errCode, detail })
      opts.onEvent('error', { message, code: errCode, detail })
    } else if (!ended) {
      opts.onEvent('done', { session_id: '' })
    }
    endOnce()
  })
}

function handleCanonicalEvent(evt: CanonicalEvent, opts: SpawnOptions, end: () => void): void {
  switch (evt.type) {
    case 'session_id':
      if (evt.externalId) opts.onSessionId(evt.externalId)
      break
    case 'text_block_start':
      // legacy clients don't care about block start — ignore
      break
    case 'text_delta':
      opts.onEvent('chunk', {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: evt.text } },
      })
      break
    case 'tool_use':
      opts.onEvent('chunk', {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: evt.id, name: evt.name, input: evt.input }],
        },
      })
      break
    case 'tool_result':
      opts.onEvent('chunk', {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: evt.toolUseId, content: evt.output, is_error: evt.isError }],
        },
      })
      break
    case 'result_done':
      opts.onEvent('done', { session_id: evt.externalId })
      end()
      break
    case 'result_error':
      opts.onError?.({ message: evt.message, code: evt.code, detail: evt.errorText })
      opts.onEvent('error', { message: evt.message, code: evt.code, detail: evt.errorText })
      end()
      break
  }
}
