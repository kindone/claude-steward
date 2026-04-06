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
import { nextFireAt, countFiresBeforeExpiry, type ScheduleCondition } from '../lib/scheduler.js'

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
          condition:  {
            type: 'object',
            description: 'Optional fire-time condition for patterns cron cannot express natively. ' +
              'Supported types: ' +
              '{"type":"every_n_days","n":<number>,"ref":"<YYYY-MM-DD>"} for every N days or biweekly (n=14); ' +
              '{"type":"last_day_of_month"} to fire only on the last day of each month; ' +
              '{"type":"nth_weekday","n":<1-5>,"weekday":<0-6>} for the Nth occurrence of a weekday (0=Sun). ' +
              'The cron still fires on its normal cadence; the condition skips the run if not met.',
            properties: {
              type:    { type: 'string' },
              n:       { type: 'number' },
              ref:     { type: 'string' },
              weekday: { type: 'number' },
            },
            required: ['type'],
          },
          expires_at: {
            type: 'string',
            description: 'ISO 8601 datetime after which the schedule auto-deletes, e.g. "2026-04-06T17:00:00+09:00". ' +
              'Use for "every X until Y" patterns. The schedule fires while now < expires_at, then is deleted automatically.',
          },
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
          id:         { type: 'string',  description: 'The schedule ID to update.' },
          cron:       { type: 'string',  description: 'New 5-field UTC cron expression.' },
          prompt:     { type: 'string',  description: 'New prompt/task context.' },
          enabled:    { type: 'boolean', description: 'Enable or disable the schedule.' },
          condition:  {
            type: 'object',
            description: 'Replace the fire-time condition. Same format as schedule_create.',
            properties: {
              type: { type: 'string' }, n: { type: 'number' },
              ref: { type: 'string' }, weekday: { type: 'number' },
            },
            required: ['type'],
          },
          expires_at: { type: 'string', description: 'New ISO 8601 expiry datetime.' },
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
                  id:          r.id,
                  label:       r.label ?? '(unlabelled)',
                  cron:        r.cron,
                  prompt:      r.prompt,
                  enabled:     r.enabled === 1,
                  once:        r.once === 1,
                  condition:   r.condition ? JSON.parse(r.condition) : null,
                  expires_at:  r.expires_at ? new Date(r.expires_at * 1000).toISOString() : null,
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

        // Parse and validate optional condition
        let conditionJson: string | null = null
        if (args.condition != null) {
          const c = args.condition as Record<string, unknown>
          if (!c.type || typeof c.type !== 'string') throw new Error('condition.type is required')
          if (c.type === 'every_n_days') {
            if (typeof c.n !== 'number' || c.n < 1) throw new Error('every_n_days requires n >= 1')
            if (typeof c.ref !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.ref)) throw new Error('every_n_days requires ref as YYYY-MM-DD')
          } else if (c.type === 'nth_weekday') {
            if (typeof c.n !== 'number' || c.n < 1 || c.n > 5) throw new Error('nth_weekday requires n between 1 and 5')
            if (typeof c.weekday !== 'number' || c.weekday < 0 || c.weekday > 6) throw new Error('nth_weekday requires weekday 0–6 (0=Sun)')
          } else if (c.type !== 'last_day_of_month') {
            throw new Error(`Unknown condition type: "${c.type}". Supported: every_n_days, last_day_of_month, nth_weekday`)
          }
          conditionJson = JSON.stringify(c)
        }

        // Parse optional expires_at (ISO string → unix seconds)
        let expiresAt: number | null = null
        if (args.expires_at != null) {
          const ts = Date.parse(String(args.expires_at))
          if (isNaN(ts)) throw new Error(`expires_at must be a valid ISO 8601 datetime, got: "${args.expires_at}"`)
          expiresAt = Math.floor(ts / 1000)
        }

        // Warn if the next fire time looks further than expected (pinned day/month past the target minute)
        const nowSec = Math.floor(Date.now() / 1000)
        const secsUntilFire = nextRun - nowSec
        const suspiciouslyFar = secsUntilFire > 60 * 60 * 24 * 7 // > 1 week
        const hasPinnedDayMonth = !cronExpr.split(' ').slice(2, 4).every(f => f === '*')

        const row = mcpScheduleDb.upsert(randomUUID(), sessionId, cronExpr, prompt, label, once, nextRun, conditionJson, expiresAt)
        await notifyChanged(sessionId)

        let text = `Schedule created: "${label}" (${cronExpr})\nID: ${row.id}\nNext run: ${row.next_run_at ? new Date(row.next_run_at * 1000).toISOString() : 'unknown'}`
        if (conditionJson) {
          text += `\nCondition: ${conditionJson}`
        }
        if (expiresAt) {
          text += `\nExpires: ${new Date(expiresAt * 1000).toISOString()}`
          const firesLeft = countFiresBeforeExpiry(cronExpr, nextRun, expiresAt)
          if (firesLeft === 0) {
            text += `\n\n⚠️ WARNING: expires_at is before (or at) the first fire time — this schedule will never fire. Check your timezone conversion or adjust expires_at.`
          } else if (firesLeft === 1) {
            text += `\n\n⚠️ NOTE: This schedule will fire only once before expires_at. If you intended more fires, verify the cron expression or extends_at value.`
          }
        }
        if (suspiciouslyFar && hasPinnedDayMonth) {
          text += `\n\n⚠️ WARNING: next_run_at is ${Math.round(secsUntilFire / 86400)} day(s) from now. If you intended a near-future one-shot, the target minute may have already passed. Delete this schedule and recreate it targeting at least 3–4 minutes from now.`
        }

        return { content: [{ type: 'text', text }] }
      }

      case 'schedule_update': {
        const id = String(args.id ?? '').trim()
        if (!id) throw new Error('id is required')

        const existing = mcpScheduleDb.findById(id)
        if (!existing) throw new Error(`No schedule found with id "${id}"`)

        const patch: { cron?: string; prompt?: string; enabled?: boolean; nextRunAt?: number | null; condition?: string | null; expiresAt?: number | null } = {}
        if (typeof args.cron    === 'string')  { patch.cron = args.cron.trim(); patch.nextRunAt = nextFireAt(patch.cron) }
        if (typeof args.prompt  === 'string')  patch.prompt  = args.prompt.trim()
        if (typeof args.enabled === 'boolean') patch.enabled = args.enabled
        if (args.condition != null) {
          const c = args.condition as Record<string, unknown>
          if (!c.type || typeof c.type !== 'string') throw new Error('condition.type is required')
          patch.condition = JSON.stringify(c)
        }
        if (args.expires_at != null) {
          const ts = Date.parse(String(args.expires_at))
          if (isNaN(ts)) throw new Error(`expires_at must be a valid ISO 8601 datetime, got: "${args.expires_at}"`)
          patch.expiresAt = Math.floor(ts / 1000)
        }

        if (Object.keys(patch).length === 0) throw new Error('No fields to update — provide at least one of: cron, prompt, enabled, condition, expires_at')

        const updated = mcpScheduleDb.update(id, patch)
        if (!updated) throw new Error('Update failed — schedule may have been deleted')
        await notifyChanged(existing.session_id)

        return {
          content: [{
            type: 'text',
            text: `Schedule updated: "${updated.label ?? id}"\nCron: ${updated.cron}\nEnabled: ${updated.enabled === 1}\nCondition: ${updated.condition ?? 'none'}\nExpires: ${updated.expires_at ? new Date(updated.expires_at * 1000).toISOString() : 'never'}\nNext run: ${updated.next_run_at ? new Date(updated.next_run_at * 1000).toISOString() : 'unknown'}`,
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
