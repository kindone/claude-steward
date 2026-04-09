/**
 * Lean standalone SQLite module for the MCP artifact server process.
 *
 * Runs in a separate child process (spawned by Claude CLI via --mcp-config),
 * so it opens its own connection to steward.db using WAL mode for safe
 * concurrent access alongside the main server.
 *
 * Only exposes the artifact queries needed by the MCP tools.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH ?? path.join(__dirname, '../../steward.db')

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 5000')

// ── Prepared statements ────────────────────────────────────────────────────────

const findProjectFromSessionStmt = db.prepare(
  `SELECT p.id, p.path, p.name
   FROM sessions s JOIN projects p ON s.project_id = p.id
   WHERE s.id = ? LIMIT 1`
)

const listArtifactsByProjectStmt = db.prepare(
  `SELECT id, name, type, path, metadata, created_at, updated_at
   FROM artifacts WHERE project_id = ? ORDER BY created_at ASC`
)

const insertArtifactStmt = db.prepare(
  `INSERT INTO artifacts (id, project_id, name, type, path, metadata, created_from_session)
   VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
)

const findArtifactByIdStmt = db.prepare(
  `SELECT a.id, a.project_id, a.name, a.type, a.path, a.metadata, a.created_at, a.updated_at,
          p.path as project_path
   FROM artifacts a JOIN projects p ON a.project_id = p.id
   WHERE a.id = ? LIMIT 1`
)

const updateArtifactTimestampStmt = db.prepare(
  `UPDATE artifacts SET updated_at = unixepoch() WHERE id = ?`
)

// ── Types ──────────────────────────────────────────────────────────────────────

export type ArtifactType = 'chart' | 'report' | 'data' | 'code' | 'pikchr'

export interface ArtifactRow {
  id: string
  project_id: string
  name: string
  type: ArtifactType
  path: string
  metadata: string | null
  created_from_session: string | null
  created_at: number
  updated_at: number
}

export interface ProjectInfo {
  id: string
  path: string
  name: string
}

// ── File extension helper ──────────────────────────────────────────────────────

const LANG_EXT: Record<string, string> = {
  javascript: '.js', typescript: '.ts', python: '.py', ruby: '.rb',
  go: '.go', rust: '.rs', java: '.java', c: '.c', cpp: '.cpp',
  shell: '.sh', bash: '.sh', html: '.html', css: '.css',
  sql: '.sql', yaml: '.yaml', toml: '.toml', xml: '.xml',
}

export function artifactExtension(type: ArtifactType, metadata: Record<string, unknown> | null): string {
  switch (type) {
    case 'chart':  return '.json'
    case 'report': return '.md'
    case 'data': {
      const fmt = (metadata?.format as string | undefined) ?? 'json'
      return fmt === 'csv' ? '.csv' : '.json'
    }
    case 'code': {
      const lang = (metadata?.language as string | undefined) ?? ''
      return LANG_EXT[lang.toLowerCase()] ?? '.txt'
    }
    case 'pikchr': return '.pikchr'
    default:       return '.bin'
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
}

// ── Queries ────────────────────────────────────────────────────────────────────

export const mcpArtifactDb = {
  findProjectFromSession: (sessionId: string): ProjectInfo | undefined =>
    findProjectFromSessionStmt.get(sessionId) as ProjectInfo | undefined,

  listByProject: (projectId: string): ArtifactRow[] =>
    listArtifactsByProjectStmt.all(projectId) as unknown as ArtifactRow[],

  /**
   * Write the artifact file and insert the DB row.
   * Returns the new artifact row.
   */
  create: (
    projectId: string,
    projectPath: string,
    sessionId: string,
    name: string,
    type: ArtifactType,
    content: string,
    metadata: Record<string, unknown> | null,
  ): ArtifactRow => {
    const id = randomUUID()
    const slug = slugify(name)
    const ext = artifactExtension(type, metadata)
    const relPath = `artifacts/${id}-${slug}${ext}`
    const absDir = path.join(projectPath, 'artifacts')
    const absPath = path.join(projectPath, relPath)

    fs.mkdirSync(absDir, { recursive: true })
    fs.writeFileSync(absPath, content, 'utf8')

    return insertArtifactStmt.get(
      id,
      projectId,
      name,
      type,
      relPath,
      metadata ? JSON.stringify(metadata) : null,
      sessionId,
    ) as unknown as ArtifactRow
  },

  /**
   * Overwrite the artifact file content and bump updated_at.
   * Returns the artifact row (with updated timestamp).
   */
  update: (artifactId: string, content: string): ArtifactRow & { project_path: string } => {
    const row = findArtifactByIdStmt.get(artifactId) as (ArtifactRow & { project_path: string }) | undefined
    if (!row) throw new Error(`Artifact "${artifactId}" not found`)

    const absPath = path.join(row.project_path, row.path)
    fs.writeFileSync(absPath, content, 'utf8')
    updateArtifactTimestampStmt.run(artifactId)

    return { ...row, updated_at: Math.floor(Date.now() / 1000) }
  },
}
