/**
 * HTTP server's connection to the apps sidecar process.
 * Maintains a persistent Unix socket connection with automatic reconnection.
 *
 * Unlike the worker client (which uses a subscription model for long-running jobs),
 * this uses request/reply: each command gets exactly one correlated reply.
 *
 * Usage:
 *   appsClient.connect()                   // call once on server startup
 *   appsClient.isConnected()               // check before sending commands
 *   await appsClient.request(cmd)          // send command, await reply
 *   appsClient.onCrashed = (id, code) => { // handle unexpected child exits
 */

import net from 'node:net'
import { createInterface } from 'node:readline'
import { APPS_SOCKET_PATH } from './protocol.js'
import type { AppsCommand, AppsReply, StartedReply, StoppedReply, StatusReply } from './protocol.js'

const RECONNECT_DELAY_MS = 3_000
const REQUEST_TIMEOUT_MS = 10_000

type PendingRequest = {
  resolve: (reply: AppsReply) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class AppsClient {
  private socket: net.Socket | null = null
  private connected = false
  private started = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Pending request/reply correlations keyed by configId (or '__status__' for status requests). */
  private pending = new Map<string, PendingRequest>()

  /** Called when the sidecar reports an unexpected child process exit. */
  onCrashed: ((configId: string, exitCode: number | null) => void) | null = null

  /** Call once on server startup. */
  connect(): void {
    if (this.started) return
    this.started = true
    this._doConnect()
  }

  private _doConnect(): void {
    const socket = net.connect(APPS_SOCKET_PATH)

    socket.on('connect', () => {
      this.socket = socket
      this.connected = true
      console.log('[apps-client] connected to sidecar')
    })

    socket.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[apps-client] socket error:', err.message)
      }
    })

    socket.on('close', () => {
      this.socket = null
      this.connected = false
      // Reject any in-flight requests
      for (const [key, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('apps sidecar disconnected'))
        this.pending.delete(key)
      }
      this._scheduleReconnect()
    })

    const rl = createInterface({ input: socket, crlfDelay: Infinity })
    rl.on('error', () => {})
    rl.on('line', (line) => {
      if (!line.trim()) return
      let event: AppsReply
      try { event = JSON.parse(line) as AppsReply } catch { return }
      this._dispatch(event)
    })
  }

  private _dispatch(event: AppsReply): void {
    if (event.type === 'crashed') {
      this.onCrashed?.(event.configId, event.exitCode)
      return
    }
    if (event.type === 'status') {
      const pending = this.pending.get('__status__')
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete('__status__')
        pending.resolve(event)
      }
      return
    }
    // started / stopped / error — keyed by configId
    if ('configId' in event) {
      const pending = this.pending.get(event.configId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(event.configId)
        pending.resolve(event)
      }
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      console.log('[apps-client] reconnecting...')
      this._doConnect()
    }, RECONNECT_DELAY_MS)
  }

  isConnected(): boolean {
    return this.connected
  }

  /** Send a command and wait for the correlated reply. Rejects after REQUEST_TIMEOUT_MS. */
  request(cmd: AppsCommand): Promise<AppsReply> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.connected) {
        reject(new Error('apps sidecar not connected'))
        return
      }

      const key = cmd.type === 'status' ? '__status__' : (cmd as { configId: string }).configId
      const timer = setTimeout(() => {
        this.pending.delete(key)
        reject(new Error(`apps request timed out (${cmd.type})`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(key, { resolve, reject, timer })
      this.socket.write(JSON.stringify(cmd) + '\n')
    })
  }

  /** Convenience typed wrappers. */
  async start(configId: string, port: number, command: string, workDir: string): Promise<StartedReply> {
    const reply = await this.request({ type: 'start', configId, port, command, workDir })
    if (reply.type === 'error') throw new Error(reply.error)
    return reply as StartedReply
  }

  async stop(configId: string): Promise<StoppedReply> {
    const reply = await this.request({ type: 'stop', configId })
    return reply as StoppedReply
  }

  async status(): Promise<StatusReply> {
    const reply = await this.request({ type: 'status' })
    return reply as StatusReply
  }
}

export const appsClient = new AppsClient()
