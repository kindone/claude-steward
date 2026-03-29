// Feature:     File Browser
// Arch/Design: PATCH /api/projects/:id/files uses mtime-based optimistic locking
//              and atomic write (temp file + rename) to prevent data loss
// Spec:        ∀ write without lastModified: 200, file created/updated
//              ∀ write with current mtime: 200, content updated, new mtime returned
//              ∀ write with stale mtime: 409 conflict, file unchanged
//              ∀ write with force=true: 200 regardless of mtime
//              ∀ invalid input (missing path/content, traversal): 400
// @quality:    correctness, reliability
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../app.js'
import { authSessionQueries, projectQueries } from '../../db/index.js'
import { v4 as uuidv4 } from 'uuid'

const app = createApp()
const TEST_TOKEN = 'file-write-test-token'
authSessionQueries.create(TEST_TOKEN)
const authCookie = `sid=${TEST_TOKEN}`

let projectId: string
let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-write-test-'))
  projectId = uuidv4()
  projectQueries.create(projectId, 'file-write-test', tmpDir)
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

async function patchFile(
  relPath: string,
  content: string,
  opts: { lastModified?: number; force?: boolean } = {}
) {
  return request(app)
    .patch(`/api/projects/${projectId}/files`)
    .set('Cookie', authCookie)
    .send({ path: relPath, content, ...opts })
}

describe('PATCH /api/projects/:id/files', () => {

  describe('producer guarantees (file write route)', () => {
    it('creates a new file and returns lastModified', async () => {
      const res = await patchFile('new-file.txt', 'hello')
      expect(res.status).toBe(200)
      expect(typeof res.body.lastModified).toBe('number')
      expect(res.body.lastModified).toBeGreaterThan(0)
      expect(fs.readFileSync(path.join(tmpDir, 'new-file.txt'), 'utf8')).toBe('hello')
    })

    it('updates existing file when no lastModified supplied', async () => {
      fs.writeFileSync(path.join(tmpDir, 'update-me.txt'), 'original')
      const res = await patchFile('update-me.txt', 'updated')
      expect(res.status).toBe(200)
      expect(fs.readFileSync(path.join(tmpDir, 'update-me.txt'), 'utf8')).toBe('updated')
    })

    it('updates file when lastModified matches current mtime', async () => {
      const filePath = path.join(tmpDir, 'mtime-match.txt')
      fs.writeFileSync(filePath, 'original')
      const mtime = Math.floor(fs.statSync(filePath).mtimeMs)

      const res = await patchFile('mtime-match.txt', 'updated', { lastModified: mtime })
      expect(res.status).toBe(200)
      expect(fs.readFileSync(filePath, 'utf8')).toBe('updated')
    })

    it('returns 409 conflict when lastModified is stale', async () => {
      const filePath = path.join(tmpDir, 'stale-mtime.txt')
      fs.writeFileSync(filePath, 'original')
      const staleMtime = Math.floor(fs.statSync(filePath).mtimeMs) - 1000

      const res = await patchFile('stale-mtime.txt', 'should not write', { lastModified: staleMtime })
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('conflict')
      expect(typeof res.body.serverModified).toBe('number')
      // File must be unchanged
      expect(fs.readFileSync(filePath, 'utf8')).toBe('original')
    })

    it('force=true overrides stale mtime — always writes', async () => {
      const filePath = path.join(tmpDir, 'force-write.txt')
      fs.writeFileSync(filePath, 'original')
      const staleMtime = Math.floor(fs.statSync(filePath).mtimeMs) - 1000

      const res = await patchFile('force-write.txt', 'forced', { lastModified: staleMtime, force: true })
      expect(res.status).toBe(200)
      expect(fs.readFileSync(filePath, 'utf8')).toBe('forced')
    })

    it('returned lastModified reflects the new mtime after write', async () => {
      const filePath = path.join(tmpDir, 'mtime-return.txt')
      fs.writeFileSync(filePath, 'before')
      const before = Math.floor(fs.statSync(filePath).mtimeMs)

      const res = await patchFile('mtime-return.txt', 'after')
      expect(res.status).toBe(200)
      const returned = res.body.lastModified as number
      const actual = Math.floor(fs.statSync(filePath).mtimeMs)
      expect(returned).toBe(actual)
      expect(returned).toBeGreaterThanOrEqual(before)
    })
  })

  describe('consumer assumptions (validation)', () => {
    it('returns 400 when path is missing', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/files`)
        .set('Cookie', authCookie)
        .send({ content: 'hello' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when content is missing', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/files`)
        .set('Cookie', authCookie)
        .send({ path: 'file.txt' })
      expect(res.status).toBe(400)
    })

    it('returns 400 for path traversal attempt', async () => {
      const res = await patchFile('../../etc/passwd', 'evil')
      expect(res.status).toBe(400)
    })

    it('returns 404 for unknown project', async () => {
      const res = await request(app)
        .patch(`/api/projects/nonexistent-id/files`)
        .set('Cookie', authCookie)
        .send({ path: 'file.txt', content: 'hello' })
      expect(res.status).toBe(404)
    })
  })

})
