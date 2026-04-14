/**
 * MdArt rendering service — mini-app
 *
 * Provides:
 *   POST /render              → { svg, type, title, tabCount }
 *   POST /render/states       → { states: string[], type, tabCount }
 *   POST /render/ecosystem    → { html, adapter }
 *   GET  /                    → playground UI
 *   GET  /health              → { ok: true }
 *
 * Command template (register in steward app configs):
 *   /home/ubuntu/claude-steward/node_modules/.bin/tsx /home/ubuntu/claude-steward/apps/mdart/src/server.ts {port}
 *
 * work_dir: /home/ubuntu/claude-steward
 *
 * Note: only {port} is substituted by the steward route — use absolute paths
 * for everything else.
 */

import express     from 'express'
import path        from 'node:path'
import { fileURLToPath } from 'node:url'

// Import mdart core directly from client workspace.
// tsx resolves .js → .ts automatically; no separate build needed.
import { renderMdArt } from '../../../client/src/lib/mdart/renderer.js'
import { parseMdArt }  from '../../../client/src/lib/mdart/parser.js'

// Ecosystem adapters — real plugin implementations using the local mdart core.
// In a published package, these would import from '@mdart/core' instead.
import { renderWithMarked }      from './adapters/marked-adapter.js'
import { renderWithMarkdownIt }  from './adapters/markdown-it-adapter.js'
import { renderWithUnified }     from './adapters/remark-adapter.js'

type EcosystemAdapter = 'marked' | 'markdown-it' | 'unified'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── CLI args ──────────────────────────────────────────────────────────────────

const port = parseInt(process.argv[2] ?? '', 10)
if (!port || isNaN(port)) {
  console.error('Usage: npx tsx src/server.ts <port>')
  process.exit(1)
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express()
app.use(express.json({ limit: '1mb' }))

// Serve playground UI from public/
app.use(express.static(path.join(__dirname, '../public')))

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /render
 * Render mdart source to a single SVG string (tab 0 active for tab-list).
 */
app.post('/render', (req, res) => {
  const { source, hintType } = req.body as { source?: string; hintType?: string }
  if (!source?.trim()) {
    res.status(400).json({ error: 'source is required' }); return
  }
  try {
    const spec = parseMdArt(source, hintType)
    const svg  = renderMdArt(source, hintType)
    res.json({
      svg,
      type:     spec.type,
      title:    spec.title ?? null,
      tabCount: spec.type === 'tab-list' ? spec.items.length : 1,
    })
  } catch (err) {
    res.status(400).json({ error: String(err) })
  }
})

/**
 * POST /render/states
 * For tab-list diagrams: returns one SVG per tab state.
 * For all other layouts: returns a single-element array.
 *
 * Note: until renderMdArt supports activeTab option, all states share
 * the same SVG — the playground handles switching client-side via DOM.
 * This endpoint exists to document the future API shape.
 */
app.post('/render/states', (req, res) => {
  const { source, hintType } = req.body as { source?: string; hintType?: string }
  if (!source?.trim()) {
    res.status(400).json({ error: 'source is required' }); return
  }
  try {
    const spec   = parseMdArt(source, hintType)
    const svg    = renderMdArt(source, hintType)
    const states = spec.type === 'tab-list'
      ? spec.items.map(() => svg)   // same SVG, playground toggles active tab via DOM
      : [svg]
    res.json({ states, type: spec.type, tabCount: states.length })
  } catch (err) {
    res.status(400).json({ error: String(err) })
  }
})

/**
 * POST /render/ecosystem
 * Render a full Markdown document through a chosen ecosystem adapter.
 * mdart fences within the document are replaced with inline SVG.
 *
 * Body:  { source: string, adapter: 'marked' | 'markdown-it' | 'unified' }
 * Reply: { html: string, adapter: string }
 */
app.post('/render/ecosystem', async (req, res) => {
  const { source, adapter } = req.body as { source?: string; adapter?: EcosystemAdapter }
  if (!source?.trim()) {
    res.status(400).json({ error: 'source is required' }); return
  }
  const name: EcosystemAdapter = adapter ?? 'marked'
  try {
    let html: string
    if (name === 'marked')       html = await renderWithMarked(source)
    else if (name === 'markdown-it') html = renderWithMarkdownIt(source)
    else if (name === 'unified') html = await renderWithUnified(source)
    else { res.status(400).json({ error: `unknown adapter: ${String(adapter)}` }); return }
    res.json({ html, adapter: name })
  } catch (err) {
    res.status(400).json({ error: String(err) })
  }
})

/** GET /health */
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mdart' })
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`[mdart] listening on :${port}`)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT',  () => process.exit(0))
