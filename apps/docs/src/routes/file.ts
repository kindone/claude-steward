import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'

export const fileRouter = Router()

/**
 * Map a MkDocs page URL to its source .md file path.
 * /             → {docsDir}/docs/index.md
 * /section/page → {docsDir}/docs/section/page.md
 */
function pageToFilePath(docsDir: string, pageUrl: string): string {
  // Strip query / hash / trailing slash
  let p = pageUrl.split('?')[0].split('#')[0].replace(/\/$/, '')
  if (!p || p === '/') p = '/index'
  // Remove leading slash, append .md
  const rel = path.join('docs', p.replace(/^\//, '') + '.md')
  return path.join(docsDir, rel)
}

function guardPath(docsDir: string, filePath: string): boolean {
  const resolved = path.resolve(filePath)
  const base     = path.resolve(path.join(docsDir, 'docs'))
  return resolved.startsWith(base + path.sep) || resolved === base
}

// GET /api/file?page=/section/page
fileRouter.get('/file', async (req, res) => {
  const pageUrl = req.query.page as string | undefined
  if (!pageUrl) { res.status(400).json({ error: 'page required' }); return }

  const docsDir  = req.app.locals.docsDir as string
  const filePath = pageToFilePath(docsDir, pageUrl)

  if (!guardPath(docsDir, filePath)) { res.status(403).json({ error: 'forbidden' }); return }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    res.json({ content, filePath: path.relative(docsDir, filePath) })
  } catch {
    res.status(404).json({ error: 'File not found', filePath: path.relative(docsDir, filePath) })
  }
})

// PATCH /api/file?page=/section/page  body: { content: string }
fileRouter.patch('/file', async (req, res) => {
  const pageUrl = req.query.page as string | undefined
  const { content } = req.body as { content?: string }

  if (!pageUrl)          { res.status(400).json({ error: 'page required' });    return }
  if (content == null)   { res.status(400).json({ error: 'content required' }); return }

  const docsDir  = req.app.locals.docsDir as string
  const filePath = pageToFilePath(docsDir, pageUrl)

  if (!guardPath(docsDir, filePath)) { res.status(403).json({ error: 'forbidden' }); return }

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf8')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
