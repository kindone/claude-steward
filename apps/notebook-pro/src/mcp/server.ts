/**
 * notebook-pro MCP Server — stdio transport
 *
 * Spawned by the Claude CLI as a child process via --mcp-config.
 * Exposes tools for Claude to interact with notebook cells:
 *
 *   run_cell    — execute a cell and return its stdout output
 *   create_cell — create a new code cell and optionally run it
 *   list_cells  — list all cells in the current notebook
 *
 * Environment vars injected via the mcp-config env block:
 *   NOTEBOOK_PORT — port of the notebook HTTP server (e.g. 4003)
 *   NOTEBOOK_ID   — UUID of the active notebook
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const port = process.env.NOTEBOOK_PORT
const notebookId = process.env.NOTEBOOK_ID

if (!port || !notebookId) {
  process.stderr.write('[notebook-mcp] NOTEBOOK_PORT and NOTEBOOK_ID must be set\n')
  process.exit(1)
}

const baseUrl = `http://localhost:${port}/api`

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'run_cell',
    description:
      'Execute a notebook cell and return its stdout output. ' +
      'Always call this after writing or editing a cell to verify it works.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cell_id: { type: 'string', description: 'The UUID of the cell to run' },
      },
      required: ['cell_id'],
    },
  },
  {
    name: 'create_cell',
    description:
      'Create a new code cell in the notebook and optionally run it immediately.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        language: {
          type: 'string',
          enum: ['python', 'node', 'bash', 'cpp', 'sql'],
          description: 'The programming language for the cell',
        },
        source: {
          type: 'string',
          description: 'The source code for the cell',
        },
        name: {
          type: 'string',
          description: 'Optional human-readable name for the cell (e.g. "Load data", "Train model")',
        },
        position: {
          type: 'number',
          description: 'Position to insert at (optional — appends to end by default)',
        },
        run: {
          type: 'boolean',
          description: 'Whether to run the cell immediately after creating it (default: false)',
        },
      },
      required: ['language', 'source'],
    },
  },
  {
    name: 'list_cells',
    description:
      'List all cells in the current notebook with their IDs, positions, and languages.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'delete_cell',
    description:
      'Delete a cell from the notebook by its ID. ' +
      'Use list_cells first to find the cell ID you want to remove.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cell_id: { type: 'string', description: 'The UUID of the cell to delete' },
      },
      required: ['cell_id'],
    },
  },
  {
    name: 'edit_cell',
    description:
      'Update the source code, name, and/or language of an existing cell. ' +
      'Use list_cells first to find the cell ID, then call run_cell to verify the edit.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cell_id: { type: 'string', description: 'The UUID of the cell to edit' },
        source: { type: 'string', description: 'New source code for the cell' },
        name: { type: 'string', description: 'New human-readable name for the cell (optional)' },
        language: {
          type: 'string',
          enum: ['python', 'node', 'bash', 'cpp', 'sql'],
          description: 'New language for the cell (optional — keeps existing if omitted)',
        },
        run: {
          type: 'boolean',
          description: 'Whether to run the cell immediately after editing (default: false)',
        },
      },
      required: ['cell_id'],
    },
  },
]

// ── HTTP helpers ───────────────────────────────────────────────────────────────

/** Consume the kernel/run SSE stream and return aggregated output as a string. */
async function runCell(cellId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/kernel/run/${cellId}`, { method: 'POST' })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`kernel/run failed: HTTP ${res.status} — ${body}`)
  }
  if (!res.body) throw new Error('No response body from kernel/run')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const lines: string[] = []
  let currentEvent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() ?? ''

    for (const line of parts) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim()
        if (!raw) continue
        try {
          const data = JSON.parse(raw) as Record<string, unknown>
          if (currentEvent === 'output') {
            lines.push(String(data['line'] ?? ''))
          } else if (currentEvent === 'rich_output') {
            lines.push(`[${data['kind']} output rendered in browser]`)
          } else if (currentEvent === 'compile') {
            if (!data['ok']) lines.push(`COMPILE ERROR:\n${data['output']}`)
          } else if (currentEvent === 'error') {
            lines.push(`ERROR: ${data['message']}`)
          }
          // 'done' event — stream will close naturally
        } catch { /* malformed SSE data — skip */ }
      }
    }
  }

  return lines.join('\n') || '(no output)'
}

/** Create a cell via the cells API, optionally run it, return summary string. */
async function createCell(args: {
  language: string
  source: string
  name?: string
  position?: number
  run?: boolean
}): Promise<string> {
  const res = await fetch(`${baseUrl}/notebooks/${notebookId}/cells`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'code',
      language: args.language,
      source: args.source,
      ...(args.name ? { name: args.name } : {}),
      ...(args.position !== undefined ? { position: args.position } : {}),
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`create_cell failed: HTTP ${res.status} — ${body}`)
  }

  const cell = (await res.json()) as { id: string; position: number; language: string }
  let result = `Created ${cell.language} cell at position ${cell.position} (id: ${cell.id})`

  if (args.run) {
    const output = await runCell(cell.id)
    result += `\n\nOutput:\n${output}`
  }

  return result
}

/** Edit an existing cell's source, name, and/or language, optionally run it. */
async function editCell(args: {
  cell_id: string
  source?: string
  name?: string
  language?: string
  run?: boolean
}): Promise<string> {
  const body: Record<string, unknown> = {}
  if (args.source !== undefined) body['source'] = args.source
  if (args.name !== undefined) body['name'] = args.name
  if (args.language) body['language'] = args.language

  const res = await fetch(`${baseUrl}/cells/${args.cell_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`edit_cell failed: HTTP ${res.status} — ${text}`)
  }

  const cell = (await res.json()) as { id: string; position: number; language: string }
  let result = `Updated cell ${cell.id} (pos ${cell.position}, ${cell.language})`

  if (args.run) {
    const output = await runCell(cell.id)
    result += `\n\nOutput:\n${output}`
  }

  return result
}

