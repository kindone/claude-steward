import { Router } from 'express'
import type { Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { sessionQueries, messageQueries, projectQueries } from '../db/index.js'
import { spawnClaude } from '../claude/process.js'
import { notifyWatchers } from '../lib/sessionWatchers.js'
import { registerChat, unregisterChat, abortChat } from '../lib/activeChats.js'
import { notifyAll } from '../lib/pushNotifications.js'

function sendSseEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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

  const controller = new AbortController()
  registerChat(sessionId, controller)

  spawnClaude({
    message,
    claudeSessionId: session.claude_session_id,
    systemPrompt: session.system_prompt,
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
    onComplete: (assistantText) => {
      unregisterChat(sessionId)
      if (assistantText) {
        messageQueries.insert(uuidv4(), sessionId, 'assistant', assistantText)
      }
      // Notify any clients watching this session (returned after navigating away mid-stream).
      const notified = notifyWatchers(sessionId)
      // If no browser tab was watching, send a push notification instead.
      // Also skip push if the sending client is still connected (res not yet ended) —
      // notifyWatchers only tracks watchSession connections, not active sendMessage SSEs,
      // so we use res.writableEnded as the signal that the sender has disconnected.
      if (notified === 0 && res.writableEnded && assistantText) {
        const preview = assistantText.replace(/\s+/g, ' ').trim().slice(0, 80)
        void notifyAll({
          title: session.title === 'New Chat' ? 'Claude replied' : session.title,
          body: preview + (assistantText.length > 80 ? '…' : ''),
          url: `/?session=${sessionId}`,
        })
      }
    },
    onError: (err) => {
      unregisterChat(sessionId)
      // Clear the stale claude_session_id so the next message starts fresh
      // instead of looping on another failed --resume attempt.
      if (session.claude_session_id) {
        sessionQueries.clearClaudeSessionId(sessionId)
        session.claude_session_id = null
      }
      // Persist the error as an assistant message so it survives a page reload.
      messageQueries.insert(uuidv4(), sessionId, 'assistant', err.message, true, err.code)
      // Notify any clients watching this session (e.g. page was reloaded mid-stream).
      // Without this, their SSE connection parks forever and the spinner never clears.
      notifyWatchers(sessionId)
    },
  })

  // res.on('close') fires when the client disconnects (socket closed).
  // Do NOT use req.on('close') — it fires when the request body is consumed, not on disconnect.
  // We intentionally do NOT kill the Claude subprocess here — let it finish and persist to DB
  // so the response is available when the user returns to the session.
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
  const found = abortChat(req.params.sessionId)
  res.status(found ? 200 : 404).json({ stopped: found })
})

export default router
