/**
 * Persistent SSE connection to /api/watch.
 * Receives all cell broadcast events from the server and dispatches
 * them as window CustomEvents so Cell and App components can react.
 *
 * This is the single source of truth for real-time cell updates —
 * more reliable than parsing events embedded in the chat SSE stream
 * because EventSource handles SSE framing correctly and auto-reconnects.
 */
import { useEffect } from 'react'

export function useWatchStream(): void {
  useEffect(() => {
    const es = new EventSource('/api/watch')

    const dispatch = (name: string, data: unknown) => {
      window.dispatchEvent(new CustomEvent(name, { detail: data }))
    }

    const parse = (handler: (data: unknown) => void) => (e: MessageEvent) => {
      try { handler(JSON.parse(e.data)) } catch { /* ignore malformed */ }
    }

    es.addEventListener('cell:updated',   parse(d => dispatch('notebook:cell-updated',   d)))
    es.addEventListener('cell:created',   parse(d => dispatch('notebook:cell-created',   d)))
    es.addEventListener('cell:deleted',   parse(d => dispatch('notebook:cell-deleted',   d)))
    es.addEventListener('cell:run-event', parse(d => dispatch('notebook:cell-run-event', d)))

    return () => es.close()
  }, [])
}
