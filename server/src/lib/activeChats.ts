/**
 * Registry of AbortControllers for in-flight Claude spawns, keyed by steward session ID.
 * Calling abort() on the controller sends SIGTERM to the Claude subprocess via the
 * signal listener in claude/process.ts, without triggering the error path.
 */
const activeChats = new Map<string, AbortController>()

export function registerChat(sessionId: string, controller: AbortController): void {
  activeChats.set(sessionId, controller)
}

export function unregisterChat(sessionId: string): void {
  activeChats.delete(sessionId)
}

/** Returns true if a chat was found and aborted, false if no active chat for this session. */
export function abortChat(sessionId: string): boolean {
  const controller = activeChats.get(sessionId)
  if (!controller) return false
  activeChats.delete(sessionId)
  controller.abort()
  return true
}
