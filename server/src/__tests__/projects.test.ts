// Feature:     Project management, File browser
// Arch/Design: safeResolvePath is the single containment boundary for all file access
// Spec:        ∀ file path request: result is within project root OR request rejected
//              ∀ path traversal attempt (../, encoded): 400 — never resolves outside root
//              ∀ project CRUD: persisted fields match submitted; delete is clean
// @quality:    security, correctness
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.js'
import { authSessionQueries } from '../db/index.js'

const app = createApp()

const TEST_TOKEN = 'projects-test-session-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

// Temp directory used for file listing tests
let tmpProjectDir: string
let tmpSubDir: string
let tmpFile: string

beforeAll(() => {
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-proj-'))
  tmpSubDir = path.join(tmpProjectDir, 'src')
  fs.mkdirSync(tmpSubDir)
  tmpFile = path.join(tmpProjectDir, 'README.md')
  fs.writeFileSync(tmpFile, '# Test project\n')
  // Hidden file for `?showHidden` tests — must not appear in default listings.
  fs.writeFileSync(path.join(tmpProjectDir, '.env'), 'SECRET=value\n')
})

afterAll(() => {
  fs.rmSync(tmpProjectDir, { recursive: true, force: true })
})

describe('POST /api/projects', () => {
  it('creates a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie)
      .send({ name: 'test-project', path: tmpProjectDir })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'test-project', path: tmpProjectDir })
    expect(res.body.id).toBeTruthy()
  })

  it('rejects missing name', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie)
      .send({ path: tmpProjectDir })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name/)
  })

  it('rejects missing path', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie)
      .send({ name: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/path/)
  })

  it('rejects nonexistent path', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie)
      .send({ name: 'x', path: '/nonexistent/path/that/does/not/exist' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/does not exist/)
  })
})

describe('GET /api/projects', () => {
  it('returns a list of projects', async () => {
    const res = await request(app).get('/api/projects').set('Cookie', authCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('DELETE /api/projects/:id', () => {
  it('deletes an existing project', async () => {
    const create = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie)
      .send({ name: 'to-delete', path: tmpProjectDir })
    expect(create.status).toBe(201)

    const del = await request(app)
      .delete(`/api/projects/${create.body.id}`)
      .set('Cookie', authCookie)
    expect(del.status).toBe(204)
  })

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/projects/nonexistent-id')
      .set('Cookie', authCookie)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/projects/:id/files — file listing', () => {
  let projectId: string

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie)
      .send({ name: 'file-test', path: tmpProjectDir })
    projectId = res.body.id
  })

  it('lists root directory', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
    const names = res.body.map((e: { name: string }) => e.name)
    expect(names).toContain('README.md')
    expect(names).toContain('src')
  })

  it('lists subdirectory', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files?path=src`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('directories sort before files', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files`)
      .set('Cookie', authCookie)
    const dirs = res.body.filter((e: { type: string }) => e.type === 'directory')
    const files = res.body.filter((e: { type: string }) => e.type === 'file')
    const dirIndex = res.body.indexOf(dirs[0])
    const fileIndex = res.body.indexOf(files[0])
    expect(dirIndex).toBeLessThan(fileIndex)
  })

  it('blocks path traversal (..)', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files?path=../..`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(400)
  })

  it('blocks encoded path traversal (%2F..%2F..)', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files?path=${encodeURIComponent('../../etc')}`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(400)
  })

  it('hides dotfiles by default', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
    const names = res.body.map((e: { name: string }) => e.name)
    expect(names).not.toContain('.env')
    expect(names).toContain('README.md')   // sanity check
  })

  it('includes dotfiles with ?showHidden=1', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files?showHidden=1`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
    const names = res.body.map((e: { name: string }) => e.name)
    expect(names).toContain('.env')
    expect(names).toContain('README.md')
  })

  it('?showHidden=true also accepted (boolean alias)', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files?showHidden=true`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
    const names = res.body.map((e: { name: string }) => e.name)
    expect(names).toContain('.env')
  })
})

describe('GET /api/projects/:id/files/content — file content', () => {
  let projectId: string

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', authCookie)
      .send({ name: 'content-test', path: tmpProjectDir })
    projectId = res.body.id
  })

  it('returns file content', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files/content?path=README.md`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(200)
    expect(res.body.content).toBe('# Test project\n')
  })

  it('returns 400 for missing path', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files/content`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(400)
  })

  it('blocks path traversal in content endpoint', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files/content?path=${encodeURIComponent('../../etc/passwd')}`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(400)
  })

  it('returns 400 when path is a directory', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/files/content?path=src`)
      .set('Cookie', authCookie)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/directory/)
  })
})
