/**
 * IPC protocol between the HTTP server and the Claude worker process.
 * Transport: Unix domain socket at SOCKET_PATH.
 * Framing: newline-delimited JSON (NDJSON) — one JSON object per line.
 */

export const SOCKET_PATH = process.env.WORKER_SOCKET ?? '/tmp/claude-worker.sock'

// ── Commands (HTTP server → worker) ──────────────────────────────────────────

export type StartCmd = {
  type: 'start'
  sessionId: string
  prompt: string
  claudeSessionId: string | null
  projectPath: string
  permissionMode: string | null
  systemPrompt: string | null
  model?: string | null
}

export type StopCmd = {
  type: 'stop'
  sessionId: string
}

export type StatusCmd = {
  type: 'status'
  sessionId: string
}

export type GetResultCmd = {
  type: 'get_result'
  sessionId: string
}

export type WorkerCommand = StartCmd | StopCmd | StatusCmd | GetResultCmd

// ── Events (worker → HTTP server) ────────────────────────────────────────────

/** Raw Claude CLI chunk — passed through to the SSE client as-is */
export type ChunkEvent = {
  type: 'chunk'
  sessionId: string
  chunk: unknown
}

/** Tool result arrived (user chunk with tool_result block) */
export type ToolResultEvent = {
  type: 'tool_result'
  sessionId: string
  toolUseId: string
  output: string
  isError: boolean
}

/** Claude session ID resolved from the system init chunk */
export type SessionIdEvent = {
  type: 'session_id'
  sessionId: string
  claudeSessionId: string
}

/** Job completed successfully */
export type DoneEvent = {
  type: 'done'
  sessionId: string
  content: string
  claudeSessionId: string
}

/** Job failed */
export type ErrorEvent = {
  type: 'error'
  sessionId: string
  errorCode: string
  message: string
  content: string
}

/** Response to a status query */
export type StatusReplyEvent = {
  type: 'status_reply'
  sessionId: string
  status: 'running' | 'idle'
  partialContent?: string
}

/** Response to a get_result query — returns final content from worker DB */
export type ResultReplyEvent = {
  type: 'result_reply'
  sessionId: string
  status: 'complete' | 'interrupted' | 'not_found'
  content: string
  errorCode: string | null
  /** JSON array of StoredToolCall — persisted by worker on job completion */
  toolCalls?: string | null
}

export type WorkerEvent =
  | ChunkEvent
  | ToolResultEvent
  | SessionIdEvent
  | DoneEvent
  | ErrorEvent
  | StatusReplyEvent
  | ResultReplyEvent
