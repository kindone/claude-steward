// Feature:     Chat streaming (worker path)
// Arch/Design: Worker runs as a separate PM2 process on a Unix socket so in-flight
//              jobs survive HTTP server restarts
// Spec:        ∀ job: emits session_id → chunks → done|error in order; content persisted to worker.db
//              ∀ concurrent jobs: events never cross-contaminate between sessions
//              ∀ client disconnect mid-stream: job continues; DB updated on completion
//              ∀ stop command: job terminates; no further events after acknowledgement
// @quality:    reliability, correctness
// @type:       stateful, chaos
// @mode:       verification
//
// Slow tests — real Claude CLI round-trips (~10–30s). Run selectively:
//   npx vitest run src/__tests__/worker.e2e.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import net from 'node:net'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WorkerEvent, WorkerCommand } from '../worker/protocol.js'

const RUN_ID = Date.now()
const SOCKET_PATH = `/tmp/claude-worker-test-${RUN_ID}.sock`
const WORKER_DB_PATH = `/tmp/claude-worker-test-${RUN_ID}.db`
const REAL_CLAUDE = process.env.HOME
  ? `${process.env.HOME}/.local/bin/claude`
  : '/usr/local/.local/bin/claude'

let workerProc: ReturnType<typeof spawn>

// ── Helpers ───────────────────────────────────────────────────────────────────

function waitForSocket(socketPath: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = () => {
      if (fs.existsSync(socketPath)) return resolve()
      if (Date.now() > deadline) return reject(new Error(`Worker socket did not appear within ${timeoutMs}ms`))
      setTimeout(poll, 100)
    }
    poll()
  })
}

/** Connect to worker, send a command, collect events until done/error, then disconnect. */
function runJob(cmd: WorkerCommand, timeoutMs = 90_000): Promise<WorkerEvent[]> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(SOCKET_PATH)
    const events: WorkerEvent[] = []
    let timer: ReturnType<typeof setTimeout>

    const finish = (err?: Error) => {
      clearTimeout(timer)
      socket.destroy()
      err ? reject(err) : resolve(events)
    }

    timer = setTimeout(() => finish(new Error(`Job timed out after ${timeoutMs}ms`)), timeoutMs)
    socket.on('connect', () => socket.write(JSON.stringify(cmd) + '\n'))
    socket.on('error', finish)

    const rl = createInterface({ input: socket, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      let event: WorkerEvent
      try { event = JSON.parse(line) as WorkerEvent } catch { return }
      if ('sessionId' in event && event.sessionId !== (cmd as { sessionId: string }).sessionId) return
      events.push(event)
      if (event.type === 'done' || event.type === 'error') finish()
    })
  })
}

/** Send a fire-and-forget command (stop/status) on a short-lived connection. */
function sendCommand(cmd: WorkerCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.connect(SOCKET_PATH, () => {
      s.write(JSON.stringify(cmd) + '\n')
      s.end()
      resolve()
    })
    s.on('error', reject)
  })
}

/** Send a status query and return the reply. */
function queryStatus(sessionId: string, timeoutMs = 5_000): Promise<Extract<WorkerEvent, { type: 'status_reply' }>> {
  return new Promise((resolve, reject) => {
    const s = net.connect(SOCKET_PATH)
    const timer = setTimeout(() => { s.destroy(); reject(new Error('Status query timed out')) }, timeoutMs)
    s.on('connect', () => s.write(JSON.stringify({ type: 'status', sessionId }) + '\n'))
    s.on('error', reject)
    const rl = createInterface({ input: s, crlfDelay: Infinity })
    rl.on('line', (line) => {
      let event: WorkerEvent
      try { event = JSON.parse(line) as WorkerEvent } catch { return }
      if (event.type === 'status_reply' && event.sessionId === sessionId) {
        clearTimeout(timer)
        s.destroy()
        resolve(event)
      }
    })
  })
}

