/**
 * IPC protocol between the HTTP server and the apps sidecar process.
 * Transport: Unix domain socket at APPS_SOCKET_PATH.
 * Framing: newline-delimited JSON (NDJSON) — one JSON object per line.
 *
 * Design: request/reply — each command from the server gets exactly one reply
 * from the sidecar. The sidecar also broadcasts unsolicited CrashedEvents when
 * a managed child process exits unexpectedly.
 */

export const APPS_SOCKET_PATH = process.env.APPS_SOCKET ?? '/tmp/claude-apps.sock'

// ── Commands (HTTP server → sidecar) ─────────────────────────────────────────

/** Start a mini-app process. command is fully resolved (no {port} placeholder). */
export type StartAppCmd = {
  type: 'start'
  configId: string
  port: number
  command: string
  workDir: string
}

/** Stop a running mini-app process. Idempotent — safe to call if already stopped. */
export type StopAppCmd = {
  type: 'stop'
  configId: string
}

/** Query all currently running processes. */
export type StatusCmd = {
  type: 'status'
}

export type AppsCommand = StartAppCmd | StopAppCmd | StatusCmd

// ── Replies (sidecar → HTTP server) ──────────────────────────────────────────

export type StartedReply = {
  type: 'started'
  configId: string
  pid: number
}

export type StoppedReply = {
  type: 'stopped'
  configId: string
}

export type ErrorReply = {
  type: 'error'
  configId: string
  error: string
}

export type AppProcessInfo = {
  configId: string
  port: number
  pid: number
  uptimeMs: number
}

export type StatusReply = {
  type: 'status'
  apps: AppProcessInfo[]
}

/** Broadcast when a managed child exits unexpectedly (not via a stop command). */
export type CrashedEvent = {
  type: 'crashed'
  configId: string
  exitCode: number | null
}

export type AppsReply = StartedReply | StoppedReply | ErrorReply | StatusReply | CrashedEvent
