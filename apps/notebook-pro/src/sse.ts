import type { Response } from 'express'

// All open SSE clients (watch + chat endpoints share this set)
const clients = new Set<Response>()

export function addSseClient(res: Response): void {
  clients.add(res)
}

export function removeSseClient(res: Response): void {
  clients.delete(res)
}

export function sendSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function broadcastCellUpdate(cellId: string, source: string): void {
  const payload = JSON.stringify({ cellId, source })
  for (const res of clients) {
    if (!res.writableEnded) {
      res.write(`event: cell:updated\ndata: ${payload}\n\n`)
    }
  }
}

export function broadcastEvent(event: string, data: unknown): void {
  const payload = JSON.stringify(data)
  for (const res of clients) {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${payload}\n\n`)
    }
  }
}