/** Poll worker.db until the job reaches a terminal status or timeout. */
function waitForDbStatus(
  sessionId: string,
  status: string,
  timeoutMs = 90_000,
): Promise<{ session_id: string; status: string; content: string }> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = () => {
      try {
        const db = new DatabaseSync(WORKER_DB_PATH)
        const row = db.prepare('SELECT * FROM jobs WHERE session_id = ?').get(sessionId) as
          | { session_id: string; status: string; content: string }
          | undefined
        db.close()
        if (row && row.status === status) return resolve(row)
        if (Date.now() > deadline) return reject(new Error(`DB status '${status}' for ${sessionId} not reached within ${timeoutMs}ms. Last: ${row?.status}`))
        setTimeout(poll, 500)
      } catch {
        if (Date.now() > deadline) return reject(new Error('worker.db not accessible within timeout'))
        setTimeout(poll, 500)
      }
    }
    poll()
  })
}

function makeStartCmd(overrides: Partial<WorkerCommand> & { sessionId: string; prompt: string }): WorkerCommand {
  return {
    type: 'start',
    claudeSessionId: null,
    projectPath: os.tmpdir(),
    permissionMode: 'default',
    systemPrompt: null,
    ...overrides,
  } as WorkerCommand
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  workerProc = spawn('npx', ['tsx', 'src/worker/main.ts'], {
    cwd: path.resolve(import.meta.dirname, '../../'),
    env: {
      ...process.env,
      WORKER_SOCKET: SOCKET_PATH,
      WORKER_DB_PATH,
      CLAUDE_PATH: REAL_CLAUDE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  workerProc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[worker] ${d}`))
  workerProc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[worker:err] ${d}`))
  workerProc.on('error', (err) => console.error('[worker] failed to start:', err.message))

  await waitForSocket(SOCKET_PATH)
  console.log('[e2e] worker ready')
}, 20_000)

