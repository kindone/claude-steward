/**
 * Headless send: inject a message into a session without an HTTP response object.
 * Used by the scheduler. Prefers the worker path; falls back to direct spawn.
 *
 * When source='scheduler':
 * - Does NOT insert a user message row — the trigger is invisible in chat
 * - Builds a rich context injection (datetime + recent conversation + task)
 * - Saves the assistant response with source='scheduler'
 */

import { v4 as uuidv4 } from 'uuid'
import type { Response } from 'express'
import { sessionQueries, messageQueries, projectQueries } from '../db/index.js'
import { spawnClaude } from '../claude/process.js'
import { workerClient } from '../worker/client.js'
import { extractToolDetail } from '../claude/toolDetail.js'
import { buildEffectiveSystemPrompt } from './schedulePrompt.js'

export type SendResult = {
  content: string
  errorCode?: string
}

export type SendOptions = {
  /** 'scheduler' = agent-initiated; no user message inserted, assistant saved with source */
  source?: string
}

/**
 * Build the rich context string injected as the internal user turn when firing a schedule.
 * Not saved to the DB — only passed to Claude so it knows what to do.
 */
function buildSchedulerContext(sessionId: string, task: string): string {
  const session = sessionQueries.findById(sessionId)
  const nowUtc = new Date()

  const utcStr = nowUtc.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  let localStr = ''
  if (session?.timezone) {
    try {
      localStr = nowUtc.toLocaleString('en-US', {
        timeZone: session.timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      }) + ` (${session.timezone})`
    } catch { /* ignore invalid timezone */ }
  }

  const timeBlock = localStr
    ? `Current time: ${localStr} / ${utcStr}`
    : `Current time: ${utcStr}`

  // Include last 6 messages for context
  const recent = messageQueries.listPaged(sessionId, 6)
  let contextBlock = ''
  if (recent.length > 0) {
    const lines = recent
      .filter((m) => m.source !== 'scheduler' || m.role === 'assistant') // include past scheduled responses
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim().slice(0, 300)}`)
      .join('\n')
    contextBlock = `\nRecent conversation:\n${lines}\n`
  }

  return `[Scheduled trigger]\n${timeBlock}\n${contextBlock}\nTask: ${task}`
}

/**
 * Send a message to a session and wait for the response.
 * Returns the assistant's final text (or errorCode on failure).
 * Throws if the session does not exist or is already streaming.
 */
export async function sendToSession(sessionId: string, message: string, opts: SendOptions = {}): Promise<SendResult> {
  const session = sessionQueries.findById(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)

  // Collision guard: skip if a message is already streaming in this session
  const recent = messageQueries.listPaged(sessionId, 1)
  const last = recent[recent.length - 1]
  if (last?.status === 'streaming') {
    throw new Error(`Session ${sessionId} is already streaming — skipping scheduled send`)
  }

  const isScheduler = opts.source === 'scheduler'

  // For scheduler: build context injection instead of a plain user message
  const effectivePrompt = isScheduler
    ? buildSchedulerContext(sessionId, message)
    : message

  // Only insert a user message for user-initiated sends
  if (!isScheduler) {
    messageQueries.insert(uuidv4(), sessionId, 'user', message)
  }

  const project = session.project_id ? projectQueries.findById(session.project_id) : undefined

  if (workerClient.isConnected()) {
    return sendViaWorker(session, effectivePrompt, project?.path, opts.source)
  }
  return sendViaDirect(session, effectivePrompt, project?.path, opts.source)
}

function sendViaWorker(
  session: ReturnType<typeof sessionQueries.findById> & object,
  prompt: string,
  projectPath?: string,
  source?: string,
): Promise<SendResult> {
  return new Promise((resolve) => {
    const streamingMsgId = uuidv4()
    messageQueries.insertStreaming(streamingMsgId, session.id)

    let streamingText = ''
    const flushTimer = setInterval(() => {
      if (streamingText) messageQueries.updateStreamingContent(streamingMsgId, streamingText)
    }, 3_000)

    const toolCallsMap = new Map<string, { id: string; name: string; detail?: string; output?: string; isError?: boolean }>()

    const finalize = (content: string, isError: boolean, errorCode?: string) => {
      clearInterval(flushTimer)
      const toolCallsJson = toolCallsMap.size > 0 ? JSON.stringify([...toolCallsMap.values()]) : undefined
      messageQueries.finalizeMessage(streamingMsgId, content, isError, errorCode, toolCallsJson, source)
    }

    workerClient.subscribe(session.id, (event) => {
      switch (event.type) {
        case 'chunk': {
          const c = event.chunk as Record<string, unknown>
          if (c.type === 'stream_event') {
            const delta = ((c.event as Record<string, unknown>)?.delta as Record<string, unknown>)
            if (delta?.type === 'text_delta') streamingText += String(delta.text ?? '')
          }
          if (c.type === 'assistant') {
            const content = (c.message as Record<string, unknown>)?.content as Array<Record<string, unknown>> ?? []
            for (const block of content) {
              if (block.type === 'tool_use' && block.name && block.id) {
                toolCallsMap.set(block.id as string, {
                  id: block.id as string,
                  name: block.name as string,
                  detail: extractToolDetail(block.name as string, (block.input as Record<string, unknown>) ?? {}),
                })
              }
            }
          }
          if (c.type === 'user') {
            const content = (c.message as Record<string, unknown>)?.content as Array<Record<string, unknown>> ?? []
            for (const block of content) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const existing = toolCallsMap.get(block.tool_use_id as string)
                if (existing) {
                  existing.output = (block.content as string) ?? ''
                  existing.isError = (block.is_error as boolean) ?? false
                }
              }
            }
          }
          break
        }
        case 'session_id':
          if (!session.claude_session_id) {
            sessionQueries.updateClaudeSessionId(event.claudeSessionId, session.id)
            session.claude_session_id = event.claudeSessionId
          }
          break
        case 'done':
          workerClient.unsubscribe(session.id)
          finalize(event.content, false)
          resolve({ content: event.content })
          break
        case 'error':
          workerClient.unsubscribe(session.id)
          finalize(event.message, true, event.errorCode)
          resolve({ content: event.message, errorCode: event.errorCode })
          break
      }
    })

    workerClient.send({
      type: 'start',
      sessionId: session.id,
      prompt,
      claudeSessionId: session.claude_session_id,
      projectPath: projectPath ?? process.cwd(),
      permissionMode: session.permission_mode,
      systemPrompt: buildEffectiveSystemPrompt(session),
    })
  })
}

function sendViaDirect(
  session: ReturnType<typeof sessionQueries.findById> & object,
  prompt: string,
  projectPath?: string,
  source?: string,
): Promise<SendResult> {
  return new Promise((resolve) => {
    // Minimal res shim — spawnClaude uses it only for SSE writes which we discard
    const nullRes = {
      writableEnded: false as boolean,
      write: () => true,
      end() { (this as { writableEnded: boolean }).writableEnded = true },
    } as unknown as Response

    spawnClaude({
      message: prompt,
      claudeSessionId: session.claude_session_id,
      systemPrompt: buildEffectiveSystemPrompt(session),
      permissionMode: session.permission_mode,
      res: nullRes,
      cwd: projectPath,
      onSessionId: (claudeSessionId) => {
        if (!session.claude_session_id) {
          sessionQueries.updateClaudeSessionId(claudeSessionId, session.id)
          session.claude_session_id = claudeSessionId
        }
      },
      onComplete: (text) => {
        messageQueries.insert(uuidv4(), session.id, 'assistant', text, false, undefined, source)
        resolve({ content: text })
      },
      onError: (err) => {
        messageQueries.insert(uuidv4(), session.id, 'assistant', err.message, true, err.code)
        resolve({ content: err.message, errorCode: err.code })
      },
    })
  })
}