/** Delete a cell by ID. */
async function deleteCell(cellId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/cells/${cellId}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`delete_cell failed: HTTP ${res.status} — ${body}`)
  }
  return `Deleted cell ${cellId}`
}

/** List all cells for the current notebook. */
async function listCells(): Promise<string> {
  const res = await fetch(`${baseUrl}/notebooks/${notebookId}/cells`)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`list_cells failed: HTTP ${res.status} — ${body}`)
  }

  const cells = (await res.json()) as Array<{
    id: string
    position: number
    language: string
    type: string
    name: string | null
    source: string
  }>

  if (cells.length === 0) return '(no cells)'

  return cells
    .map((c) => {
      const label = c.name ? `"${c.name}"` : '(unnamed)'
      const preview = c.source.slice(0, 80).replace(/\n/g, ' ')
      const ellipsis = c.source.length > 80 ? '…' : ''
      return `pos ${c.position}: ${c.language}  ${label}  id: ${c.id}\n  ${preview}${ellipsis}`
    })
    .join('\n')
}

// ── MCP server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'notebook-pro', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  const a = (args ?? {}) as Record<string, unknown>

  try {
    let text: string

    if (name === 'run_cell') {
      if (typeof a['cell_id'] !== 'string') throw new Error('cell_id must be a string')
      text = await runCell(a['cell_id'])

    } else if (name === 'create_cell') {
      if (typeof a['language'] !== 'string') throw new Error('language must be a string')
      if (typeof a['source'] !== 'string') throw new Error('source must be a string')
      text = await createCell({
        language: a['language'],
        source: a['source'],
        name: typeof a['name'] === 'string' ? a['name'] : undefined,
        position: typeof a['position'] === 'number' ? a['position'] : undefined,
        run: a['run'] === true,
      })

    } else if (name === 'list_cells') {
      text = await listCells()

    } else if (name === 'delete_cell') {
      if (typeof a['cell_id'] !== 'string') throw new Error('cell_id must be a string')
      text = await deleteCell(a['cell_id'])

    } else if (name === 'edit_cell') {
      if (typeof a['cell_id'] !== 'string') throw new Error('cell_id must be a string')
      text = await editCell({
        cell_id: a['cell_id'],
        source: typeof a['source'] === 'string' ? a['source'] : undefined,
        name: typeof a['name'] === 'string' ? a['name'] : undefined,
        language: typeof a['language'] === 'string' ? a['language'] : undefined,
        run: a['run'] === true,
      })

    } else {
      throw new Error(`Unknown tool: ${name}`)
    }

    return { content: [{ type: 'text' as const, text }], isError: false }
  } catch (err) {
    return {
      content: [{ type: 'text' as const, text: String(err) }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
