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
}

/**
 * Tracks the app-level SSE connection state and last-activity time.
 * Re-exports onReload so callers don't need to call subscribeToAppEvents separately.
 */
export function useAppConnection(opts?: AppConnectionOpts): AppConnection {
  const [state, setState] = useState<ConnState>('connecting')
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null)
  const onReloadRef = useRef(opts?.onReload)
  onReloadRef.current = opts?.onReload

  useEffect(() => {
    const cancel = subscribeToAppEvents({
      onReload: () => onReloadRef.current?.(),
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
