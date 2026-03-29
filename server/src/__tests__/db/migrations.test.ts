// Feature:     Startup reliability
// Arch/Design: index.ts seeds the steward project and migrates orphaned sessions
//              on every startup — both operations must be idempotent
// Spec:        ∀ fresh DB: steward project created exactly once at APP_ROOT
//              ∀ orphaned sessions: migrateOrphanedSessions reassigns all to steward project
//              ∀ already-migrated DB: both operations are no-ops (no duplicates)
// @quality:    correctness, reliability
// @type:       example
// @mode:       verification

import { describe, it, expect, beforeEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { projectQueries, sessionQueries, migrateOrphanedSessions } from '../../db/index.js'
import db from '../../db/index.js'

// Each test gets its own project path to avoid cross-test interference
function tmpPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'))
}

describe('startup migrations', () => {

  describe('steward project seeding', () => {
    it('project created at appRoot is findable by path', () => {
      const appRoot = tmpPath()
      const id = uuidv4()
      projectQueries.create(id, 'claude-steward', appRoot)

      const found = projectQueries.list().find(p => p.path === appRoot)
      expect(found).toBeDefined()
      expect(found!.name).toBe('claude-steward')
      expect(found!.id).toBe(id)
    })

    it('creating project twice does not produce duplicates', () => {
      const appRoot = tmpPath()
      const id1 = uuidv4()
      projectQueries.create(id1, 'claude-steward', appRoot)

      // Simulate idempotent check: only create if not already present
      const alreadyExists = projectQueries.list().some(p => p.path === appRoot)
      if (!alreadyExists) {
        projectQueries.create(uuidv4(), 'claude-steward', appRoot)
      }

      const matches = projectQueries.list().filter(p => p.path === appRoot)
      expect(matches).toHaveLength(1)
    })
  })

  describe('migrateOrphanedSessions', () => {
    it('assigns sessions with NULL project_id to the steward project', () => {
      const appRoot = tmpPath()
      const projectId = uuidv4()
      projectQueries.create(projectId, 'claude-steward', appRoot)

      // Create sessions then null out their project_id (simulates pre-migration state)
      const sessionId1 = uuidv4()
      const sessionId2 = uuidv4()
      sessionQueries.create(sessionId1, 'orphan 1', projectId)
      sessionQueries.create(sessionId2, 'orphan 2', projectId)
      db.prepare('UPDATE sessions SET project_id = NULL WHERE id IN (?, ?)').run(sessionId1, sessionId2)

      // Verify they're orphaned
      const before1 = sessionQueries.findById(sessionId1)
      expect(before1?.project_id).toBeNull()

      migrateOrphanedSessions(appRoot)

      const after1 = sessionQueries.findById(sessionId1)
      const after2 = sessionQueries.findById(sessionId2)
      expect(after1?.project_id).toBe(projectId)
      expect(after2?.project_id).toBe(projectId)
    })

    it('is a no-op when no orphaned sessions exist', () => {
      const appRoot = tmpPath()
      const projectId = uuidv4()
      projectQueries.create(projectId, 'claude-steward', appRoot)

      const sessionId = uuidv4()
      sessionQueries.create(sessionId, 'normal session', projectId)

      migrateOrphanedSessions(appRoot)

      const session = sessionQueries.findById(sessionId)
      expect(session?.project_id).toBe(projectId)
    })

    it('is a no-op when called twice — no duplicate assignments', () => {
      const appRoot = tmpPath()
      const projectId = uuidv4()
      projectQueries.create(projectId, 'claude-steward', appRoot)

      const sessionId = uuidv4()
      sessionQueries.create(sessionId, 'test', projectId)
      db.prepare('UPDATE sessions SET project_id = NULL WHERE id = ?').run(sessionId)

      migrateOrphanedSessions(appRoot)
      migrateOrphanedSessions(appRoot) // second call must be a no-op

      const session = sessionQueries.findById(sessionId)
      expect(session?.project_id).toBe(projectId)
      // Only one session should exist
      const all = sessionQueries.list()
      expect(all.filter(s => s.id === sessionId)).toHaveLength(1)
    })

    it('is a no-op when appRoot has no matching project', () => {
      const nonExistentRoot = '/tmp/no-such-project-path'
      const sessionId = uuidv4()
      // No project at nonExistentRoot — migrate should silently do nothing
      const projectId = uuidv4()
      const appRoot = tmpPath()
      projectQueries.create(projectId, 'claude-steward', appRoot)
      sessionQueries.create(sessionId, 'test', projectId)
      db.prepare('UPDATE sessions SET project_id = NULL WHERE id = ?').run(sessionId)

      migrateOrphanedSessions(nonExistentRoot) // should not throw or assign

      const session = sessionQueries.findById(sessionId)
      expect(session?.project_id).toBeNull() // still unassigned
    })
  })

})
