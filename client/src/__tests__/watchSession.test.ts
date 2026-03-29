// Feature:     watchSession — EventSource-based session completion polling
// Arch/Design: watchSession in api.ts uses EventSource; server sends event: done then
//              closes the TCP connection, which can trigger a spurious onerror in browsers.
//              A doneFired flag ensures onerror is ignored after done fires.
// Spec:        ∀ done fires: onDone called, subsequent onerror is suppressed
//              ∀ onerror fires without done: onError called
// @quality:    correctness
// @type:       unit
// @mode:       verification

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { watchSession } from '../lib/api.js'

// ── Mock EventSource ──────────────────────────────────────────────────────────

type EventListenerMap = Map<string, EventListenerOrEventListenerObject>

class MockEventSource {
  static lastInstance: MockEventSource | null = null

  url: string
  withCredentials: boolean
  onerror: ((event: Event) => void) | null = null
  closeCalled = false

  private listeners: EventListenerMap = new Map()

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url
    this.withCredentials = init?.withCredentials ?? false
    MockEventSource.lastInstance = this
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener)
  }

  close(): void {
    this.closeCalled = true
  }

  /** Test helper — dispatch a named event. */
  fireEvent(type: string): void {
    const listener = this.listeners.get(type)
    if (!listener) return
    const event = new Event(type)
    if (typeof listener === 'function') {
      listener(event)
    } else {
      listener.handleEvent(event)
    }
  }

  /** Test helper — trigger the onerror handler. */
  fireError(): void {
    this.onerror?.(new Event('error'))
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('watchSession', () => {
  beforeEach(() => {
    MockEventSource.lastInstance = null
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls onDone when the done event fires', () => {
    const onDone = vi.fn()
    const onError = vi.fn()

    watchSession('session-abc', onDone, onError)

    const es = MockEventSource.lastInstance!
    expect(es).not.toBeNull()
    expect(es.url).toBe('/api/sessions/session-abc/watch')
    expect(es.withCredentials).toBe(true)

    es.fireEvent('done')

    expect(onDone).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    expect(es.closeCalled).toBe(true)
  })

  it('does NOT call onError when onerror fires after done has already fired', () => {
    // This is the bug scenario: server sends done then immediately closes TCP,
    // which causes a spurious onerror in some browsers. The doneFired guard
    // must suppress onError in this case.
    const onDone = vi.fn()
    const onError = vi.fn()

    watchSession('session-abc', onDone, onError)

    const es = MockEventSource.lastInstance!

    // Simulate: done fires first
    es.fireEvent('done')
    expect(onDone).toHaveBeenCalledOnce()

    // Simulate: spurious onerror fires afterwards
    es.fireError()

    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onError when onerror fires without a preceding done', () => {
    // Normal error path — no done event, just a connection failure.
    const onDone = vi.fn()
    const onError = vi.fn()

    watchSession('session-xyz', onDone, onError)

    const es = MockEventSource.lastInstance!

    es.fireError()

    expect(onError).toHaveBeenCalledOnce()
    expect(onDone).not.toHaveBeenCalled()
    expect(es.closeCalled).toBe(true)
  })
})
