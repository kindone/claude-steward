import type { Response } from 'express'

// Global registry of active /api/events SSE connections.
// Used to broadcast app-level events (reload, future notifications) to all browsers.
const appConnections = new Set<Response>()

export function registerConnection(res: Response): void {
  appConnections.add(res)
  res.on('close', () => appConnections.delete(res))
}

export function broadcastEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of appConnections) {
    if (!res.writableEnded) res.write(payload)
  }
}
