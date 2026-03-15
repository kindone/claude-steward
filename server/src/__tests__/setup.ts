import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { afterAll } from 'vitest'

// Must be set before any module that imports db/index.ts is loaded.
// pool: 'forks' guarantees this file runs in a fresh process per test file,
// so each file gets its own isolated database.
const workerId = process.env.VITEST_WORKER_ID ?? '0'
const tmpDb = path.join(os.tmpdir(), `steward-test-${workerId}-${Date.now()}.db`)

process.env.DATABASE_PATH = tmpDb
process.env.NODE_ENV = 'test'
process.env.CLAUDE_PATH = '/usr/bin/false'   // prevent any accidental real claude spawns

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + suffix) } catch { /* already gone */ }
  }
})
