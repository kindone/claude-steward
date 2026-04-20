// Feature:     Topics — one-level directories for organizing artifacts
// Arch/Design: /api/projects/:projectId/topics and /api/topics/:topicId
//              Artifacts carry topic_id; ON DELETE SET NULL moves them to root
// Spec:        POST /topics → 201 with topic; GET /topics lists in order
//              PATCH /topics/:id renames; DELETE /topics/:id → 204, artifacts to root
//              PATCH /artifacts/:id with topic_id moves artifact into topic
//              DELETE topic → all its artifacts have topic_id = null
// @quality:    correctness
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.js'
import { authSessionQueries } from '../db/index.js'

const app = createApp()

const TEST_TOKEN = 'topics-test-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

let projectId: string
let tmpDir: string

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-topics-'))
  const proj = await request(app)
    .post('/api/projects')
    .set('Cookie', authCookie)
    .send({ name: 'topics-test', path: tmpDir })
  projectId = proj.body.id
})

// ── Helper: create an artifact in the project ─────────────────────────────────

async function createArtifact(name = 'test-artifact') {
  const res = await request(app)
    .post(`/api/projects/${projectId}/artifacts`)
    .set('Cookie', authCookie)
    .send({ name, type: 'code', content: '// hello', metadata: { language: 'javascript' } })
  expect(res.status).toBe(201)
  return res.body as { id: string; topic_id: string | null; name: string }
}

// ── POST /api/projects/:projectId/topics ──────────────────────────────────────

describe('POST /api/projects/:projectId/topics', () => {
  it('creates a topic and returns 201', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/topics`)
      .set('Cookie', authCookie)
      .send({ name: 'My Topic' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'My Topic', project_id: projectId })
    expect(res.body.id).toBeTruthy()
    expect(res.body.created_at).toBeTypeOf('number')
  })

  it('rejects missing name with 400', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/topics`)
      .set('Cookie', authCookie)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name/)
  })

  it('rejects empty name with 400', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/topics`)
      .set('Cookie', authCookie)
      .send({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown project', async () => {
    const res = await request(app)
      .post('/api/projects/nonexistent-id/topics')
      .set('Cookie', authCookie)
      .send({ name: 'x' })
    expect(res.status).toBe(404)
  })
})

// ── GET /api/projects/:projectId/topics ───────────────────────────────────────

describe('GET /api/projects/:projectId/topics', () => {
  it('returns list of topics for the project', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/topics`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    // We created at least one in the POST tests
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('returns 404 for unknown project', async () => {
    const res = await request(app)
      .get('/api/projects/nonexistent-id/topics')
      .set('Cookie', authCookie)
    expect(res.status).toBe(404)
  })
})

// ── PATCH /api/topics/:topicId ────────────────────────────────────────────────

describe('PATCH /api/topics/:topicId', () => {
  let topicId: string

  beforeAll(async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/topics`)
      .set('Cookie', authCookie)
      .send({ name: 'Rename Me' })
    topicId = res.body.id
  })

  it('renames the topic', async () => {
    const res = await request(app)
      .patch(`/api/topics/${topicId}`)
      .set('Cookie', authCookie)
      .send({ name: 'Renamed Topic' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Renamed Topic')
  })

  it('rejects empty name with 400', async () => {
    const res = await request(app)
      .patch(`/api/topics/${topicId}`)
      .set('Cookie', authCookie)
      .send({ name: '' })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown topic', async () => {
    const res = await request(app)
      .patch('/api/topics/nonexistent-topic-id')
      .set('Cookie', authCookie)
      .send({ name: 'x' })
    expect(res.status).toBe(404)
  })
})

// ── DELETE /api/topics/:topicId ───────────────────────────────────────────────

describe('DELETE /api/topics/:topicId', () => {
  it('deletes a topic and returns 204', async () => {
    const create = await request(app)
      .post(`/api/projects/${projectId}/topics`)
      .set('Cookie', authCookie)
      .send({ name: 'Delete Me' })
    expect(create.status).toBe(201)

    const del = await request(app)
      .delete(`/api/topics/${create.body.id}`)
      .set('Cookie', authCookie)
    expect(del.status).toBe(204)
  })

  it('returns 404 for unknown topic', async () => {
    const res = await request(app)
      .delete('/api/topics/nonexistent-id')
      .set('Cookie', authCookie)
    expect(res.status).toBe(404)
  })
})

// ── Move artifact into a topic ────────────────────────────────────────────────

describe('Move artifact to topic via PATCH /api/artifacts/:artifactId', () => {
  let topicId: string
  let artifactId: string

  beforeAll(async () => {
    const t = await request(app)
      .post(`/api/projects/${projectId}/topics`)
      .set('Cookie', authCookie)
      .send({ name: 'Move Target' })
    topicId = t.body.id

    const a = await createArtifact('movable-artifact')
    artifactId = a.id
  })

  it('artifact starts with topic_id = null', async () => {
    const res = await request(app)
      .get(`/api/artifacts/${artifactId}`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
    expect(res.body.topic_id).toBeNull()
  })

  it('moves artifact into topic', async () => {
    const res = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', authCookie)
      .send({ topic_id: topicId })
    expect(res.status).toBe(200)

    // Confirm via GET
    const get = await request(app)
      .get(`/api/artifacts/${artifactId}`)
      .set('Cookie', authCookie)
    expect(get.body.topic_id).toBe(topicId)
  })

  it('moves artifact back to root (topic_id = null)', async () => {
    const res = await request(app)
      .patch(`/api/artifacts/${artifactId}`)
      .set('Cookie', authCookie)
      .send({ topic_id: null })
    expect(res.status).toBe(200)

    const get = await request(app)
      .get(`/api/artifacts/${artifactId}`)
      .set('Cookie', authCookie)
    expect(get.body.topic_id).toBeNull()
  })
})

// ── Delete topic → artifacts move to root (ON DELETE SET NULL) ────────────────

describe('Delete topic returns artifacts to root', () => {
  it('artifacts get topic_id = null after topic is deleted', async () => {
    // Create a topic
    const t = await request(app)
      .post(`/api/projects/${projectId}/topics`)
      .set('Cookie', authCookie)
      .send({ name: 'Transient Topic' })
    const topicId: string = t.body.id

    // Create two artifacts and move them into the topic
    const a1 = await createArtifact('art-cascade-1')
    const a2 = await createArtifact('art-cascade-2')

    await request(app)
      .patch(`/api/artifacts/${a1.id}`)
      .set('Cookie', authCookie)
      .send({ topic_id: topicId })
    await request(app)
      .patch(`/api/artifacts/${a2.id}`)
      .set('Cookie', authCookie)
      .send({ topic_id: topicId })

    // Confirm they are in the topic
    const before1 = await request(app).get(`/api/artifacts/${a1.id}`).set('Cookie', authCookie)
    const before2 = await request(app).get(`/api/artifacts/${a2.id}`).set('Cookie', authCookie)
    expect(before1.body.topic_id).toBe(topicId)
    expect(before2.body.topic_id).toBe(topicId)

    // Delete the topic
    const del = await request(app)
      .delete(`/api/topics/${topicId}`)
      .set('Cookie', authCookie)
    expect(del.status).toBe(204)

    // Artifacts should now have topic_id = null
    const after1 = await request(app).get(`/api/artifacts/${a1.id}`).set('Cookie', authCookie)
    const after2 = await request(app).get(`/api/artifacts/${a2.id}`).set('Cookie', authCookie)
    expect(after1.body.topic_id).toBeNull()
    expect(after2.body.topic_id).toBeNull()
  })
})
