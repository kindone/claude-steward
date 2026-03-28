// Feature:     Chat streaming
// Arch/Design: POST /api/chat wraps Claude CLI subprocess; streams NDJSON output via SSE
// Spec:        ∀ valid (sessionId, message): SSE emits title? → chunks → done; messages persisted to DB
//              ∀ invalid request (missing fields, unknown session): 400/404 JSON; no side effects
//              ∀ stream: title precedes chunks; done/error is terminal; chunk text matches persisted content
// @quality:    correctness, reliability
// @type:       contract
// @mode:       verification

import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

// Mock spawnClaude before importing app — Vitest hoists vi.mock calls
vi.mock('../claude/process.js', () => ({
  spawnClaude: vi.fn(({ res, onSessionId, onComplete }: {
    res: import('express').Response
    onSessionId: (id: string) => void
    onComplete?: (text: string) => void
  }) => {
    const mockSessionId = 'mock-claude-session-id'
    onSessionId(mockSessionId)

    const chunks = [
      { type: 'system', subtype: 'init', session_id: mockSessionId },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } } },
      { type: 'result', session_id: mockSessionId, is_error: false, result: 'Hello world' },
    ]

    for (const chunk of chunks) {
      res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`)
    }
    res.write(`event: done\ndata: ${JSON.stringify({ session_id: mockSessionId })}\n\n`)
    onComplete?.('Hello world')
    res.end()
  }),
}))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { authSessionQueries } from '../db/index.js'

const app = createApp()

const TEST_TOKEN = 'chat-test-session-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

let sharedProjectId: string

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-chat-'))
  const proj = await request(app)
    .post('/api/projects')
    .set('Cookie', authCookie)
    .send({ name: 'chat-test-project', path: tmpDir })
  sharedProjectId = proj.body.id
})

/** Parse a raw SSE response body into ordered events. */
function parseSseEvents(body: string): Array<{ event: string; data: unknown }> {
  return body
    .split('\n\n')
    .filter(b => b.trim())
    .flatMap(block => {
      let event = 'message'
      let data: unknown = null
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        if (line.startsWith('data: ')) {
          try { data = JSON.parse(line.slice(6)) } catch { data = line.slice(6) }
        }
      }
      return data !== null ? [{ event, data }] : []
    })
}

/** Stream a single chat request and return the raw SSE body. */
async function streamChat(sessionId: string, message: string): Promise<string> {
  const res = await request(app)
    .post('/api/chat')
    .set('Cookie', authCookie)
    .send({ sessionId, message })
    .buffer(true)
    .parse((res, done) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => done(null, data))
    })
  return res.body as string
}

describe('POST /api/chat ↔ SSE client contract', () => {

  describe('producer guarantees (chat route)', () => {
    it('returns 400 for missing sessionId', async () => {
      const res = await request(app).post('/api/chat').set('Cookie', authCookie).send({ message: 'hello' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/sessionId/)
    })

    it('returns 400 for missing message', async () => {
      const res = await request(app).post('/api/chat').set('Cookie', authCookie).send({ sessionId: 'anything' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/message/)
    })

    it('returns 404 for unknown session', async () => {
      const res = await request(app)
        .post('/api/chat').set('Cookie', authCookie)
        .send({ sessionId: 'nonexistent-session', message: 'hello' })
      expect(res.status).toBe(404)
    })

    describe('with a valid session', () => {
      let sessionId: string

      beforeAll(async () => {
        const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })
        sessionId = ses.body.id
      })

      it('opens SSE stream with correct content-type', async () => {
        const res = await request(app)
          .post('/api/chat').set('Cookie', authCookie)
          .send({ sessionId, message: 'say hello' })
          .buffer(true)
          .parse((res, done) => {
            let data = ''
            res.on('data', (chunk: Buffer) => { data += chunk.toString() })
            res.on('end', () => done(null, data))
          })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('text/event-stream')
        expect(res.body as string).toContain('event: chunk')
        expect(res.body as string).toContain('event: done')
      })

      it('emits title event on first message', async () => {
        const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })
        const body = await streamChat(ses.body.id, 'first message here')
        expect(body).toContain('event: title')
      })

      it('persists user and assistant messages to DB', async () => {
        const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })
        await streamChat(ses.body.id, 'persist me')
        const msgs = await request(app).get(`/api/sessions/${ses.body.id}/messages`).set('Cookie', authCookie)
        expect(msgs.body).toHaveLength(2)
        expect(msgs.body[0].role).toBe('user')
        expect(msgs.body[0].content).toBe('persist me')
        expect(msgs.body[1].role).toBe('assistant')
        expect(msgs.body[1].content).toBe('Hello world')
      })
    })
  })

  describe('consumer assumptions (SSE client — api.ts)', () => {
    it('validation error responses are JSON not SSE — client must not parse them as a stream', async () => {
      const res400 = await request(app).post('/api/chat').set('Cookie', authCookie).send({ message: 'hello' })
      expect(res400.headers['content-type']).toContain('application/json')
      expect(res400.headers['content-type']).not.toContain('text/event-stream')

      const res404 = await request(app).post('/api/chat').set('Cookie', authCookie)
        .send({ sessionId: 'nonexistent', message: 'hello' })
      expect(res404.headers['content-type']).toContain('application/json')
    })

    it('SSE stream always terminates — never hangs indefinitely', async () => {
      const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })
      // If this resolves, the stream terminated; the test completing IS the assertion
      const body = await streamChat(ses.body.id, 'does this end?')
      expect(body).toContain('event: done')
    })
  })

  describe('temporal invariants', () => {
    it('title event (when present) always precedes the first chunk event', async () => {
      const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })
      const body = await streamChat(ses.body.id, 'check ordering')
      const events = parseSseEvents(body)
      const titleIdx = events.findIndex(e => e.event === 'title')
      const firstChunkIdx = events.findIndex(e => e.event === 'chunk')
      if (titleIdx !== -1 && firstChunkIdx !== -1) {
        expect(titleIdx).toBeLessThan(firstChunkIdx)
      }
    })

    it('done or error is always the last event — nothing follows it', async () => {
      const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })
      const body = await streamChat(ses.body.id, 'terminal event check')
      const events = parseSseEvents(body)
      const terminalIdx = events.findIndex(e => e.event === 'done' || e.event === 'error')
      expect(terminalIdx).toBeGreaterThan(-1)
      expect(terminalIdx).toBe(events.length - 1)
    })
  })

  describe('bilateral invariants', () => {
    it('accumulated chunk text matches the persisted assistant message', async () => {
      const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })
      const body = await streamChat(ses.body.id, 'bilateral check')
      const events = parseSseEvents(body)

      // Accumulate text deltas from chunk events
      const accumulated = events
        .filter(e => e.event === 'chunk')
        .map(e => e.data as { type: string; event?: { type: string; delta?: { type: string; text?: string } } })
        .filter(d => d.type === 'stream_event' && d.event?.type === 'content_block_delta')
        .map(d => d.event?.delta?.text ?? '')
        .join('')

      // Compare with persisted assistant message
      const msgs = await request(app).get(`/api/sessions/${ses.body.id}/messages`).set('Cookie', authCookie)
      const assistant = (msgs.body as Array<{ role: string; content: string }>).find(m => m.role === 'assistant')
      expect(assistant).toBeDefined()
      expect(accumulated).toBe(assistant!.content)
    })
  })

})
