/**
 * Claude Worker — standalone process.
 * Listens on a Unix domain socket, accepts NDJSON commands from the HTTP server,
 * spawns Claude CLI jobs, and broadcasts NDJSON events back to all connected clients.
 *
 * Start: tsx server/src/worker/main.ts
 */

import dotenv from 'dotenv'
import path from 'node:path'
import net from 'node:net'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { SOCKET_PATH } from './protocol.js'
import { JobManager } from './job-manager.js'
import { jobQueries } from './db.js'
import type { WorkerCommand, WorkerEvent } from './protocol.js'

// Load the monorepo-root .env so adapter env reads (GEMINI_API_KEY,
// GOOGLE_GENERATIVE_AI_API_KEY, OPENCODE_DEFAULT_MODEL, ANTHROPIC_API_KEY,
// CLAUDE_CODE_OAUTH_TOKEN, OPENCODE_PATH, …) succeed at child-spawn time.
// Mirrors server/src/index.ts:17 — without this the worker only sees vars
// PM2 explicitly forwarded in ecosystem.config.cjs (DATABASE_PATH and a few
// socket paths), which is too narrow for opencode auth.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// dist/worker/main.js → ../../../.env  (= monorepo root)
dotenv.config({ path: path.join(__dirname, '../../../.env') })

const manager = new JobManager()
const clients = new Set<net.Socket>()

// Broadcast an event to all connected clients
function broadcast(event: WorkerEvent): void {
  const line = JSON.stringify(event) + '\n'
  for (const client of clients) {
    if (!client.destroyed) client.write(line)
  }
}

manager.onEvent = broadcast

// On startup, mark any jobs that were left 'running' from a previous crash as interrupted.
// (Mirrors the steward.db interrupted-cleanup that will happen in Step 2.)
const stale = jobQueries.listRunning()
if (stale.length > 0) {
  console.log(`[worker] marking ${stale.length} stale running job(s) as interrupted`)
  for (const job of stale) {
    jobQueries.updateStatus(job.session_id, 'interrupted', 'process_error', job.content, job.tool_calls ?? null)
  }
}

// Clean up stale socket file from a previous run
if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH)
}

const server = net.createServer((socket) => {
  clients.add(socket)
  console.log(`[worker] client connected (total: ${clients.size})`)

  const rl = createInterface({ input: socket, crlfDelay: Infinity })

  rl.on('line', (line) => {
    if (!line.trim()) return

    let cmd: WorkerCommand
    try {
      cmd = JSON.parse(line) as WorkerCommand
    } catch {
      console.warn('[worker] malformed command:', line)
      return
    }

    console.log(`[worker] command: ${cmd.type} session=${cmd.sessionId}`)

    if (cmd.type === 'start') {
      manager.start({
        sessionId: cmd.sessionId,
        prompt: cmd.prompt,
        claudeSessionId: cmd.claudeSessionId,
        projectPath: cmd.projectPath,
        permissionMode: cmd.permissionMode,
        systemPrompt: cmd.systemPrompt,
        model: cmd.model,
        cli: cmd.cli,
      })
    } else if (cmd.type === 'stop') {
      manager.stop(cmd.sessionId)
    } else if (cmd.type === 'status') {
      const status = manager.status(cmd.sessionId)
      const reply: WorkerEvent = {
        type: 'status_reply',
        sessionId: cmd.sessionId,
        status,
        partialContent: status === 'running' ? manager.partialContent(cmd.sessionId) : undefined,
      }
      socket.write(JSON.stringify(reply) + '\n')
    } else if (cmd.type === 'get_result') {
      const job = jobQueries.find(cmd.sessionId)
      const reply: WorkerEvent = {
        type: 'result_reply',
        sessionId: cmd.sessionId,
        status: job ? (job.status as 'complete' | 'interrupted') : 'not_found',
        content: job?.content ?? '',
        errorCode: job?.error_code ?? null,
        toolCalls: job?.tool_calls ?? null,
      }
      socket.write(JSON.stringify(reply) + '\n')
    }
  })

  socket.on('close', () => {
    clients.delete(socket)
    console.log(`[worker] client disconnected (total: ${clients.size})`)
  })

  socket.on('error', (err) => {
    console.error('[worker] socket error:', err.message)
    clients.delete(socket)
  })
})

server.listen(SOCKET_PATH, () => {
  console.log(`[worker] listening on ${SOCKET_PATH}`)
})

server.on('error', (err) => {
  console.error('[worker] server error:', err)
  process.exit(1)
})

// Graceful shutdown
function shutdown() {
  console.log('[worker] shutting down')
  server.close()
  for (const client of clients) client.destroy()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
