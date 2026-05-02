/**
 * Internal-only routes — reachable only from localhost (127.0.0.1 / ::1).
 * No session cookie required. Useful for programmatic setup by Claude or scripts.
 *
 * Mounted at /api/internal (BEFORE requireAuth in app.ts).
 *
 * POST /api/internal/register-app
 *   Register a mini-app (project + app_config) in one call.
 *   Body:
 *     project      string  — project name (looked up or created)
 *     projectPath  string  — filesystem path (required when creating a new project)
 *     name         string  — app display name
 *     type         string  — e.g. "docs", "notebook" (default: "docs")
 *     commandTemplate string — must contain {port}
 *     workDir      string  — must be an existing directory
 *   Returns: { project, appConfig }
 *
 * Example (from within the server host):
 *   curl -s -X POST http://localhost:3001/api/internal/register-app \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "project": "claude-steward",
 *       "name": "learn-crdt",
 *       "type": "docs",
 *       "commandTemplate": "node /path/to/claude-steward/apps/docs/dist/server.js {port} --docs-dir /path/to/your-docs",
 *       "workDir": "/path/to/your-docs"
 *     }'
 */

import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { projectQueries, appConfigQueries } from '../db/index.js'

const router = Router()

// Middleware: reject non-localhost requests
function localhostOnly(req: Request, res: Response, next: () => void): void {
  const ip = req.ip ?? ''
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  if (!isLocal) {
    res.status(403).json({ error: 'Internal routes are localhost-only' })
    return
  }
  next()
}

router.use(localhostOnly)

router.post('/register-app', (req: Request, res: Response) => {
  const { project, projectPath, name, type = 'docs', commandTemplate, workDir } = req.body as {
    project?: string
    projectPath?: string
    name?: string
    type?: string
    commandTemplate?: string
    workDir?: string
  }

  // Validate
  if (!project?.trim())          return void res.status(400).json({ error: '"project" is required' })
  if (!name?.trim())             return void res.status(400).json({ error: '"name" is required' })
  if (!commandTemplate?.trim())  return void res.status(400).json({ error: '"commandTemplate" is required' })
  if (!workDir?.trim())          return void res.status(400).json({ error: '"workDir" is required' })
  if (!commandTemplate.includes('{port}')) {
    return void res.status(400).json({ error: '"commandTemplate" must contain {port}' })
  }
  if (!fs.existsSync(workDir)) {
    return void res.status(400).json({ error: `workDir does not exist: ${workDir}` })
  }

  // Find or create project
  let proj = projectQueries.findByName(project.trim())
  if (!proj) {
    if (!projectPath?.trim()) {
      return void res.status(400).json({ error: `Project "${project}" not found. Provide "projectPath" to create it.` })
    }
    proj = projectQueries.create(randomUUID(), project.trim(), projectPath.trim())
  }

  // Create app config
  const appConfig = appConfigQueries.create(
    randomUUID(),
    proj.id,
    name.trim(),
    type.trim(),
    commandTemplate.trim(),
    workDir.trim(),
  )

  res.status(201).json({ project: proj, appConfig })
})

export default router
