/**
 * Apps Sidecar — standalone process.
 * Listens on a Unix domain socket, accepts NDJSON commands from the HTTP server,
 * spawns mini-app child processes (MkDocs, Vite, etc.), and replies with status.
 *
 * Intentionally dumb: no DB access, no business logic.
 * The HTTP server (the "brain") handles all slot assignment and DB writes.
 *
 * Start: tsx server/src/apps/sidecar.ts
 */

import net from 'node:net'
import fs from 'node:fs'
import { createInterface } from 'node:readline'
import { spawn, execFileSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { APPS_SOCKET_PATH } from './protocol.js'
import type { AppsCommand, AppsReply } from './protocol.js'

type ManagedApp = {
  process: ChildProcess
  port: number
  startedAt: number
}

const apps = new Map<string, ManagedApp>()
const clients = new Set<net.Socket>()

function broadcast(event: AppsReply): void {
  const line = JSON.stringify(event) + '\n'
  for (const client of clients) {
    if (!client.destroyed) client.write(line)
  }
}

function reply(socket: net.Socket, event: AppsReply): void {
  if (!socket.destroyed) socket.write(JSON.stringify(event) + '\n')
}

async function handleCommand(socket: net.Socket, cmd: AppsCommand): Promise<void> {
  if (cmd.type === 'start') {
    if (apps.has(cmd.configId)) {
      reply(socket, { type: 'error', configId: cmd.configId, error: 'already running' })
      return
    }

    // Kill any orphaned process holding the port before spawning.
    // This handles the case where the sidecar was restarted and lost its map
    // but a detached child is still occupying the port.
    try {
      execFileSync('fuser', ['-k', `${cmd.port}/tcp`], { timeout: 2_000 })
      // Give the process a moment to release the port
      await new Promise<void>((r) => setTimeout(r, 200))
    } catch {
      // fuser exits non-zero if no process was using the port — that's fine
    }

    let child: ChildProcess
    try {
      child = spawn('sh', ['-c', cmd.command], {
        cwd: cmd.workDir,
        stdio: 'ignore',
        // detached=true creates a new process group so we can kill the entire
        // group (sh + all children) with process.kill(-pgid). Without this,
        // killing the sh wrapper orphans child processes (e.g. mkdocs).
        detached: true,
      })
      // Don't keep the sidecar alive just because the child is running
      child.unref()
    } catch (err) {
      reply(socket, { type: 'error', configId: cmd.configId, error: String(err) })
      return
    }

    if (!child.pid) {
      reply(socket, { type: 'error', configId: cmd.configId, error: 'spawn failed — no pid' })
      return
    }

    apps.set(cmd.configId, { process: child, port: cmd.port, startedAt: Date.now() })
    console.log(`[apps] started configId=${cmd.configId} pid=${child.pid} port=${cmd.port}`)
    reply(socket, { type: 'started', configId: cmd.configId, pid: child.pid })

    child.on('exit', (code) => {
      const wasManaged = apps.has(cmd.configId)
      apps.delete(cmd.configId)
      if (wasManaged) {
        // Unexpected exit (not triggered by a stop command) — broadcast crash event
        console.log(`[apps] crashed configId=${cmd.configId} exitCode=${code}`)
        broadcast({ type: 'crashed', configId: cmd.configId, exitCode: code })
      }
    })
  } else if (cmd.type === 'stop') {
    const app = apps.get(cmd.configId)
    if (!app) {
      // Idempotent — already stopped
      reply(socket, { type: 'stopped', configId: cmd.configId })
      return
    }

    // Remove from map BEFORE sending kill so the exit handler doesn't broadcast a crash
    apps.delete(cmd.configId)

    const { process: child } = app
    const onExit = () => {
      console.log(`[apps] stopped configId=${cmd.configId}`)
      reply(socket, { type: 'stopped', configId: cmd.configId })
    }

    child.once('exit', onExit)
    // Kill the entire process group (negative pgid) so sh + all children die
    try { process.kill(-child.pid!, 'SIGTERM') } catch { child.kill('SIGTERM') }

    // Force-kill after 5s if SIGTERM didn't work
    setTimeout(() => {
      if (!child.killed) {
        try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }, 5_000)
  } else if (cmd.type === 'status') {
    const list = Array.from(apps.entries()).map(([configId, app]) => ({
      configId,
      port: app.port,
      pid: app.process.pid!,
      uptimeMs: Date.now() - app.startedAt,
    }))
    reply(socket, { type: 'status', apps: list })
  }
}

// Clean up stale socket from a previous run
if (fs.existsSync(APPS_SOCKET_PATH)) {
  fs.unlinkSync(APPS_SOCKET_PATH)
}

const server = net.createServer((socket) => {
  clients.add(socket)
  console.log(`[apps] client connected (total: ${clients.size})`)

  const rl = createInterface({ input: socket, crlfDelay: Infinity })
  rl.on('error', () => {})

  rl.on('line', (line) => {
    if (!line.trim()) return
    let cmd: AppsCommand
    try {
      cmd = JSON.parse(line) as AppsCommand
    } catch {
      console.warn('[apps] malformed command:', line)
      return
    }
    handleCommand(socket, cmd)
  })

  socket.on('error', () => {})
  socket.on('close', () => {
    clients.delete(socket)
    console.log(`[apps] client disconnected (total: ${clients.size})`)
  })
})

server.listen(APPS_SOCKET_PATH, () => {
  console.log(`[apps] sidecar listening on ${APPS_SOCKET_PATH}`)
})

// Graceful shutdown: kill all children then exit
function shutdown(): void {
  console.log('[apps] shutting down...')
  for (const [configId, app] of apps) {
    console.log(`[apps] killing configId=${configId}`)
    try { process.kill(-app.process.pid!, 'SIGTERM') } catch { app.process.kill('SIGTERM') }
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3_000)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
