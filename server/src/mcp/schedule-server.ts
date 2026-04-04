#!/usr/bin/env node
/**
 * Steward MCP Schedule Server — stdio transport
 *
 * Spawned by the Claude CLI as a child process via --mcp-config.
 * Exposes four tools for managing steward schedules:
 *   schedule_list    — list all schedules for a session (read-only)
 *   schedule_create  — create or upsert a schedule by label
 *   schedule_update  — patch an existing schedule by id
 *   schedule_delete  — delete a schedule by id
 *
 * After any mutation it POSTs to MCP_NOTIFY_URL so the main server
 * can broadcast a `schedules_changed` SSE event to connected clients.
 *
 * Environment vars (injected via --mcp-config env block):
 *   DATABASE_PATH      — path to steward.db
 *   MCP_NOTIFY_URL     — e.g. http://localhost:3001/api/mcp-notify
 *   MCP_NOTIFY_SECRET  — shared secret for the notify endpoint
 */

import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { mcpScheduleDb } from './db.js'
import { nextFireAt } from '../lib/scheduler.js'

// ── Notification helper ────────────────────────────────────────────────────────

async function notifyChanged(sessionId: string): Promise<void> {
  const url = process.env.MCP_NOTIFY_URL
  const secret = process.env.MCP_NOTIFY_SECRET
  if (!url || !secret) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCP-Secret': secret },
      body: JSON.stringify({ sessionId }),
    })
  } catch {
    // Non-critical: the panel will refresh on next open if notify fails
  }
}

