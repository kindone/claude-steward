import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createApp } from './app.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// .env lives in the monorepo root (two levels up from server/src/)
dotenv.config({ path: path.join(__dirname, '../../.env') })

const PORT = parseInt(process.env.PORT ?? '3001', 10)

const app = createApp()
app.listen(PORT, () => {
  console.log(`claude-steward server running on http://localhost:${PORT}`)
})
