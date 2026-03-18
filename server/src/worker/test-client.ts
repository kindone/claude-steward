/**
 * Manual test client for the Claude worker.
 * Connects to the worker socket, sends a start command, and streams the response.
 *
 * Usage:
 *   tsx server/src/worker/test-client.ts "your prompt here"
 *   tsx server/src/worker/test-client.ts  # defaults to a simple hello prompt
 *
 * The session ID is printed at startup so you can delete the test session afterwards.
 */

import net from 'node:net'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { SOCKET_PATH } from './protocol.js'
import type { WorkerEvent } from './protocol.js'

const prompt = process.argv[2] ?? 'say hello in exactly one sentence'
const sessionId = `test-${randomUUID()}`

console.log(`[test-client] connecting to ${SOCKET_PATH}`)
console.log(`[test-client] session ID: ${sessionId}  (delete this session after testing)`)
console.log(`[test-client] prompt: ${prompt}`)
console.log('─'.repeat(60))

const socket = net.connect(SOCKET_PATH, () => {
  const cmd = {
    type: 'start',
    sessionId,
    prompt,
    claudeSessionId: null,
    projectPath: process.cwd(),
    permissionMode: 'default',
    systemPrompt: null,
  }
  socket.write(JSON.stringify(cmd) + '\n')
})

socket.on('error', (err) => {
  console.error('[test-client] connection error:', err.message)
  console.error('Is the worker running? Start it with: tsx server/src/worker/main.ts')
  process.exit(1)
})

const rl = createInterface({ input: socket, crlfDelay: Infinity })

rl.on('line', (line) => {
  if (!line.trim()) return

  let event: WorkerEvent
  try {
    event = JSON.parse(line) as WorkerEvent
  } catch {
    console.warn('[test-client] malformed event:', line)
    return
  }

  // Filter to only our session
  if (event.sessionId !== sessionId) return

  switch (event.type) {
    case 'session_id':
      console.log(`\n[session] Claude session ID: ${event.claudeSessionId}`)
      break

    case 'chunk': {
      // Print text deltas inline
      const chunk = event.chunk as Record<string, unknown>
      if (
        chunk.type === 'stream_event' &&
        (chunk.event as Record<string, unknown>)?.type === 'content_block_delta' &&
        ((chunk.event as Record<string, unknown>)?.delta as Record<string, unknown>)?.type === 'text_delta'
      ) {
        process.stdout.write(
          String((((chunk.event as Record<string, unknown>)?.delta as Record<string, unknown>)?.text) ?? '')
        )
      }
      break
    }

    case 'tool_result':
      console.log(`\n[tool_result] ${event.toolUseId} isError=${event.isError}`)
      console.log(event.output.slice(0, 500))
      break

    case 'done':
      console.log('\n' + '─'.repeat(60))
      console.log(`[done] Claude session: ${event.claudeSessionId}`)
      console.log(`[done] Content length: ${event.content.length} chars`)
      socket.destroy()
      break

    case 'error':
      console.log('\n' + '─'.repeat(60))
      console.error(`[error] code=${event.errorCode} message=${event.message}`)
      socket.destroy()
      break
  }
})