// ── MCP Server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'steward-schedules', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'schedule_list',
      description: 'List all schedules for the current steward session.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The steward session ID.' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'schedule_create',
      description:
        'Create a new schedule (or update an existing one with the same label) for the current steward session. ' +
        'Use this to set up recurring reminders or automated tasks. ' +
        'If a schedule with the same label already exists it is updated in-place.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The steward session ID.' },
          cron:       { type: 'string', description: '5-field UTC cron expression, e.g. "0 9 * * 1-5".' },
          prompt:     { type: 'string', description: 'Task context injected at fire time — write as a clear instruction to yourself.' },
          label:      { type: 'string', description: 'Short human-readable name shown in the UI. Used as the upsert key.' },
          once:       { type: 'boolean', description: 'If true, the schedule fires once then deletes itself.' },
        },
        required: ['session_id', 'cron', 'prompt', 'label'],
      },
    },
    {
      name: 'schedule_update',
      description:
        'Update an existing schedule by its ID. Only the fields you provide are changed. ' +
        'Use schedule_list to find the ID first.',
      inputSchema: {
        type: 'object',
        properties: {
          id:      { type: 'string',  description: 'The schedule ID to update.' },
          cron:    { type: 'string',  description: 'New 5-field UTC cron expression.' },
          prompt:  { type: 'string',  description: 'New prompt/task context.' },
          enabled: { type: 'boolean', description: 'Enable or disable the schedule.' },
        },
        required: ['id'],
      },
    },
    {
      name: 'schedule_delete',
      description: 'Delete a schedule by its ID. Use schedule_list to find the ID first.',
      inputSchema: {
        type: 'object',
        properties: {
          id:         { type: 'string', description: 'The schedule ID to delete.' },
          session_id: { type: 'string', description: 'Session ID (used to notify the UI).' },
        },
        required: ['id'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params

  try {
    switch (name) {
      case 'schedule_list': {
        const sessionId = String(args.session_id ?? '')
        if (!sessionId) throw new Error('session_id is required')
        const rows = mcpScheduleDb.listBySession(sessionId)
        return {
          content: [{
            type: 'text',
            text: rows.length === 0
              ? 'No schedules found for this session.'
              : JSON.stringify(rows.map(r => ({
                  id:         r.id,
                  label:      r.label ?? '(unlabelled)',
                  cron:       r.cron,
                  prompt:     r.prompt,
                  enabled:    r.enabled === 1,
                  once:       r.once === 1,
                  next_run_at: r.next_run_at,
                })), null, 2),
          }],
        }
      }

      case 'schedule_create': {
        const sessionId = String(args.session_id ?? '')
        const cronExpr  = String(args.cron    ?? '').trim()
        const prompt    = String(args.prompt  ?? '').trim()
        const label     = String(args.label   ?? '').trim()
        const once      = args.once === true

        if (!sessionId) throw new Error('session_id is required')
        if (!cronExpr)  throw new Error('cron is required')
        if (!prompt)    throw new Error('prompt is required')
        if (!label)     throw new Error('label is required')

        const nextRun = nextFireAt(cronExpr)
        if (nextRun === null) throw new Error(`Invalid cron expression: "${cronExpr}"`)

        // Warn if the next fire time looks further than expected — this catches the common
        // mistake where a pinned day/month (e.g. "46 15 4 4 *") is computed after the
        // target minute has already passed, causing cron-parser to return next year.
        const nowSec = Math.floor(Date.now() / 1000)
        const secsUntilFire = nextRun - nowSec
        const suspiciouslyFar = secsUntilFire > 60 * 60 * 24 * 7 // > 1 week
        const hasPinnedDayMonth = !cronExpr.split(' ').slice(2, 4).every(f => f === '*')

        const row = mcpScheduleDb.upsert(randomUUID(), sessionId, cronExpr, prompt, label, once, nextRun)
        await notifyChanged(sessionId)

        let text = `Schedule created: "${label}" (${cronExpr})\nID: ${row.id}\nNext run: ${row.next_run_at ? new Date(row.next_run_at * 1000).toISOString() : 'unknown'}`
        if (suspiciouslyFar && hasPinnedDayMonth) {
          text += `\n\n⚠️ WARNING: next_run_at is ${Math.round(secsUntilFire / 86400)} day(s) from now. If you intended a near-future one-shot, the target minute may have already passed by the time the server processed this call. Delete this schedule and recreate it targeting at least 3–4 minutes from now.`
        }

        return { content: [{ type: 'text', text }] }
      }

      case 'schedule_update': {
        const id = String(args.id ?? '').trim()
        if (!id) throw new Error('id is required')

        const existing = mcpScheduleDb.findById(id)
        if (!existing) throw new Error(`No schedule found with id "${id}"`)

        const patch: { cron?: string; prompt?: string; enabled?: boolean; nextRunAt?: number | null } = {}
        if (typeof args.cron    === 'string')  { patch.cron = args.cron.trim(); patch.nextRunAt = nextFireAt(patch.cron) }
        if (typeof args.prompt  === 'string')  patch.prompt  = args.prompt.trim()
        if (typeof args.enabled === 'boolean') patch.enabled = args.enabled

        if (Object.keys(patch).length === 0) throw new Error('No fields to update — provide at least one of: cron, prompt, enabled')

        const updated = mcpScheduleDb.update(id, patch)
        if (!updated) throw new Error('Update failed — schedule may have been deleted')
        await notifyChanged(existing.session_id)

        return {
          content: [{
            type: 'text',
            text: `Schedule updated: "${updated.label ?? id}"\nCron: ${updated.cron}\nEnabled: ${updated.enabled === 1}\nNext run: ${updated.next_run_at ? new Date(updated.next_run_at * 1000).toISOString() : 'unknown'}`,
          }],
        }
      }

      case 'schedule_delete': {
        const id        = String(args.id         ?? '').trim()
        const sessionId = String(args.session_id ?? '').trim()
        if (!id) throw new Error('id is required')

        const existing = mcpScheduleDb.findById(id)
        if (!existing) throw new Error(`No schedule found with id "${id}"`)

        mcpScheduleDb.delete(id)
        await notifyChanged(sessionId || existing.session_id)

        return {
          content: [{
            type: 'text',
            text: `Schedule deleted: "${existing.label ?? id}"`,
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
