import type { Response } from 'express'

/**
 * Registry of SSE response objects waiting for a session's Claude response to complete.
 * When `notifyWatchers` is called the server pushes `event: done` to all parked clients
 * and they immediately re-fetch the final message — no polling ceiling needed.
 */
const watchers = new Map<string, Set<Response>>()

export function addWatcher(sessionId: string, res: Response): void {
  if (!watchers.has(sessionId)) watchers.set(sessionId, new Set())
  watchers.get(sessionId)!.add(res)
}

export function removeWatcher(sessionId: string, res: Response): void {
  const set = watchers.get(sessionId)
  if (!set) return
  set.delete(res)
  if (set.size === 0) watchers.delete(sessionId)
}

/** Send `event: done` to every client watching this session, then clear the set. */
export function notifyWatchers(sessionId: string): void {
  const set = watchers.get(sessionId)
  if (!set) return
  for (const res of set) {
    if (!res.writableEnded) {
      res.write('event: done\ndata: {}\n\n')
      res.end()
    }
  }
  watchers.delete(sessionId)
}
