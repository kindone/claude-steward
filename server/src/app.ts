import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { requireAuth } from './auth/middleware.js'
import authRouter from './routes/auth.js'
import chatRouter from './routes/chat.js'
import sessionsRouter from './routes/sessions.js'
import projectsRouter from './routes/projects.js'
import eventsRouter from './routes/events.js'
import adminRouter from './routes/admin.js'
import pushRouter, { vapidPublicKeyHandler } from './routes/push.js'
import schedulesRouter from './routes/schedules.js'
import evalRouter from './routes/eval.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Monorepo root — two levels up from server/src/
const APP_ROOT = path.resolve(__dirname, '../..')
const NODE_ENV = process.env.NODE_ENV ?? 'development'

export function createApp() {
  const app = express()

  app.use(express.json())
  app.use(cookieParser())

  if (NODE_ENV === 'development') {
    const allowedOrigins = ['http://localhost:5173', 'http://localhost:3001', 'http://localhost:3002']
    if (process.env.APP_DOMAIN) {
      allowedOrigins.push(`https://${process.env.APP_DOMAIN}`)
      allowedOrigins.push(`https://dev.${process.env.APP_DOMAIN}`)
    }
    app.use(cors({ origin: allowedOrigins, credentials: true }))
  }

  // Public endpoints — no auth required
  app.get('/api/meta', (_req, res) => {
    res.json({ appRoot: APP_ROOT })
  })
  app.use('/api/auth', authRouter)

  // Public: VAPID public key only (required for push subscription; not a secret).
  app.get('/api/push/vapid-public-key', vapidPublicKeyHandler)

  // Eval relay — has its own auth (API key OR session cookie) so Claude can call it
  // with just a Bearer token without going through the login flow.
  app.use('/api/eval', evalRouter)

  app.use('/api', requireAuth)
  app.use('/api/chat', chatRouter)
  app.use('/api/sessions', sessionsRouter)
  app.use('/api/projects', projectsRouter)
  app.use('/api/events', eventsRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/push', pushRouter)
  app.use('/api/schedules', schedulesRouter)

  if (NODE_ENV === 'production') {
    const publicDir = path.join(__dirname, '../public')
    app.use(express.static(publicDir))
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'))
    })
  }

  return app
}
