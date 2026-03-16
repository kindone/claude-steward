import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { projectQueries, type PermissionMode } from '../db/index.js'

// Monorepo root — three directories up from server/src/routes/
const APP_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')

const router = Router()

router.get('/', (_req, res) => {
  res.json(projectQueries.list())
})

router.post('/', (req, res) => {
  const { name, path: projectPath } = req.body as { name?: string; path?: string }
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (!projectPath || typeof projectPath !== 'string') {
    res.status(400).json({ error: 'path is required' })
    return
  }

  const resolved = path.resolve(projectPath)
  if (!fs.existsSync(resolved)) {
    res.status(400).json({ error: `Path does not exist: ${resolved}` })
    return
  }
  if (!fs.statSync(resolved).isDirectory()) {
    res.status(400).json({ error: `Path is not a directory: ${resolved}` })
    return
  }

  const project = projectQueries.create(uuidv4(), name.trim(), resolved)
  res.status(201).json(project)
})

const VALID_MODES = new Set<PermissionMode>(['default', 'plan', 'acceptEdits', 'bypassPermissions'])

router.patch('/:id', (req, res) => {
  const project = projectQueries.findById(req.params.id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  const { permissionMode } = req.body as { permissionMode?: string }
  if (permissionMode !== undefined) {
    if (!VALID_MODES.has(permissionMode as PermissionMode)) {
      res.status(400).json({ error: `permissionMode must be one of: ${[...VALID_MODES].join(', ')}` })
      return
    }
    projectQueries.updatePermissionMode(permissionMode as PermissionMode, req.params.id)
    project.permission_mode = permissionMode as PermissionMode
  }
  res.json(project)
})

router.delete('/:id', (req, res) => {
  const project = projectQueries.findById(req.params.id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  if (path.resolve(project.path) === APP_ROOT) {
    res.status(403).json({ error: 'The steward project cannot be deleted' })
    return
  }
  projectQueries.delete(req.params.id)
  res.status(204).end()
})

// GET /api/projects/:id/files?path=relative/sub/path
// Returns a directory listing. Path is relative to project root; defaults to root.
router.get('/:id/files', (req, res) => {
  const project = projectQueries.findById(req.params.id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const relPath = (req.query.path as string | undefined) ?? ''
  const safePath = safeResolvePath(project.path, relPath)
  if (!safePath) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(safePath, { withFileTypes: true })
  } catch {
    res.status(404).json({ error: 'Directory not found' })
    return
  }

  const result = entries
    .filter((e) => !e.name.startsWith('.'))   // hide dotfiles by default
    .map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
      path: relPath ? `${relPath}/${e.name}` : e.name,
    }))
    .sort((a, b) => {
      // Directories first, then alphabetical
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  res.json(result)
})

// GET /api/projects/:id/files/content?path=relative/file.txt
router.get('/:id/files/content', (req, res) => {
  const project = projectQueries.findById(req.params.id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const relPath = (req.query.path as string | undefined) ?? ''
  if (!relPath) {
    res.status(400).json({ error: 'path is required' })
    return
  }

  const safePath = safeResolvePath(project.path, relPath)
  if (!safePath) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  let content: string
  let lastModified: number
  try {
    const stat = fs.statSync(safePath)
    if (stat.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory' })
      return
    }
    // Refuse files larger than 1 MB to avoid huge responses
    if (stat.size > 1_000_000) {
      res.status(413).json({ error: 'File too large to display (> 1 MB)' })
      return
    }
    content = fs.readFileSync(safePath, 'utf8')
    lastModified = Math.floor(stat.mtimeMs)
  } catch {
    res.status(404).json({ error: 'File not found' })
    return
  }

  res.json({ content, path: relPath, lastModified })
})

// PATCH /api/projects/:id/files
// Body: { path, content, lastModified?, force? }
// Atomically writes content. Uses optimistic locking: if lastModified doesn't match the
// file's current mtime, returns 409 Conflict (unless force=true).
router.patch('/:id/files', (req, res) => {
  const project = projectQueries.findById(req.params.id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const { path: relPath, content, lastModified, force } = req.body as {
    path?: string
    content?: string
    lastModified?: number
    force?: boolean
  }

  if (!relPath || typeof relPath !== 'string') {
    res.status(400).json({ error: 'path is required' })
    return
  }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content is required' })
    return
  }

  const safePath = safeResolvePath(project.path, relPath)
  if (!safePath) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  try {
    // Optimistic locking: reject if the file was modified since the client last fetched it.
    if (!force && lastModified !== undefined) {
      let serverMtime: number
      try {
        serverMtime = Math.floor(fs.statSync(safePath).mtimeMs)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        serverMtime = 0 // file doesn't exist yet — allow creation
      }
      if (serverMtime !== 0 && serverMtime !== Math.floor(lastModified)) {
        res.status(409).json({ error: 'conflict', serverModified: serverMtime })
        return
      }
    }

    // Atomic write: write to a temp file then rename into place.
    const tmpPath = `${safePath}.steward-tmp`
    fs.writeFileSync(tmpPath, content, 'utf8')
    fs.renameSync(tmpPath, safePath)

    const newMtime = Math.floor(fs.statSync(safePath).mtimeMs)
    res.json({ lastModified: newMtime })
  } catch {
    res.status(500).json({ error: 'Failed to write file' })
  }
})

// GET /api/projects/:id/files/raw?path=relative/image.png
// Serves the raw file bytes with the detected MIME type — used for image preview.
router.get('/:id/files/raw', (req, res) => {
  const project = projectQueries.findById(req.params.id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const relPath = (req.query.path as string | undefined) ?? ''
  if (!relPath) {
    res.status(400).json({ error: 'path is required' })
    return
  }

  const safePath = safeResolvePath(project.path, relPath)
  if (!safePath) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  const MIME: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
    ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif',
    pdf: 'application/pdf',
  }
  const fileExt = relPath.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME[fileExt] ?? 'application/octet-stream'

  try {
    const stat = fs.statSync(safePath)
    if (stat.isDirectory()) {
      res.status(400).json({ error: 'Path is a directory' })
      return
    }
    if (stat.size > 10_000_000) {
      res.status(413).json({ error: 'File too large' })
      return
    }
    const buf = fs.readFileSync(safePath)
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.send(buf)
  } catch {
    res.status(404).json({ error: 'File not found' })
  }
})

// POST /api/projects/:id/exec
// Body: { command: string }
// Streams stdout + stderr as SSE `event: output` chunks; `event: done` with exit code at end.
// Sets FORCE_COLOR / COLORTERM so most CLI tools emit ANSI colours even without a pty.
const EXEC_TIMEOUT_MS = 60_000

router.post('/:id/exec', (req, res) => {
  const project = projectQueries.findById(req.params.id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const { command } = req.body as { command?: string }
  if (!command?.trim()) {
    res.status(400).json({ error: 'command is required' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const child = spawn('sh', ['-c', command], {
    cwd: project.path,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      COLORTERM: 'truecolor',
      TERM: 'xterm-256color',
      COLUMNS: '120',
      LINES: '40',
    },
  })

  function sendOutput(text: string) {
    if (!res.writableEnded) res.write(`event: output\ndata: ${JSON.stringify({ text })}\n\n`)
  }

  child.stdout.on('data', (chunk: Buffer) => sendOutput(chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => sendOutput(chunk.toString()))

  child.on('close', (code) => {
    if (!res.writableEnded) {
      res.write(`event: done\ndata: ${JSON.stringify({ exitCode: code ?? 0 })}\n\n`)
      res.end()
    }
  })

  const timeout = setTimeout(() => {
    sendOutput('\r\n\x1b[33m[timed out after 60 s]\x1b[0m\r\n')
    child.kill('SIGTERM')
  }, EXEC_TIMEOUT_MS)

  child.on('close', () => clearTimeout(timeout))

  // Kill the child if the client disconnects
  res.on('close', () => {
    clearTimeout(timeout)
    child.kill('SIGTERM')
  })
})

/** Resolve a user-supplied relative path against the project root, preventing traversal. */
function safeResolvePath(root: string, rel: string): string | null {
  const resolved = path.resolve(root, rel)
  return resolved.startsWith(path.resolve(root)) ? resolved : null
}

export default router
