import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.resolve(__dirname, '../server/steward.db')
const db = new DatabaseSync(dbPath)

const session = db.prepare(
  `SELECT id FROM auth_sessions WHERE expires_at > unixepoch() LIMIT 1`
).get()

if (!session) {
  console.error('No valid auth session found')
  process.exit(1)
}

const res = await fetch('http://localhost:3001/api/admin/reload', {
  method: 'POST',
  headers: { Cookie: `session=${session.id}` },
})
const body = await res.json()
console.log(res.status, JSON.stringify(body))
