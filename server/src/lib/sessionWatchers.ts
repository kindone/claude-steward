import type { Response } from 'express'

/**
 * One-shot watchers — parked clients waiting for a streaming job to complete.
 * `notifyWatchers` sends `event: done`, closes their connections, and clears the set.
 * The return count is used to decide whether to send a push notification.
 */
const watchers = new Map<string, Set<Response>>()

/**
 * Persistent subscribers — clients subscribed for the lifetime of a session view.
 * `notifySubscribers` sends `event: updated` without closing connections, enabling
 * multi-client sync: every open tab re-fetches messages whenever any client causes a change.
 */
const subscribers = new Map<string, Set<Response>>()

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

/**
 * Send `event: done` to every one-shot watcher, close their connections, clear the set.
 * Returns the count of notified clients (0 = no tab open → trigger push notification).
 */
export function notifyWatchers(sessionId: string): number {
  const set = watchers.get(sessionId)
  if (!set) return 0
  let count = 0
  for (const res of set) {
    if (!res.writableEnded) {
      res.write('event: done\ndata: {}\n\n')
      res.end()
      count++
    }
  }
  watchers.delete(sessionId)
  return count
}

export function addSubscriber(sessionId: string, res: Response): void {
  if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set())
  subscribers.get(sessionId)!.add(res)
}

export function removeSubscriber(sessionId: string, res: Response): void {
  const set = subscribers.get(sessionId)
  if (!set) return
  set.delete(res)
  if (set.size === 0) subscribers.delete(sessionId)
}

/**
 * Send `event: updated` to all persistent subscribers for this session.
 * Connections stay open — subscribers re-fetch messages and remain subscribed.
 */
export function notifySubscribers(sessionId: string): void {
  const set = subscribers.get(sessionId)
  if (!set) return
  for (const res of set) {
    if (!res.writableEnded) res.write('event: updated\ndata: {}\n\n')
  }
}
