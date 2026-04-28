#!/usr/bin/env node
// Restart steward-worker with graceful drain via the /api/admin/restart-worker
// endpoint. Mirrors scripts/reload.mjs — picks up the most recent valid auth
// session from the DB to authenticate the request.
//
// Why an endpoint instead of `pm2 restart` directly: the worker drain logic
// only kicks in when SIGINT/SIGTERM arrives via PM2 (which honors
// ecosystem.config.cjs's kill_timeout=90s). Calling the endpoint also
// decouples the restart trigger from the chat process tree, so an agent can
// invoke this from inside a worker-hosted session without killing its own
// in-flight response — the drain handles that.
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, '../server/steward.db')
const db = new DatabaseSync(dbPath)

const session = db.prepare(
  `SELECT id FROM auth_sessions
   WHERE expires_at > unixepoch()
   ORDER BY COALESCE(last_seen_at, created_at) DESC
   LIMIT 1`
).get()

if (!session) {
  console.error('No valid auth session found')
  process.exit(1)
}

// The auth middleware reads the cookie named "sid" — see server/src/auth/session.ts.
const res = await fetch('http://localhost:3001/api/admin/restart-worker', {
  method: 'POST',
  headers: { Cookie: `sid=${session.id}` },
})
const body = await res.json()
console.log(res.status, JSON.stringify(body))
