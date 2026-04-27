/**
 * opencode `run --format json` lines use `type: "tool_use"` with a `part` object.
 * The Claude CLI instead sends `assistant` / `user` message shapes. The worker and
 * HTTP chat path merge tool metadata into a {@link StoredToolCall} list — this
 * normalizes a single opencode `tool_use` line into that map.
 */

import { extractToolDetail, type StoredToolCall } from '../claude/toolDetail.js'

function toolOutputToString(out: unknown): string {
  if (typeof out === 'string') return out
  if (out == null) return ''
  return JSON.stringify(out)
}

/**
 * Merges one opencode `tool_use` JSON object into a tool-call map (keyed by call ID).
 * Safe to call for every `tool_use` line; idempotent for the same `callID`.
 */
export function applyOpencodeToolUseToMap(
  c: Record<string, unknown>,
  map: Map<string, StoredToolCall>,
): void {
  if (c.type !== 'tool_use' || !c.part || typeof c.part !== 'object') return
  const part = c.part as Record<string, unknown>
  const tool = part.tool
  const callID = part.callID
  if (typeof tool !== 'string' || typeof callID !== 'string') return
  const state = (part.state as Record<string, unknown>) ?? {}
  const input = (state.input as Record<string, unknown>) ?? {}
  let entry = map.get(callID)
  if (!entry) {
    entry = {
      id: callID,
      name: tool,
      detail: extractToolDetail(tool, input),
    }
    map.set(callID, entry)
  } else {
    if (!entry.detail) entry.detail = extractToolDetail(tool, input)
  }
  if (state.status === 'completed' && 'output' in state) {
    entry.output = toolOutputToString(state.output)
    const exit = (state.metadata as { exit?: number } | undefined)?.exit
    if (typeof exit === 'number') {
      entry.isError = exit !== 0
    }
  }
}

/** Append assistant text from an opencode `type: "text"` line. */
export function opencodeTextFromChunk(c: Record<string, unknown>): string {
  if (c.type !== 'text' || !c.part || typeof c.part !== 'object') return ''
  const t = (c.part as { text?: string }).text
  return typeof t === 'string' ? t : ''
}
