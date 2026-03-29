// Feature:     Worker recovery — recoverStreamingSessions
// Arch/Design: On HTTP server reconnect to worker, any streaming DB rows are resolved
//              against the worker's in-flight jobs. If a job is not_found (worker also
//              restarted), the row is marked interrupted via markStaleStreamingMessages()
//              and watchers must be notified so open tabs don't hang indefinitely.
// Spec:        ∀ not_found job: notifyWatchers called after settle(), message marked interrupted
//              ∀ complete job: notifyWatchers called, message marked complete
//              ∀ no streaming rows: notifyWatchers never called
// @quality:    correctness
// @type:       unit
// @mode:       verification

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { messageQueries, sessionQueries } from '../../db/index.js'
import type { WorkerEvent } from '../../worker/protocol.js'

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

vi.mock('../../worker/client.js', () => ({
  workerClient: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(() => true),
  },
}))

vi.mock('../../lib/sessionWatchers.js', () => ({
  notifyWatchers: vi.fn(() => 0),
  addWatcher: vi.fn(),
  removeWatcher: vi.fn(),
}))

// Import mocked modules after vi.mock declarations
import { workerClient } from '../../worker/client.js'
import { notifyWatchers } from '../../lib/sessionWatchers.js'
import { recoverStreamingSessions } from '../../worker/recovery.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Per-test map of sessionId → subscribe callback, rebuilt in beforeEach. */
let subscribeCallbacks: Map<string, (e: WorkerEvent) => void>

function setupSubscribeMock(): void {
  subscribeCallbacks = new Map()
  vi.mocked(workerClient.subscribe).mockImplementation((sid, cb) => {
    subscribeCallbacks.set(sid, cb)
  })
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('recoverStreamingSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    setupSubscribeMock()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not call notifyWatchers when there are no streaming messages', () => {
    // DB is clean — no streaming rows exist.
    recoverStreamingSessions()

    expect(notifyWatchers).not.toHaveBeenCalled()
  })

  it('calls notifyWatchers and marks message interrupted on not_found result', () => {
    // Seed: session + streaming message
    const sessionId = uuidv4()
    const messageId = uuidv4()
    sessionQueries.create(sessionId, 'test session', null)
    messageQueries.insertStreaming(messageId, sessionId)

    // Configure send mock: status → status_reply:idle, get_result → result_reply:not_found
    vi.mocked(workerClient.send).mockImplementation((msg) => {
      const m = msg as { type: string; sessionId: string }
      const cb = subscribeCallbacks.get(m.sessionId)
      if (m.type === 'status') {
        cb?.({ type: 'status_reply', sessionId: m.sessionId, status: 'idle' })
      } else if (m.type === 'get_result') {
        cb?.({
          type: 'result_reply',
          sessionId: m.sessionId,
          status: 'not_found',
          content: '',
          errorCode: null,
        })
      }
      return true
    })

    recoverStreamingSessions()

    // settle() should have been called synchronously (pending reached 0)
    // markStaleStreamingMessages() converts the streaming row to interrupted
    const messages = messageQueries.listBySessionId(sessionId)
    expect(messages).toHaveLength(1)
    expect(messages[0].status).toBe('interrupted')

    // notifyWatchers must be called for the session so open tabs don't hang
    expect(notifyWatchers).toHaveBeenCalledWith(sessionId)
  })

  it('calls notifyWatchers and marks message complete on result_reply:complete', () => {
    // Seed: session + streaming message
    const sessionId = uuidv4()
    const messageId = uuidv4()
    sessionQueries.create(sessionId, 'test session complete', null)
    messageQueries.insertStreaming(messageId, sessionId)

    const completedContent = 'The answer is 42'

    // Configure send mock: status → status_reply:idle, get_result → result_reply:complete
    vi.mocked(workerClient.send).mockImplementation((msg) => {
      const m = msg as { type: string; sessionId: string }
      const cb = subscribeCallbacks.get(m.sessionId)
      if (m.type === 'status') {
        cb?.({ type: 'status_reply', sessionId: m.sessionId, status: 'idle' })
      } else if (m.type === 'get_result') {
        cb?.({
          type: 'result_reply',
          sessionId: m.sessionId,
          status: 'complete',
          content: completedContent,
          errorCode: null,
          toolCalls: null,
        })
      }
      return true
    })

    recoverStreamingSessions()

    // Message should be finalized as complete with the recovered content
    const messages = messageQueries.listBySessionId(sessionId)
    expect(messages).toHaveLength(1)
    expect(messages[0].status).toBe('complete')
    expect(messages[0].content).toBe(completedContent)

    // notifyWatchers must be called so watching tabs get the done signal
    expect(notifyWatchers).toHaveBeenCalledWith(sessionId)
  })
})
