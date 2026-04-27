import { useState, useEffect, useRef } from 'react'
import { subscribeToAppEvents } from '../lib/api.js'

export type ConnState = 'connecting' | 'connected' | 'reconnecting'

export type AppConnection = {
  state: ConnState
  /** Timestamp (ms) of the last received SSE data, or null if never connected. */
  lastSeenAt: number | null
}

type AppConnectionOpts = {
  /**
   * When false, do not open `/api/events` (avoids 401 while auth status is still loading
   * or after logout). Defaults to true for callers that are always post-auth.
   */
  enabled?: boolean
  onReload?: () => void
  onPushTarget?: (target: { sessionId: string; projectId: string | null }) => void
  onSchedulesChanged?: (sessionId: string | null) => void
  onArtifactUpdated?: () => void
}

/**
 * Tracks the app-level SSE connection state and last-activity time.
 * Re-exports onReload/onPushTarget/onSchedulesChanged so callers don't need to call subscribeToAppEvents separately.
 */
export function useAppConnection(opts?: AppConnectionOpts): AppConnection {
  const { enabled = true, ...handlers } = opts ?? {}
  const [state, setState] = useState<ConnState>('connecting')
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null)
  const onReloadRef = useRef(handlers.onReload)
  onReloadRef.current = handlers.onReload
  const onPushTargetRef = useRef(handlers.onPushTarget)
  onPushTargetRef.current = handlers.onPushTarget
  const onSchedulesChangedRef = useRef(handlers.onSchedulesChanged)
  onSchedulesChangedRef.current = handlers.onSchedulesChanged
  const onArtifactUpdatedRef = useRef(handlers.onArtifactUpdated)
  onArtifactUpdatedRef.current = handlers.onArtifactUpdated

  useEffect(() => {
    if (!enabled) {
      setState('connecting')
      return
    }
    const cancel = subscribeToAppEvents({
      onReload: () => onReloadRef.current?.(),
      onPushTarget: (t) => onPushTargetRef.current?.(t),
      onSchedulesChanged: (sid) => onSchedulesChangedRef.current?.(sid),
      onArtifactUpdated: () => onArtifactUpdatedRef.current?.(),
      onConnect: () => {
        setState('connected')
        setLastSeenAt(Date.now())
      },
      onDisconnect: () => setState('reconnecting'),
      onActivity: () => setLastSeenAt(Date.now()),
    })
    return cancel
  }, [enabled])

  return { state, lastSeenAt }
}
