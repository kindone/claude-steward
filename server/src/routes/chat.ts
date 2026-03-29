import { Router } from 'express'
import type { Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { sessionQueries, messageQueries, projectQueries } from '../db/index.js'
import { spawnClaude } from '../claude/process.js'
import { notifyWatchers, notifySubscribers } from '../lib/sessionWatchers.js'
import { registerChat, unregisterChat, abortChat } from '../lib/activeChats.js'
import { notifyAll } from '../lib/pushNotifications.js'
import { extractToolDetail } from '../claude/toolDetail.js'
import { workerClient } from '../worker/client.js'
import { buildEffectiveSystemPrompt } from '../lib/schedulePrompt.js'
import { extractScheduleBlocks } from '../lib/parseScheduleBlocks.js'
import { scheduleQueries } from '../db/index.js'
import { nextFireAt } from '../lib/scheduler.js'
import { v4 as uuidv4ForSchedule } from 'uuid'

function sendSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Parse <schedule> blocks from assistant text, create the schedules, and return stripped text.
 * Called after every assistant response so natural-language scheduling works.
 */
function processScheduleBlocks(text: string, sessionId: string): string {
  const { schedules, strippedText } = extractScheduleBlocks(text)
  for (const s of schedules) {
    try {
      const nextRun = nextFireAt(s.cron)
      scheduleQueries.create(uuidv4ForSchedule(), sessionId, s.cron, s.prompt, nextRun, s.once)
      console.log(`[scheduler] created schedule for session ${sessionId}: ${s.label} (${s.cron})`)
    } catch (err) {
      console.error('[scheduler] failed to create schedule from response block:', err)
    }
  }
  return strippedText
}

/** Truncate the first message to a readable title (max 40 chars, breaks on word boundary). */
function generateTitle(message: string): string {
  const text = message.trim().replace(/\s+/g, ' ')
  if (text.length <= 40) return text
  const truncated = text.slice(0, 40)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…'
}

const router = Router()

router.post('/', (req, res) => {
  const { sessionId, message } = req.body as { sessionId?: string; message?: string }

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' })
    return
  }

  const session = sessionQueries.findById(sessionId)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  // Auto-title: on the first message of a session, derive a title from the message text.
  let titleUpdate: string | null = null
  if (session.title === 'New Chat') {
    titleUpdate = generateTitle(message)
    sessionQueries.updateTitle(titleUpdate, sessionId)
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Emit the new title immediately so the sidebar updates before the first token arrives.
  if (titleUpdate) {
    sendSseEvent(res, 'title', { title: titleUpdate })
  }

  messageQueries.insert(uuidv4(), sessionId, 'user', message)

  const project = session.project_id ? projectQueries.findById(session.project_id) : undefined

  // ── Shared completion handlers ─────────────────────────────────────────────

  // Set to true if the client SSE connection dropped before the job finished.
  // Used to decide whether to send a push notification on completion.
  let clientDisconnectedEarly = false

  // persistMsg=false for the worker path (streaming row already finalized via finalizeMessage).
  // persistMsg=true (default) for the direct-spawn path (no streaming row, insert here).
  const onComplete = (assistantText: string, persistMsg = true) => {
    unregisterChat(sessionId)
    const cleanText = processScheduleBlocks(assistantText, sessionId)
    if (cleanText && persistMsg) {
      messageQueries.insert(uuidv4(), sessionId, 'assistant', cleanText)
    }
    const notified = notifyWatchers(sessionId)
    notifySubscribers(sessionId)
    if (notified === 0 && clientDisconnectedEarly && cleanText) {
      const preview = cleanText.replace(/\s+/g, ' ').trim().slice(0, 80)
      void notifyAll({
        title: session.title === 'New Chat' ? 'Claude replied' : session.title,
        body: preview + (cleanText.length > 80 ? '…' : ''),
        url: `/?session=${sessionId}`,
      })
    }
  }

  const onError = (message: string, code: string, persistMsg: boolean) => {
    unregisterChat(sessionId)
    if (session.claude_session_id) {
      sessionQueries.clearClaudeSessionId(sessionId)
      session.claude_session_id = null
    }
    // Worker path calls finalize() before onError so the streaming row is already updated.
    // Direct-spawn path has no streaming row, so we insert here.
    if (persistMsg) messageQueries.insert(uuidv4(), sessionId, 'assistant', message, true, code)
    notifyWatchers(sessionId)
    notifySubscribers(sessionId)
    sendSseEvent(res, 'error', { message, code })
    if (!res.writableEnded) res.end()
  }

  // ── Worker path ────────────────────────────────────────────────────────────

  if (workerClient.isConnected()) {
    // Insert a streaming placeholder immediately so partial content survives a server restart.
    const streamingMsgId = uuidv4()
    messageQueries.insertStreaming(streamingMsgId, sessionId)

    let streamingText = ''
    const flushTimer = setInterval(() => {
      if (streamingText) messageQueries.updateStreamingContent(streamingMsgId, streamingText)
    }, 3_000)

    // Accumulate tool calls for persistence: keyed by tool_use_id
    const toolCallsMap = new Map<string, { id: string; name: string; detail?: string; output?: string; isError?: boolean }>()

    const finalize = (content: string, isError: boolean, errorCode?: string) => {
      clearInterval(flushTimer)
      const toolCallsJson = toolCallsMap.size > 0 ? JSON.stringify([...toolCallsMap.values()]) : undefined
      messageQueries.finalizeMessage(streamingMsgId, content, isError, errorCode, toolCallsJson)
    }

    workerClient.subscribe(sessionId, (event) => {
      switch (event.type) {
        case 'chunk': {
          sendSseEvent(res, 'chunk', event.chunk)
          const c = event.chunk as Record<string, unknown>
          // Accumulate text deltas for periodic DB flush
          if (c.type === 'stream_event') {
            const delta = ((c.event as Record<string, unknown>)?.delta as Record<string, unknown>)
            if (delta?.type === 'text_delta') streamingText += String(delta.text ?? '')
          }
          // Capture assembled tool calls from assistant chunks
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
          // Capture tool results from user chunks
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
            sessionQueries.updateClaudeSessionId(event.claudeSessionId, sessionId)
            session.claude_session_id = event.claudeSessionId
          }
          break
        case 'done': {
          workerClient.unsubscribe(sessionId)
          const cleanContent = processScheduleBlocks(event.content, sessionId)
          finalize(cleanContent, false)
          sendSseEvent(res, 'done', { session_id: event.claudeSessionId })
          if (!res.writableEnded) res.end()
          onComplete(cleanContent, false)
          break
        }
        case 'error':
          workerClient.unsubscribe(sessionId)
          finalize(event.message, true, event.errorCode)
          onError(event.message, event.errorCode, false)  // streaming row already finalized
          break
      }
    })

    workerClient.send({
      type: 'start',
      sessionId,
      prompt: message,
      claudeSessionId: session.claude_session_id,
      projectPath: project?.path ?? process.cwd(),
      permissionMode: session.permission_mode,
      systemPrompt: buildEffectiveSystemPrompt(session),
    })

    res.on('close', () => {
      // Client disconnected early — mark flag for push notification decision, but do NOT
      // unsubscribe from the worker. The handler must stay alive so that when the job
      // completes, finalize() + notifyWatchers() still fire (enabling watchSession recovery).
      if (!res.writableEnded) {
        clientDisconnectedEarly = true
        res.end()
      }
    })
    return
  }

  // ── Direct-spawn fallback (worker not available) ───────────────────────────

  const controller = new AbortController()
  registerChat(sessionId, controller)

  spawnClaude({
    message,
    claudeSessionId: session.claude_session_id,
    systemPrompt: buildEffectiveSystemPrompt(session),
    permissionMode: session.permission_mode,
    res,
    signal: controller.signal,
    cwd: project?.path,
    onSessionId: (claudeSessionId) => {
      if (!session.claude_session_id) {
        sessionQueries.updateClaudeSessionId(claudeSessionId, sessionId)
        session.claude_session_id = claudeSessionId
      }
    },
    onComplete,
    onError: (err) => onError(err.message, err.code, true),  // no streaming row, persist here
  })

  res.on('close', () => {
    if (!res.writableEnded) res.end()
  })
})

/**
 * DELETE /api/chat/:sessionId
 * Explicitly stop an in-progress Claude run. Sends SIGTERM to the subprocess
 * without triggering the error path or persisting a partial response.
 */
router.delete('/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const workerStopped = workerClient.send({ type: 'stop', sessionId })
  const directStopped = abortChat(sessionId)
  res.status(workerStopped || directStopped ? 200 : 404).json({ stopped: workerStopped || directStopped })
})

export default router
