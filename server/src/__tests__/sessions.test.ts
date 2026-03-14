import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.js'

const app = createApp()
const auth = { Authorization: 'Bearer test-key' }

describe('POST /api/sessions', () => {
  it('creates a session with no project', async () => {
    const res = await request(app).post('/api/sessions').set(auth).send({})
    expect(res.status).toBe(201)
    expect(res.body.title).toBe('New Chat')
    expect(res.body.project_id).toBeNull()
    expect(res.body.id).toBeTruthy()
  })

  it('creates a session scoped to a project', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-s-'))
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: 'p', path: tmpDir })
    expect(proj.status).toBe(201)

    const ses = await request(app)
      .post('/api/sessions')
      .set(auth)
      .send({ projectId: proj.body.id })
    expect(ses.status).toBe(201)
    expect(ses.body.project_id).toBe(proj.body.id)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('GET /api/sessions', () => {
  it('returns all sessions when no filter', async () => {
    const res = await request(app).get('/api/sessions').set(auth)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('filters sessions by projectId', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-sf-'))
    const proj = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ name: 'filter-test', path: tmpDir })

    // Create session in this project
    await request(app)
      .post('/api/sessions')
      .set(auth)
      .send({ projectId: proj.body.id })

    // Create session with no project
    await request(app).post('/api/sessions').set(auth).send({})

    const filtered = await request(app)
      .get(`/api/sessions?projectId=${proj.body.id}`)
      .set(auth)
    expect(filtered.status).toBe(200)
    expect(filtered.body.every((s: { project_id: string }) => s.project_id === proj.body.id)).toBe(true)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('DELETE /api/sessions/:id', () => {
  let sessionId: string

  beforeAll(async () => {
    const res = await request(app).post('/api/sessions').set(auth).send({})
    sessionId = res.body.id
  })

  it('deletes the session', async () => {
    const res = await request(app)
      .delete(`/api/sessions/${sessionId}`)
      .set(auth)
    expect(res.status).toBe(204)
  })

  it('returns 404 for already-deleted session', async () => {
    const res = await request(app)
      .delete(`/api/sessions/${sessionId}`)
      .set(auth)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/sessions/:id/messages', () => {
  it('returns empty array for new session', async () => {
    const create = await request(app).post('/api/sessions').set(auth).send({})
    const msgs = await request(app)
      .get(`/api/sessions/${create.body.id}/messages`)
      .set(auth)
    expect(msgs.status).toBe(200)
    expect(msgs.body).toEqual([])
  })

  it('returns 404 for unknown session', async () => {
    const res = await request(app)
      .get('/api/sessions/nonexistent/messages')
      .set(auth)
    expect(res.status).toBe(404)
  })
})
