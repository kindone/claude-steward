/**
 * HTTP server's connection to the Claude worker process.
 * Maintains a persistent Unix socket connection, reconnects automatically,
 * and routes incoming events to per-session handlers.
 *
 * Usage:
 *   workerClient.connect()          // call once on server startup
 *   workerClient.isConnected()      // check before delegating a job
 *   workerClient.send(cmd)          // send a command (start/stop/status)
 *   workerClient.subscribe(id, fn)  // receive events for a session
 *   workerClient.unsubscribe(id)    // clean up when job ends
 */

import net from 'node:net'
import { createInterface } from 'node:readline'
import { SOCKET_PATH } from './protocol.js'
import type { WorkerCommand, WorkerEvent } from './protocol.js'

type EventHandler = (event: WorkerEvent) => void

const RECONNECT_DELAY_MS = 3_000

class WorkerClient {
  private socket: net.Socket | null = null
  private connected = false
  private handlers = new Map<string, EventHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private started = false

  /** Call once on server startup to begin connecting. */
  connect(): void {
    if (this.started) return
    this.started = true
    this._doConnect()
  }

  private _doConnect(): void {
    const socket = net.connect(SOCKET_PATH)

    socket.on('connect', () => {
      this.socket = socket
      this.connected = true
      console.log('[worker-client] connected to worker')
    })

    socket.on('error', (err) => {
      // ENOENT = worker not started yet; log only unexpected errors
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[worker-client] socket error:', err.message)
      }
    })

    socket.on('close', () => {
      this.socket = null
      this.connected = false

      // Notify all pending session handlers so they can surface an error to the client
      for (const [sessionId, handler] of this.handlers) {
        handler({
          type: 'error',
          sessionId,
          errorCode: 'process_error',
          message: 'Worker disconnected',
          content: '',
        })
      }
      this.handlers.clear()

      this._scheduleReconnect()
    })

    const rl = createInterface({ input: socket, crlfDelay: Infinity })
    // readline independently re-emits stream errors; suppress to avoid unhandled exception
    // (socket.on('error') already handles the underlying error)
    rl.on('error', () => {})
    rl.on('line', (line) => {
      if (!line.trim()) return
      let event: WorkerEvent
      try { event = JSON.parse(line) as WorkerEvent } catch { return }

      if ('sessionId' in event) {
        this.handlers.get(event.sessionId)?.(event)
      }
    })
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      console.log('[worker-client] reconnecting...')
      this._doConnect()
    }, RECONNECT_DELAY_MS)
  }

  isConnected(): boolean {
    return this.connected
  }

  send(cmd: WorkerCommand): boolean {
    if (!this.socket || !this.connected) return false
    this.socket.write(JSON.stringify(cmd) + '\n')
    return true
  }

  subscribe(sessionId: string, handler: EventHandler): void {
    this.handlers.set(sessionId, handler)
  }

  unsubscribe(sessionId: string): void {
    this.handlers.delete(sessionId)
  }
}

export const workerClient = new WorkerClient()
