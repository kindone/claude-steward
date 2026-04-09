#!/usr/bin/env node
/**
 * Steward MCP Artifact Server — stdio transport
 *
 * Spawned by the Claude CLI as a child process via --mcp-config.
 * Exposes two tools for managing steward artifacts:
 *   artifact_list   — list all artifacts for the current project
 *   artifact_create — create a new artifact (file + DB row)
 *
 * After creating an artifact it POSTs to MCP_NOTIFY_URL so the main server
 * can broadcast an `artifact_created` SSE event to connected clients.
 *
 * Environment vars (injected via --mcp-config env block):
 *   DATABASE_PATH      — path to steward.db
 *   MCP_NOTIFY_URL     — e.g. http://localhost:3001/api/mcp-notify
 *   MCP_NOTIFY_SECRET  — shared secret for the notify endpoint
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { mcpArtifactDb, type ArtifactType } from './artifact-db.js'

// ── Notification helper ────────────────────────────────────────────────────────

async function notifyArtifactCreated(projectId: string, artifactId: string): Promise<void> {
  const url = process.env.MCP_NOTIFY_URL
  const secret = process.env.MCP_NOTIFY_SECRET
  if (!url || !secret) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCP-Secret': secret },
      body: JSON.stringify({ event: 'artifact_created', payload: { projectId, artifactId } }),
    })
  } catch {
    // Non-critical: Art panel will refresh on next open if notify fails
  }
}

// ── MCP Server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'steward-artifacts', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

const VALID_TYPES: ArtifactType[] = ['chart', 'report', 'data', 'code', 'pikchr']

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'artifact_list',
      description:
        'List all artifacts for the current project. ' +
        'Returns id, name, type, path, and metadata for each artifact. ' +
        'Use this to discover what artifacts exist before creating a duplicate or to get an artifact\'s id.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The steward session ID (from the system prompt).' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'artifact_create',
      description:
        'Create a new artifact in the current project. ' +
        'The artifact is saved as a file in the project directory and appears immediately in the Art panel. ' +
        'Types: "chart" (Vega-Lite JSON), "report" (Markdown), "data" (JSON/CSV), "code" (any language), "pikchr" (diagram). ' +
        'For code artifacts, pass metadata.language (e.g. "python", "typescript"). ' +
        'For data artifacts, pass metadata.format ("json" or "csv"). ' +
        'For chart artifacts, content should be a valid Vega-Lite spec JSON string.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'The steward session ID (from the system prompt).',
          },
          name: {
            type: 'string',
            description: 'Human-readable artifact name shown in the Art panel.',
          },
          type: {
            type: 'string',
            enum: VALID_TYPES,
            description: 'Artifact type: chart | report | data | code | pikchr',
          },
          content: {
            type: 'string',
            description: 'Full content of the artifact. For charts: Vega-Lite JSON. For reports: Markdown. For code: source code.',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata. For code: { language: "python" }. For data: { format: "csv" }.',
            properties: {
              language: { type: 'string' },
              format:   { type: 'string' },
            },
          },
        },
        required: ['session_id', 'name', 'type', 'content'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params

  try {
    switch (name) {
      case 'artifact_list': {
        const sessionId = String(args.session_id ?? '').trim()
        if (!sessionId) throw new Error('session_id is required')

        const project = mcpArtifactDb.findProjectFromSession(sessionId)
        if (!project) throw new Error(`No project found for session "${sessionId}". Is this a valid steward session?`)

        const rows = mcpArtifactDb.listByProject(project.id)
        if (rows.length === 0) {
          return { content: [{ type: 'text', text: `No artifacts found for project "${project.name}".` }] }
        }

        const list = rows.map(r => ({
          id:       r.id,
          name:     r.name,
          type:     r.type,
          path:     r.path,
          metadata: r.metadata ? JSON.parse(r.metadata) : null,
        }))
        return {
          content: [{
            type: 'text',
            text: `Project "${project.name}" has ${rows.length} artifact(s):\n\n${JSON.stringify(list, null, 2)}`,
          }],
        }
      }

      case 'artifact_create': {
        const sessionId = String(args.session_id ?? '').trim()
        const artName   = String(args.name    ?? '').trim()
        const artType   = String(args.type    ?? '').trim() as ArtifactType
        const content   = String(args.content ?? '')
        const metadata  = (args.metadata && typeof args.metadata === 'object')
          ? args.metadata as Record<string, unknown>
          : null

        if (!sessionId) throw new Error('session_id is required')
        if (!artName)   throw new Error('name is required')
        if (!VALID_TYPES.includes(artType)) {
          throw new Error(`type must be one of: ${VALID_TYPES.join(', ')}`)
        }

        const project = mcpArtifactDb.findProjectFromSession(sessionId)
        if (!project) throw new Error(`No project found for session "${sessionId}". Is this a valid steward session?`)

        const artifact = mcpArtifactDb.create(
          project.id,
          project.path,
          sessionId,
          artName,
          artType,
          content,
          metadata,
        )

        await notifyArtifactCreated(project.id, artifact.id)

        return {
          content: [{
            type: 'text',
            text: `Artifact created: "${artifact.name}" (${artifact.type})\nID: ${artifact.id}\nPath: ${artifact.path}\nThe artifact is now visible in the Art panel.`,
          }],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    }
  }
})

// ── Start ──────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