afterAll(() => {
  workerProc?.kill('SIGTERM')
  for (const p of [SOCKET_PATH, WORKER_DB_PATH, `${WORKER_DB_PATH}-wal`, `${WORKER_DB_PATH}-shm`]) {
    try { fs.unlinkSync(p) } catch { /* ignore */ }
  }
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Claude Worker e2e', () => {

  it('emits session_id, chunk, and done events for a simple prompt', async () => {
    const sessionId = `test-${randomUUID()}`
    const events = await runJob(makeStartCmd({
      sessionId,
      prompt: 'respond with exactly the text: STEWARD_TEST_OK',
    }))

    const types = events.map(e => e.type)
    expect(types).toContain('session_id')
    expect(types).toContain('chunk')
    expect(types).toContain('done')
    expect(types).not.toContain('error')

    const done = events.find(e => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>
    expect(done.content).toContain('STEWARD_TEST_OK')
    expect(done.claudeSessionId).toBeTruthy()
  }, 90_000)

  it('persists content and status to worker.db after completion', async () => {
    const sessionId = `test-${randomUUID()}`
    const events = await runJob(makeStartCmd({
      sessionId,
      prompt: 'respond with exactly the text: DB_PERSIST_OK',
    }))

    const done = events.find(e => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>
    expect(done).toBeDefined()

    const row = await waitForDbStatus(sessionId, 'complete', 5_000)
    expect(row.content).toContain('DB_PERSIST_OK')
    expect(row.status).toBe('complete')
  }, 90_000)

  it('handles concurrent jobs independently', async () => {
    const id1 = `test-${randomUUID()}`
    const id2 = `test-${randomUUID()}`

    const [events1, events2] = await Promise.all([
      runJob(makeStartCmd({ sessionId: id1, prompt: 'respond with exactly the text: CONCURRENT_A' })),
      runJob(makeStartCmd({ sessionId: id2, prompt: 'respond with exactly the text: CONCURRENT_B' })),
    ])

    const done1 = events1.find(e => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>
    const done2 = events2.find(e => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>

    expect(done1.content).toContain('CONCURRENT_A')
    expect(done2.content).toContain('CONCURRENT_B')
    // Verify no cross-contamination — each job only has its own content
    expect(done1.content).not.toContain('CONCURRENT_B')
    expect(done2.content).not.toContain('CONCURRENT_A')
  }, 90_000)

  it('status query returns running while active, idle after done', async () => {
    const sessionId = `test-${randomUUID()}`

    // Start a job and query status before it finishes
    const jobPromise = runJob(makeStartCmd({
      sessionId,
      prompt: 'count from 1 to 20, one number per line',
    }), 90_000)

    // Wait for job to start (first chunk) then query
    await new Promise(r => setTimeout(r, 1_500))
    const runningReply = await queryStatus(sessionId)
    expect(runningReply.status).toBe('running')

    // Wait for completion then query again
    await jobPromise
    const idleReply = await queryStatus(sessionId)
    expect(idleReply.status).toBe('idle')
  }, 90_000)

  it('duplicate start for same session is ignored', async () => {
    const sessionId = `test-${randomUUID()}`

    const jobPromise = runJob(makeStartCmd({
      sessionId,
      prompt: 'respond with exactly the text: DEDUP_OK',
    }), 90_000)

    // Send a second start for the same session immediately
    await new Promise(r => setTimeout(r, 500))
    await sendCommand(makeStartCmd({
      sessionId,
      prompt: 'respond with exactly the text: DEDUP_WRONG',
    }))

    const events = await jobPromise
    const done = events.find(e => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>

    // Only the first job should have run
    expect(done.content).toContain('DEDUP_OK')
    expect(done.content).not.toContain('DEDUP_WRONG')
  }, 90_000)

  it('worker keeps running and updates DB after client disconnects mid-stream', async () => {
    const sessionId = `test-${randomUUID()}`

    // Connect, start a job, wait for first chunk, then disconnect
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(SOCKET_PATH)
      socket.on('connect', () => socket.write(JSON.stringify(makeStartCmd({
        sessionId,
        prompt: 'count from 1 to 5, one number per line',
      })) + '\n'))
      socket.on('error', reject)

      const rl = createInterface({ input: socket, crlfDelay: Infinity })
      rl.on('line', (line) => {
        let event: WorkerEvent
        try { event = JSON.parse(line) as WorkerEvent } catch { return }
        if ('sessionId' in event && event.sessionId === sessionId && event.type === 'chunk') {
          // Got first chunk — disconnect
          socket.destroy()
          resolve()
        }
      })

      setTimeout(() => reject(new Error('No chunk received before disconnect timeout')), 30_000)
    })

    // Worker should keep running and eventually mark job complete in DB
    const row = await waitForDbStatus(sessionId, 'complete', 60_000)
    expect(row.content.length).toBeGreaterThan(0)
  }, 90_000)

  it('resumes a previous session and retains context', async () => {
    const sessionId1 = `test-${randomUUID()}`

    // First job: establish a fact
    const events1 = await runJob(makeStartCmd({
      sessionId: sessionId1,
      prompt: 'remember this codeword: XYLOPHONE42. Acknowledge with "Codeword stored."',
    }))
    const done1 = events1.find(e => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>
    expect(done1).toBeDefined()
    const claudeSessionId = done1.claudeSessionId
    expect(claudeSessionId).toBeTruthy()

    // Second job: resume and verify context
    const sessionId2 = `test-${randomUUID()}`
    const events2 = await runJob(makeStartCmd({
      sessionId: sessionId2,
      prompt: 'What was the codeword I asked you to remember?',
      claudeSessionId,
    }))

    const done2 = events2.find(e => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>
    expect(done2).toBeDefined()
    expect(done2.content.toUpperCase()).toContain('XYLOPHONE42')
  }, 90_000)

  it('emits error event for a bad resume session ID', async () => {
    const sessionId = `test-${randomUUID()}`
    const events = await runJob(makeStartCmd({
      sessionId,
      prompt: 'hello',
      claudeSessionId: 'nonexistent-session-id-that-will-fail',
    }))

    const error = events.find(e => e.type === 'error') as Extract<WorkerEvent, { type: 'error' }> | undefined
    const done = events.find(e => e.type === 'done')

    if (error) {
      expect(['session_expired', 'process_error']).toContain(error.errorCode)
    } else {
      // Claude fell back silently to a new session — also acceptable
      expect(done).toBeDefined()
    }
  }, 90_000)

  it('stop command terminates a running job', async () => {
    const sessionId = `test-${randomUUID()}`

    const jobPromise = runJob(makeStartCmd({
      sessionId,
      prompt: 'count from 1 to 1000, one number per line',
    }), 30_000)

    await new Promise(r => setTimeout(r, 3_000))
    await sendCommand({ type: 'stop', sessionId })

    const events = await jobPromise
    // Resolved without timing out — that's the main assertion
    expect(events).toBeDefined()
    // Should not have received a full count to 1000
    const done = events.find(e => e.type === 'done') as Extract<WorkerEvent, { type: 'done' }>
    if (done) {
      expect(done.content).not.toContain('1000')
    }
  }, 40_000)

})
