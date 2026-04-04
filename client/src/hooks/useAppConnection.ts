import { useState, useEffect, useRef } from 'react'
import { subscribeToAppEvents } from '../lib/api.js'

export type ConnState = 'connecting' | 'connected' | 'reconnecting'

export type AppConnection = {
  state: ConnState
  /** Timestamp (ms) of the last received SSE data, or null if never connected. */
  lastSeenAt: number | null
}

type AppConnectionOpts = {
  onReload?: () => void
  onPushTarget?: (target: { sessionId: string; projectId: string | null }) => void
  onSchedulesChanged?: (sessionId: string | null) => void
}

/**
 * Tracks the app-level SSE connection state and last-activity time.
 * Re-exports onReload/onPushTarget/onSchedulesChanged so callers don't need to call subscribeToAppEvents separately.
 */
export function useAppConnection(opts?: AppConnectionOpts): AppConnection {
  const [state, setState] = useState<ConnState>('connecting')
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null)
  const onReloadRef = useRef(opts?.onReload)
  onReloadRef.current = opts?.onReload
  const onPushTargetRef = useRef(opts?.onPushTarget)
  onPushTargetRef.current = opts?.onPushTarget
  const onSchedulesChangedRef = useRef(opts?.onSchedulesChanged)
  onSchedulesChangedRef.current = opts?.onSchedulesChanged

  useEffect(() => {
    const cancel = subscribeToAppEvents({
      onReload: () => onReloadRef.current?.(),
      onPushTarget: (t) => onPushTargetRef.current?.(t),
      onSchedulesChanged: (sid) => onSchedulesChangedRef.current?.(sid),
      onConnect: () => {
        setState('connected')
        setLastSeenAt(Date.now())
      },
      onDisconnect: () => setState('reconnecting'),
      onActivity: () => setLastSeenAt(Date.now()),
    })
    return cancel
  }, [])

  return { state, lastSeenAt }
}
