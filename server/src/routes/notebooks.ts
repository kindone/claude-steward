import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { projectQueries } from '../db/index.js'
import { safeResolvePath } from '../lib/pathUtils.js'

type NotebookParams = { projectId: string; name: string }

const router = Router({ mergeParams: true })

// Notebook/cell name validation — alphanumeric, hyphens, underscores only
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/

function isValidName(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 64 && SAFE_NAME_RE.test(s)
}

/** Language → file extension */
const LANG_EXT: Record<string, string> = {
  python: '.py', python3: '.py', py: '.py',
  javascript: '.js', js: '.js', node: '.js',
  typescript: '.ts', ts: '.ts',
  bash: '.sh', sh: '.sh', shell: '.sh', zsh: '.sh', fish: '.sh',
  cpp: '.cpp', 'c++': '.cpp', cxx: '.cpp', cc: '.cpp',
  r: '.r',
  sql: '.sql',
  ruby: '.rb', rb: '.rb',
  go: '.go',
  rust: '.rs',
}

function langToExt(lang: string): string {
  return LANG_EXT[lang.toLowerCase().trim()] ?? '.txt'
}

/** Scan cells dir and return the next auto-increment prefix (zero-padded, 2 digits min). */
function nextCellPrefix(cellsDir: string): string {
  if (!fs.existsSync(cellsDir)) return '01'
  const entries = fs.readdirSync(cellsDir)
  const prefixes = entries
    .map(f => parseInt(f.match(/^(\d+)_/)?.[1] ?? '0', 10))
    .filter(n => !isNaN(n) && n > 0)
  const max = prefixes.length > 0 ? Math.max(...prefixes) : 0
  return String(max + 1).padStart(2, '0')
}

/** Initialise a git repo for the notebook asynchronously (non-fatal if git unavailable). */
function gitInitAsync(notebookDir: string): void {
  setImmediate(() => {
    const git = spawn('git', ['init', '-q'], { cwd: notebookDir, stdio: 'ignore' })
    git.on('error', () => { /* git not available — silently skip */ })
  })
}

// ── GET / — list notebooks ──────────────────────────────────────────────────

router.get('/', (req, res) => {
  const project = projectQueries.findById((req.params as NotebookParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const notebooksDir = path.join(project.path, 'notebooks')
  if (!fs.existsSync(notebooksDir)) { res.json([]); return }

  const entries = fs.readdirSync(notebooksDir, { withFileTypes: true })
  const notebooks = entries
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name }))
  res.json(notebooks)
})

// ── POST / — create notebook ────────────────────────────────────────────────

router.post('/', (req, res) => {
  const project = projectQueries.findById((req.params as NotebookParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const { name } = req.body as { name?: unknown }
  if (!isValidName(name)) {
    res.status(400).json({ error: 'name must be alphanumeric (hyphens/underscores allowed), max 64 chars' })
    return
  }

  const notebookDir = safeResolvePath(project.path, path.join('notebooks', name))
  if (!notebookDir) { res.status(400).json({ error: 'Invalid notebook name' }); return }

  if (fs.existsSync(notebookDir)) {
    res.status(409).json({ error: `Notebook "${name}" already exists` })
    return
  }

  // Create directory structure
  fs.mkdirSync(path.join(notebookDir, 'cells'), { recursive: true })
  fs.mkdirSync(path.join(notebookDir, 'outputs'), { recursive: true })

  // .gitignore
  fs.writeFileSync(path.join(notebookDir, '.gitignore'), 'outputs/\n.index.db\n')

  // Git init (async, non-fatal)
  gitInitAsync(notebookDir)

  res.status(201).json({ name, path: `notebooks/${name}` })
})

// ── GET /:name/cells — list cells ───────────────────────────────────────────

router.get('/:name/cells', (req, res) => {
  const project = projectQueries.findById((req.params as NotebookParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const notebookName = (req.params as NotebookParams).name
  if (!isValidName(notebookName)) { res.status(400).json({ error: 'Invalid notebook name' }); return }

  const cellsDir = safeResolvePath(project.path, path.join('notebooks', notebookName, 'cells'))
  if (!cellsDir) { res.status(400).json({ error: 'Invalid notebook name' }); return }

  if (!fs.existsSync(cellsDir)) { res.json([]); return }

  const files = fs.readdirSync(cellsDir).sort()
  const cells = files
    .filter(f => !f.startsWith('.'))
    .map(filename => {
      const match = filename.match(/^(\d+)_(.+?)(\.[^.]+)?$/)
      return {
        filename,
        prefix: match?.[1] ?? '',
        name: match?.[2] ?? filename,
        ext: match?.[3] ?? '',
      }
    })
  res.json(cells)
})

// ── POST /:name/cells — save a cell ─────────────────────────────────────────

router.post('/:name/cells', (req, res) => {
  const project = projectQueries.findById((req.params as NotebookParams).projectId)
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const notebookName = (req.params as NotebookParams).name
  if (!isValidName(notebookName)) { res.status(400).json({ error: 'Invalid notebook name' }); return }

  const { cellName, code, language } = req.body as { cellName?: unknown; code?: unknown; language?: unknown }

  if (!isValidName(cellName)) {
    res.status(400).json({ error: 'cellName must be alphanumeric (hyphens/underscores allowed), max 64 chars' })
    return
  }
  if (typeof code !== 'string') {
    res.status(400).json({ error: 'code must be a string' })
    return
  }

  const notebookDir = safeResolvePath(project.path, path.join('notebooks', notebookName))
  if (!notebookDir) { res.status(400).json({ error: 'Invalid notebook name' }); return }

  const cellsDir = path.join(notebookDir, 'cells')
  fs.mkdirSync(cellsDir, { recursive: true })

  const ext = langToExt(typeof language === 'string' ? language : '')
  const prefix = nextCellPrefix(cellsDir)
  const filename = `${prefix}_${cellName}${ext}`
  const filePath = path.join(cellsDir, filename)

  // Guard against collision (two saves racing — extremely unlikely but safe)
  if (fs.existsSync(filePath)) {
    res.status(409).json({ error: `Cell file "${filename}" already exists` })
    return
  }

  fs.writeFileSync(filePath, code, 'utf8')

  res.status(201).json({
    filename,
    notebookName,
    path: `notebooks/${notebookName}/cells/${filename}`,
  })
})

export default router
