import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { requireApiKey } from './auth/middleware.js'
import chatRouter from './routes/chat.js'
import sessionsRouter from './routes/sessions.js'
import projectsRouter from './routes/projects.js'
import eventsRouter from './routes/events.js'
import adminRouter from './routes/admin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NODE_ENV = process.env.NODE_ENV ?? 'development'

export function createApp() {
  const app = express()

  app.use(express.json())

  if (NODE_ENV === 'development') {
    app.use(cors({ origin: 'http://localhost:5173' }))
  }

  app.use('/api', requireApiKey)
  app.use('/api/chat', chatRouter)
  app.use('/api/sessions', sessionsRouter)
  app.use('/api/projects', projectsRouter)
  app.use('/api/events', eventsRouter)
  app.use('/api/admin', adminRouter)

  if (NODE_ENV === 'production') {
    const publicDir = path.join(__dirname, '../public')
    app.use(express.static(publicDir))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'))
    })
  }

  return app
}
