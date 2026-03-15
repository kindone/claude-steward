import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
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

// Shared project used for session creation in chat tests
let sharedProjectId: string

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-chat-'))
  const proj = await request(app)
    .post('/api/projects')
    .set('Cookie', authCookie)
    .send({ name: 'chat-test-project', path: tmpDir })
  sharedProjectId = proj.body.id
})

describe('POST /api/chat', () => {
  it('returns 400 for missing sessionId', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Cookie', authCookie)
      .send({ message: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/sessionId/)
  })

  it('returns 400 for missing message', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Cookie', authCookie)
      .send({ sessionId: 'anything' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/message/)
  })

  it('returns 404 for unknown session', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Cookie', authCookie)
      .send({ sessionId: 'nonexistent-session', message: 'hello' })
    expect(res.status).toBe(404)
  })

  describe('with a real session', () => {
    let sessionId: string

    beforeAll(async () => {
      const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })
      sessionId = ses.body.id
    })

    it('streams SSE with correct content-type', async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Cookie', authCookie)
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

    it('emits a title event on the first message', async () => {
      const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })

      const res = await request(app)
        .post('/api/chat')
        .set('Cookie', authCookie)
        .send({ sessionId: ses.body.id, message: 'first message here' })
        .buffer(true)
        .parse((res, done) => {
          let data = ''
          res.on('data', (chunk: Buffer) => { data += chunk.toString() })
          res.on('end', () => done(null, data))
        })

      expect(res.body as string).toContain('event: title')
    })

    it('persists user and assistant messages', async () => {
      const ses = await request(app).post('/api/sessions').set('Cookie', authCookie).send({ projectId: sharedProjectId })

      await request(app)
        .post('/api/chat')
        .set('Cookie', authCookie)
        .send({ sessionId: ses.body.id, message: 'persist me' })
        .buffer(true)
        .parse((res, done) => {
          let data = ''
          res.on('data', (chunk: Buffer) => { data += chunk.toString() })
          res.on('end', () => done(null, data))
        })

      const msgs = await request(app)
        .get(`/api/sessions/${ses.body.id}/messages`)
        .set('Cookie', authCookie)
      expect(msgs.body).toHaveLength(2)
      expect(msgs.body[0].role).toBe('user')
      expect(msgs.body[0].content).toBe('persist me')
      expect(msgs.body[1].role).toBe('assistant')
      expect(msgs.body[1].content).toBe('Hello world')
    })
  })
})
