import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { artifactQueries, projectQueries } from '../db/index.js'
import { broadcastEvent } from '../lib/connections.js'
import { syncArtifactSchedule, cleanupArtifactSchedule } from '../lib/artifactSchedule.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
}

const LANG_EXT: Record<string, string> = {
  javascript: '.js', typescript: '.ts', python: '.py', ruby: '.rb',
  go: '.go', rust: '.rs', java: '.java', c: '.c', cpp: '.cpp',
  shell: '.sh', bash: '.sh', html: '.html', css: '.css',
  sql: '.sql', yaml: '.yaml', toml: '.toml', xml: '.xml',
}

function artifactExtension(type: string, metadata: Record<string, unknown> | null): string {
  switch (type) {
    case 'chart': return '.json'
    case 'report': return '.md'
    case 'data': {
      const fmt = (metadata?.format as string | undefined) ?? 'json'
      return fmt === 'csv' ? '.csv' : '.json'
    }
    case 'code': {
      const lang = (metadata?.language as string | undefined) ?? ''
      return LANG_EXT[lang.toLowerCase()] ?? '.txt'
    }
    default: return '.bin'
  }
}

// mergeParams: true exposes parent router params at runtime, but TypeScript
// doesn't know about them — cast req.params to access the values.
type ProjectArtifactParams = { projectId: string }
type ArtifactParams = { artifactId: string }

// ── Project-nested router: /api/projects/:projectId/artifacts ─────────────────

export const projectArtifactsRouter = Router({ mergeParams: true })

// GET /api/projects/:projectId/artifacts
projectArtifactsRouter.get('/', (req, res) => {
  const project = projectQueries.findById((req.params as ProjectArtifactParams).projectId)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  const artifacts = artifactQueries.listByProject((req.params as ProjectArtifactParams).projectId)
  res.json(artifacts)
})

