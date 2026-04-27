#!/usr/bin/env node
// Print recovery context for a steward chat session that may have been
// interrupted by a rate-limit / session-expired event.
//
// Usage:
//   node scripts/recover.mjs                # most recently updated session
//   node scripts/recover.mjs <session_id>   # specific session
//   node scripts/recover.mjs --limit=12     # number of recent messages (default 6)
//   node scripts/recover.mjs --full         # print full content (default truncates)
//
// Designed to be invoked by Claude after the user hints a limit was hit
// ("we hit the limit again", "recover from db", etc.) — see CLAUDE.md
// → "Working Conventions" → "Rate-limit recovery".

import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Respect an inherited DATABASE_PATH so this script works in containers
// (where the DB lives on a named volume at /data/steward.db) and on hosts
// (where it lives next to the source). Without this, node:sqlite silently
// creates a fresh empty DB at the fallback path and the script reports
// "0 messages / DB empty" — which is what tripped up the in-container
// rate-limit-recovery flow.
const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../server/steward.db')
const db = new DatabaseSync(dbPath)

const args = process.argv.slice(2)
let sessionId = null
let limit = 6
let full = false
for (const a of args) {
  if (a === '--full') full = true
  else if (a.startsWith('--limit=')) limit = Math.max(1, parseInt(a.slice(8), 10) || 6)
  else if (!a.startsWith('--')) sessionId = a
}

const session = sessionId
  ? db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId)
  : db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1').get()

if (!session) {
  console.error(sessionId ? `Session ${sessionId} not found` : 'No sessions in DB')
  process.exit(1)
}

const fmt = (ts) => new Date(ts * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
const trim = (s) => {
  if (full) return s
  const cleaned = s.replace(/\s+/g, ' ').trim()
  return cleaned.length > 600 ? cleaned.slice(0, 600) + '…' : cleaned
}

console.log(`Session: ${session.id}`)
console.log(`Title:   ${session.title}`)
console.log(`Updated: ${fmt(session.updated_at)}`)
const totalCount = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE session_id = ?').get(session.id).c
console.log(`Total messages: ${totalCount}`)

// Surface every limit hit, most recent first.
const limitHits = db.prepare(
  `SELECT id, content, created_at FROM messages
   WHERE session_id = ? AND error_code = 'session_expired'
   ORDER BY created_at DESC`,
).all(session.id)

if (limitHits.length === 0) {
  console.log('Limit hits:    none')
} else {
  console.log(`Limit hits:    ${limitHits.length}`)
  for (const h of limitHits.slice(0, 5)) {
    console.log(`  ${fmt(h.created_at)}  ${h.content.replace(/\n/g, ' ')}`)
  }
}

// Identify the unanswered user prompt, if any: a user message that has no
// successful assistant message after it (skipping limit-hit error stubs).
const lastUser = db.prepare(
  `SELECT id, content, created_at FROM messages
   WHERE session_id = ? AND role = 'user'
   ORDER BY created_at DESC LIMIT 1`,
).get(session.id)
const lastAssistant = db.prepare(
  `SELECT id, content, status, error_code, created_at FROM messages
   WHERE session_id = ? AND role = 'assistant'
   ORDER BY created_at DESC LIMIT 1`,
).get(session.id)

let unanswered = null
if (lastUser && (!lastAssistant || lastAssistant.created_at < lastUser.created_at || lastAssistant.error_code === 'session_expired' || lastAssistant.status === 'streaming')) {
  unanswered = lastUser
}
if (unanswered) {
  console.log()
  console.log('Unanswered user prompt:')
  console.log(`  [${fmt(unanswered.created_at)}] ${trim(unanswered.content)}`)
}

console.log()
console.log(`Last ${limit} messages (oldest → newest):`)
const recent = db.prepare(
  `SELECT role, status, error_code, content, created_at FROM messages
   WHERE session_id = ?
   ORDER BY created_at DESC LIMIT ?`,
).all(session.id, limit).reverse()

for (const m of recent) {
  const tag = m.error_code
    ? `[ERR=${m.error_code}]`
    : m.status === 'streaming'
      ? '[streaming]'
      : ''
  console.log('---')
  console.log(`${fmt(m.created_at)}  ${m.role}  ${tag}`)
  if (m.content) console.log(trim(m.content))
}
