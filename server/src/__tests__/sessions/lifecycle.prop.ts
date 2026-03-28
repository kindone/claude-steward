// Feature:     Session management
// Arch/Design: Sessions are scoped to projects; CRUD operations must maintain
//              referential integrity and count consistency across arbitrary sequences
// Spec:        ∀ create/delete sequences: DB session count always matches tracked count
//              ∀ sequences: all sessions remain scoped to their project
//              ∀ sequences: deleted sessions never reappear in list
// @quality:    correctness, reliability
// @type:       stateful
// @mode:       verification

import { describe, it } from 'vitest'
import {
  Arbitrary, Shrinkable, SimpleAction, simpleStatefulProperty,
  Gen,
} from 'jsproptest'
import { v4 as uuidv4 } from 'uuid'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sessionQueries, projectQueries } from '../../db/index.js'
import type { Session } from '../../db/index.js'

// ── State and model ───────────────────────────────────────────────────────────

interface SessionState {
  projectId: string
  /** Session IDs created during this run (active = not yet deleted). */
  activeIds: Set<string>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertInvariants(state: SessionState): void {
  const rows = sessionQueries.listByProject(state.projectId) as Session[]

  // Count invariant
  if (rows.length !== state.activeIds.size) {
    throw new Error(
      `Count mismatch: DB has ${rows.length}, model has ${state.activeIds.size}`
    )
  }

  // Scoping invariant: all rows belong to our project
  const foreign = rows.filter(r => r.project_id !== state.projectId)
  if (foreign.length > 0) {
    throw new Error(`Sessions scoped to wrong project: ${foreign.map(r => r.id).join(', ')}`)
  }

  // No-resurrection invariant: active IDs in model must match DB IDs
  const dbIds = new Set(rows.map(r => r.id))
  for (const id of state.activeIds) {
    if (!dbIds.has(id)) {
      throw new Error(`Session ${id} in model but missing from DB`)
    }
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

const createAction = new SimpleAction<SessionState>((state) => {
  const id = uuidv4()
  sessionQueries.create(id, 'New Chat', state.projectId)
  state.activeIds.add(id)
  assertInvariants(state)
}, 'create')

const deleteAction = new SimpleAction<SessionState>((state) => {
  const id = [...state.activeIds][0]
  sessionQueries.delete(id)
  state.activeIds.delete(id)
  assertInvariants(state)
}, 'delete-oldest')

// ── Property ──────────────────────────────────────────────────────────────────

describe('session lifecycle — stateful property', () => {

  it('count, scoping, and no-resurrection invariants hold across random create/delete sequences', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-prop-'))

    // initialGen: fresh isolated project for each test run
    const initialGen = new Arbitrary<SessionState>((_rand) => {
      const projectId = uuidv4()
      projectQueries.create(projectId, 'prop-test', tmpDir)
      return new Shrinkable<SessionState>({ projectId, activeIds: new Set() })
    })

    simpleStatefulProperty<SessionState>(
      initialGen,
      Gen.simpleActionOf(
        (_state: SessionState) => Gen.just(createAction),
        // Only offer deleteAction when sessions exist; fall back to create otherwise
        (state: SessionState) => Gen.just(
          state.activeIds.size > 0 ? deleteAction : createAction
        ),
      ),
    )
      .setMinActions(5)
      .setMaxActions(20)
      .setPostCheckWithoutModel((state) => {
        // Final invariant check after entire sequence
        assertInvariants(state)
        // Cleanup: remove all sessions and the project for this run
        for (const id of state.activeIds) sessionQueries.delete(id)
        projectQueries.delete(state.projectId)
      })
      .go()
  })

})