// POST /api/projects/:projectId/artifacts
projectArtifactsRouter.post('/', (req, res) => {
  const project = projectQueries.findById((req.params as ProjectArtifactParams).projectId)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const { name, type, metadata, created_from_session, content } = req.body as {
    name?: string
    type?: string
    metadata?: Record<string, unknown>
    created_from_session?: string
    content?: string
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const validTypes = ['chart', 'report', 'data', 'code']
  if (!type || !validTypes.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
    return
  }

  const id = uuidv4()
  const slug = slugify(name.trim())
  const ext = artifactExtension(type, metadata ?? null)
  const relPath = `artifacts/${id}-${slug}${ext}`
  const absDir = path.join(project.path, 'artifacts')
  const absPath = path.join(project.path, relPath)

  try {
    fs.mkdirSync(absDir, { recursive: true })
    if (content !== undefined) {
      fs.writeFileSync(absPath, content, 'utf8')
    } else {
      fs.writeFileSync(absPath, '', 'utf8')
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to create artifact file' })
    return
  }

  const artifact = artifactQueries.create({
    id,
    project_id: (req.params as ProjectArtifactParams).projectId,
    name: name.trim(),
    type: type as 'chart' | 'report' | 'data' | 'code',
    path: relPath,
    metadata: metadata ? JSON.stringify(metadata) : null,
    created_from_session: created_from_session ?? null,
  })

  broadcastEvent('artifact_created', { projectId: (req.params as ProjectArtifactParams).projectId, artifactId: id })
  res.status(201).json(artifact)
})

// ── Individual artifact router: /api/artifacts/:artifactId ────────────────────

export const artifactRouter = Router({ mergeParams: true })

// GET /api/artifacts/:artifactId
artifactRouter.get('/', (req, res) => {
  const artifact = artifactQueries.findById((req.params as ArtifactParams).artifactId)
  if (!artifact) {
    res.status(404).json({ error: 'Artifact not found' })
    return
  }
  res.json(artifact)
})

// PATCH /api/artifacts/:artifactId
artifactRouter.patch('/', (req, res) => {
  const artifact = artifactQueries.findById((req.params as ArtifactParams).artifactId)
  if (!artifact) {
    res.status(404).json({ error: 'Artifact not found' })
    return
  }

  const { name, metadata } = req.body as { name?: string; metadata?: Record<string, unknown> }

  if (name !== undefined && (!name || !name.trim())) {
    res.status(400).json({ error: 'name must be a non-empty string' })
    return
  }

  const updated = artifactQueries.update(artifact.id, {
    name: name?.trim(),
    metadata: metadata !== undefined ? JSON.stringify(metadata) : undefined,
  })

  if (metadata !== undefined) {
    syncArtifactSchedule(artifact.id)
  }

  broadcastEvent('artifact_updated', { artifactId: artifact.id, projectId: artifact.project_id })
  res.json(updated)
})

// DELETE /api/artifacts/:artifactId
artifactRouter.delete('/', (req, res) => {
  const artifact = artifactQueries.findById((req.params as ArtifactParams).artifactId)
  if (!artifact) {
    res.status(404).json({ error: 'Artifact not found' })
    return
  }

  const project = projectQueries.findById(artifact.project_id)
  if (project) {
    const absPath = path.join(project.path, artifact.path)
    try {
      fs.unlinkSync(absPath)
    } catch {
      // File may already be gone — continue with DB delete
    }
  }

  cleanupArtifactSchedule(artifact.id)
  artifactQueries.delete(artifact.id)
  broadcastEvent('artifact_deleted', { artifactId: artifact.id, projectId: artifact.project_id })
  res.status(204).end()
})

// GET /api/artifacts/:artifactId/content
artifactRouter.get('/content', (req, res) => {
  const artifact = artifactQueries.findById((req.params as ArtifactParams).artifactId)
  if (!artifact) {
    res.status(404).json({ error: 'Artifact not found' })
    return
  }

  const project = projectQueries.findById(artifact.project_id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const absPath = path.join(project.path, artifact.path)
  try {
    const content = fs.readFileSync(absPath, 'utf8')
    res.json({ content })
  } catch {
    res.status(404).json({ error: 'Artifact file not found' })
  }
})

// PUT /api/artifacts/:artifactId/content
artifactRouter.put('/content', (req, res) => {
  const artifact = artifactQueries.findById((req.params as ArtifactParams).artifactId)
  if (!artifact) {
    res.status(404).json({ error: 'Artifact not found' })
    return
  }

  const project = projectQueries.findById(artifact.project_id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  const { content } = req.body as { content?: string }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content is required' })
    return
  }

  const absPath = path.join(project.path, artifact.path)
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true })
    fs.writeFileSync(absPath, content, 'utf8')
  } catch {
    res.status(500).json({ error: 'Failed to write artifact content' })
    return
  }

  artifactQueries.update(artifact.id, {})  // bump updated_at
  broadcastEvent('artifact_updated', { artifactId: artifact.id, projectId: artifact.project_id })
  res.json({ ok: true })
})

// POST /api/artifacts/:artifactId/refresh
artifactRouter.post('/refresh', (req, res) => {
  const artifact = artifactQueries.findById((req.params as ArtifactParams).artifactId)
  if (!artifact) {
    res.status(404).json({ error: 'Artifact not found' })
    return
  }

  const project = projectQueries.findById(artifact.project_id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }

  let refreshCommand: string | undefined
  if (artifact.metadata) {
    try {
      const meta = JSON.parse(artifact.metadata) as Record<string, unknown>
      refreshCommand = meta.refresh_command as string | undefined
    } catch {
      // ignore parse errors
    }
  }

  if (!refreshCommand) {
    res.status(400).json({ error: 'No refresh_command in artifact metadata' })
    return
  }

  const command = refreshCommand
  exec(command, { cwd: project.path }, (err, stdout, stderr) => {
    if (err) {
      res.status(500).json({ error: 'Refresh command failed', details: stderr || err.message })
      return
    }
    artifactQueries.update(artifact.id, {})  // bump updated_at
    broadcastEvent('artifact_updated', { artifactId: artifact.id, projectId: artifact.project_id })
    res.json({ ok: true, output: stdout })
  })
})
