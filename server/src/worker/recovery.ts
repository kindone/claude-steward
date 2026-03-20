/**
 * Recovers in-flight Claude jobs after an HTTP server restart.
 *
 * On each worker reconnect, queries steward.db for any messages still in
 * 'streaming' status (left over from the previous server process), subscribes
 * to each via the worker client, and finalises them when they complete.
 *
 * After all streaming rows are resolved — or after a 30s timeout — calls
 * markStaleStreamingMessages() to interrupt any that the worker no longer
 * knows about (e.g. worker also restarted).
 */

import { extractToolDetail } from '../claude/toolDetail.js'
import { messageQueries, markStaleStreamingMessages } from '../db/index.js'
import { notifyWatchers } from '../lib/sessionWatchers.js'
import { workerClient } from './client.js'
import type { WorkerEvent } from './protocol.js'

const RECOVERY_TIMEOUT_MS = 30_000

export function recoverStreamingSessions(): void {
  const streaming = messageQueries.listStreaming()

  if (streaming.length === 0) {
    markStaleStreamingMessages()
    return
  }

  console.log(`[recovery] found ${streaming.length} streaming message(s) — attempting recovery`)

  let pending = streaming.length
  let settled = false

  const settle = () => {
    if (settled) return
    settled = true
    clearTimeout(fallback)
    markStaleStreamingMessages()
  }

  const done = () => {
    pending--
    if (pending === 0) settle()
  }

  // Fallback: if the worker also restarted and doesn't know about these jobs,
  // the status queries may never resolve. Give up after 30s.
  const fallback = setTimeout(() => {
    console.warn('[recovery] timed out — marking remaining streaming messages as interrupted')
    settle()
  }, RECOVERY_TIMEOUT_MS)

  for (const msg of streaming) {
    let streamingContent = msg.content  // already has partial content from periodic flushes
    const toolCallsMap = new Map<string, { id: string; name: string; detail?: string; output?: string; isError?: boolean }>()

    const toolCallsJson = () => toolCallsMap.size > 0 ? JSON.stringify([...toolCallsMap.values()]) : undefined

    workerClient.subscribe(msg.session_id, (event: WorkerEvent) => {
      switch (event.type) {
        case 'chunk': {
          // Accumulate text deltas so the row stays current during recovery streaming
          const c = event.chunk as Record<string, unknown>
          if (c.type === 'stream_event') {
            const delta = ((c.event as Record<string, unknown>)?.delta as Record<string, unknown>)
            if (delta?.type === 'text_delta') {
              streamingContent += String(delta.text ?? '')
              messageQueries.updateStreamingContent(msg.id, streamingContent)
            }
          }
          // Accumulate tool calls from assembled assistant chunks
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
          // Accumulate tool results from user chunks
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
        case 'done':
          workerClient.unsubscribe(msg.session_id)
          messageQueries.finalizeMessage(msg.id, event.content || streamingContent, false, undefined, toolCallsJson())
          notifyWatchers(msg.session_id)
          console.log(`[recovery] session ${msg.session_id} completed`)
          done()
          break
        case 'error':
          workerClient.unsubscribe(msg.session_id)
          messageQueries.finalizeMessage(msg.id, event.content || streamingContent, true, event.errorCode, toolCallsJson())
          notifyWatchers(msg.session_id)
          console.log(`[recovery] session ${msg.session_id} errored: ${event.errorCode}`)
          done()
          break
        case 'result_reply': {
          // Job finished while we were disconnected — result fetched from worker DB
          workerClient.unsubscribe(msg.session_id)
          const mergedTools = event.toolCalls ?? toolCallsJson() ?? undefined
          if (event.status === 'complete') {
            messageQueries.finalizeMessage(msg.id, event.content || streamingContent, false, undefined, mergedTools)
            notifyWatchers(msg.session_id)
            console.log(`[recovery] session ${msg.session_id} recovered from worker DB`)
          } else if (event.status === 'interrupted') {
            messageQueries.finalizeMessage(msg.id, event.content || streamingContent, true, event.errorCode ?? 'process_error', mergedTools)
            notifyWatchers(msg.session_id)
            console.log(`[recovery] session ${msg.session_id} interrupted in worker DB`)
          }
          // not_found: leave as streaming — settle() via markStaleStreamingMessages will interrupt it
          done()
          break
        }
        case 'status_reply':
          if (event.status === 'idle') {
            // Job finished while we were disconnected — fetch stored result
            workerClient.send({ type: 'get_result', sessionId: msg.session_id })
          }
          // If running: subscription stays active; we'll receive chunk/done/error events
          break
        default:
          break
      }
    })

    workerClient.send({ type: 'status', sessionId: msg.session_id })
  }
}
