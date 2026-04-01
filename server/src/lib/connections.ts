import type { Response } from 'express'

// Global registry of active /api/events SSE connections.
// Used to broadcast app-level events (reload, future notifications) to all browsers.
const appConnections = new Set<Response>()

// Track which connections are in the foreground (page visible).
// A connection starts as foreground when registered, and toggles
// via POST /api/events/visibility. When the user backgrounds the app
// on mobile, the SSE stays alive but the connection is marked hidden.
const foregroundConnections = new Set<Response>()

// Map connection IDs to their Response objects for visibility toggling.
const connectionById = new Map<string, Response>()
let nextConnectionId = 1

export function registerConnection(res: Response): string {
  const id = String(nextConnectionId++)
  appConnections.add(res)
  foregroundConnections.add(res)
  connectionById.set(id, res)
  res.on('close', () => {
    appConnections.delete(res)
    foregroundConnections.delete(res)
    connectionById.delete(id)
  })
  return id
}

/** Mark a connection as visible (foreground) or hidden (backgrounded). */
export function setConnectionVisibility(connectionId: string, visible: boolean): void {
  const res = connectionById.get(connectionId)
  if (!res) return
  if (visible) {
    foregroundConnections.add(res)
  } else {
    foregroundConnections.delete(res)
  }
}

/** True if at least one browser tab is in the foreground. */
export function hasActiveClients(): boolean {
  return foregroundConnections.size > 0
}

export function broadcastEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of appConnections) {
    if (!res.writableEnded) res.write(payload)
  }
}
