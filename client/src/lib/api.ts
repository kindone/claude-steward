const JSON_HEADERS: HeadersInit = { 'Content-Type': 'application/json' }

// Include credentials (session cookie) in every request.
const credentialsOpt = { credentials: 'include' } as const

// ── Auth ─────────────────────────────────────────────────────────────────────

export type AuthStatus = {
  authenticated: boolean
  hasCredentials: boolean
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status', credentialsOpt)
  if (!res.ok) throw new Error('Failed to fetch auth status')
  return res.json() as Promise<AuthStatus>
}

export async function startRegistration(): Promise<unknown> {
  const res = await fetch('/api/auth/register/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Failed to start registration (${res.status})`)
  }
  return res.json()
}

export async function finishRegistration(response: unknown): Promise<void> {
  const res = await fetch('/api/auth/register/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Registration failed')
  }
}

export async function startLogin(): Promise<unknown> {
  const res = await fetch('/api/auth/login/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Failed to start login')
  }
  return res.json()
}

export async function finishLogin(response: unknown): Promise<void> {
  const res = await fetch('/api/auth/login/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Login failed')
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', ...credentialsOpt })
}

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

export type Project = {
  id: string
  name: string
  path: string
  allow_all_tools: number   // legacy
  permission_mode: PermissionMode
  system_prompt: string | null
  created_at: number
}

export type FileEntry = {
  name: string
  type: 'file' | 'directory'
  path: string
}

export type Session = {
  id: string
  title: string
  claude_session_id: string | null
  project_id: string | null
  system_prompt: string | null
  permission_mode: PermissionMode
  created_at: number
  updated_at: number
}

export type Message = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  is_error: number        // 0 = normal, 1 = error message
  error_code: string | null
  status: 'complete' | 'streaming' | 'interrupted'
  tool_calls: string | null  // JSON-encoded ToolCall array, null if none
  created_at: number
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects', { headers: JSON_HEADERS, ...credentialsOpt })
  if (!res.ok) throw new Error('Failed to list projects')
  return res.json() as Promise<Project[]>
}

export async function createProject(name: string, path: string): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, path }),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
    throw new Error(body.error ?? 'Failed to create project')
  }
  return res.json() as Promise<Project>
}

export async function fetchMeta(): Promise<{ appRoot: string }> {
  const res = await fetch('/api/meta')
  if (!res.ok) throw new Error('Failed to fetch meta')
  return res.json() as Promise<{ appRoot: string }>
}

export async function updateProject(projectId: string, patch: { permissionMode?: PermissionMode; systemPrompt?: string | null }): Promise<Project> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to update project')
  return res.json() as Promise<Project>
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to delete project')
}

export async function listFiles(projectId: string, filePath = ''): Promise<FileEntry[]> {
  const url = `/api/projects/${projectId}/files${filePath ? `?path=${encodeURIComponent(filePath)}` : ''}`
  const res = await fetch(url, { headers: JSON_HEADERS, ...credentialsOpt })
  if (!res.ok) throw new Error('Failed to list files')
  return res.json() as Promise<FileEntry[]>
}

export type FileContent = { content: string; lastModified: number }

export async function getFileContent(projectId: string, filePath: string): Promise<FileContent> {
  const res = await fetch(
    `/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`,
    { headers: JSON_HEADERS, ...credentialsOpt }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
    throw new Error(body.error ?? 'Failed to load file')
  }
  return res.json() as Promise<FileContent>
}

/** Thrown by patchFile when the server detects a concurrent modification. */
export class FileConflictError extends Error {
  constructor() { super('File was modified externally'); this.name = 'FileConflictError' }
}

/**
 * Atomically write new content to a project file.
 * Pass `lastModified` for optimistic locking (server returns 409 if mtime changed).
 * Pass `force: true` to overwrite regardless.
 */
export async function patchFile(
  projectId: string,
  filePath: string,
  content: string,
  lastModified?: number,
  force = false,
): Promise<{ lastModified: number }> {
  const res = await fetch(`/api/projects/${projectId}/files`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ path: filePath, content, lastModified, force }),
    ...credentialsOpt,
  })
  if (res.status === 409) throw new FileConflictError()
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
    throw new Error(body.error ?? 'Failed to save file')
  }
  return res.json() as Promise<{ lastModified: number }>
}

// ── Push notifications ────────────────────────────────────────────────────────

/** Fetch the server's VAPID public key (avoids needing a build-time env var). */
export async function getVapidPublicKey(): Promise<string> {
  const res = await fetch('/api/push/vapid-public-key', credentialsOpt)
  if (!res.ok) throw new Error('Push not configured on server')
  const data = await res.json() as { key: string }
  return data.key
}

export async function savePushSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to save push subscription')
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify({ endpoint }),
    ...credentialsOpt,
  })
}

// ── Exec ──────────────────────────────────────────────────────────────────────

export type ExecHandlers = {
  onOutput: (text: string) => void
  onDone: (exitCode: number) => void
  onError?: (message: string) => void
}

/**
 * Run a shell command in the project directory and stream output via SSE.
 * Returns a cancel function that aborts the request and kills the process.
 */
export function execCommand(projectId: string, command: string, handlers: ExecHandlers): () => void {
  const controller = new AbortController()

  fetch(`/api/projects/${projectId}/exec`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ command }),
    signal: controller.signal,
    ...credentialsOpt,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({ error: 'Failed to run command' })) as { error: string }
      handlers.onError?.(body.error ?? 'Failed to run command')
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let pendingEvent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trimEnd()
        if (t.startsWith('event: ')) {
          pendingEvent = t.slice(7)
        } else if (t.startsWith('data: ')) {
          try {
            const data = JSON.parse(t.slice(6)) as { text?: string; exitCode?: number; message?: string }
            if (pendingEvent === 'output' && data.text !== undefined) handlers.onOutput(data.text)
            else if (pendingEvent === 'done' && data.exitCode !== undefined) handlers.onDone(data.exitCode)
            else if (pendingEvent === 'error') handlers.onError?.(data.message ?? 'Error')
          } catch { /* ignore malformed */ }
          pendingEvent = ''
        }
      }
    }
  }).catch((err: unknown) => {
    if ((err as Error).name !== 'AbortError') handlers.onError?.((err as Error).message ?? 'Connection failed')
  })

  return () => controller.abort()
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(projectId: string): Promise<Session> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ projectId }),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to create session')
  return res.json() as Promise<Session>
}

export async function listSessions(projectId?: string | null): Promise<Session[]> {
  const url = projectId ? `/api/sessions?projectId=${projectId}` : '/api/sessions'
  const res = await fetch(url, { headers: JSON_HEADERS, ...credentialsOpt })
  if (!res.ok) throw new Error('Failed to list sessions')
  return res.json() as Promise<Session[]>
}

export type MessagesPage = { messages: Message[]; hasMore: boolean }

export async function getMessages(
  sessionId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<MessagesPage> {
  const params = new URLSearchParams({ limit: String(opts.limit ?? 50) })
  if (opts.before) params.set('before', opts.before)
  const res = await fetch(`/api/sessions/${sessionId}/messages?${params}`, { headers: JSON_HEADERS, ...credentialsOpt })
  if (!res.ok) throw new Error('Failed to load messages')
  return res.json() as Promise<MessagesPage>
}

/**
 * Subscribe to session completion via SSE.
 * The server sends `event: done` the moment the assistant message is persisted.
 * Returns a cancel function; call it to close the connection.
 */
export function watchSession(
  sessionId: string,
  onDone: () => void,
  onError?: () => void,
): () => void {
  const es = new EventSource(`/api/sessions/${sessionId}/watch`, { withCredentials: true })
  es.addEventListener('done', () => { es.close(); onDone() })
  es.onerror = () => { es.close(); onError?.() }
  return () => es.close()
}

export async function renameSession(sessionId: string, title: string): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title }),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to rename session')
  return res.json() as Promise<Session>
}

export async function updateSystemPrompt(sessionId: string, systemPrompt: string | null): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ systemPrompt }),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to update system prompt')
  return res.json() as Promise<Session>
}

export async function updatePermissionMode(sessionId: string, permissionMode: PermissionMode): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ permissionMode }),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to update permission mode')
  return res.json() as Promise<Session>
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to delete session')
}

export type AppEventHandlers = {
  onReload?: () => void
}

// Connect to the app-level SSE stream. Reconnects automatically on drop.
// Returns a cancel function to close the connection.
export function subscribeToAppEvents(handlers: AppEventHandlers): () => void {
  let cancelled = false
  let controller = new AbortController()

  async function connect() {
    if (cancelled) return
    controller = new AbortController()
    try {
      const res = await fetch('/api/events', {
        headers: JSON_HEADERS,
        signal: controller.signal,
        ...credentialsOpt,
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let pendingEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) { pendingEvent = line.slice(7).trim(); continue }
          if (line.startsWith('data: ')) {
            if (pendingEvent === 'reload') handlers.onReload?.()
            pendingEvent = ''
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
    }
    // Reconnect after 3s on unexpected drop
    if (!cancelled) setTimeout(connect, 3000)
  }

  connect()
  return () => { cancelled = true; controller.abort() }
}

export type ClaudeErrorCode = 'session_expired' | 'context_limit' | 'process_error' | 'http_error' | 'connection_lost'

/** A single tool invocation with the key detail extracted from its input. */
export type ToolCall = {
  id: string
  name: string
  /** Human-readable summary of what the tool is doing (command, file path, query…). */
  detail?: string
  output?: string
  isError?: boolean
}

/** Pull the most useful field out of a tool's input object. */
function extractToolDetail(name: string, input: Record<string, unknown>): string | undefined {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined)
  switch (name) {
    case 'Bash':      return str(input.command)?.replace(/\s+/g, ' ').slice(0, 100)
    case 'Read':      return str(input.file_path)
    case 'Edit':
    case 'Write':
    case 'MultiEdit': return str(input.file_path)
    case 'WebSearch': return str(input.query)?.slice(0, 80)
    case 'WebFetch':  return str(input.url)?.slice(0, 80)
    default:          return undefined
  }
}

export type UsageInfo = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  total_cost_usd?: number
}

export type ChunkHandler = {
  onTextDelta: (text: string) => void
  onTitle?: (title: string) => void
  onDone: () => void
  onError: (message: string, code?: ClaudeErrorCode) => void
  /** Fired when a tool starts streaming its input (name only, no detail yet). Pass null to clear. */
  onToolActivity?: (toolName: string | null) => void
  /** Fired when a complete tool call is assembled (name + detail from input). */
  onToolCall?: (call: ToolCall) => void
  onToolResult?: (toolUseId: string, output: string, isError: boolean) => void
  onActivity?: () => void
  /** Fired with token usage when the result chunk arrives (if Claude CLI exposes it). */
  onUsage?: (usage: UsageInfo) => void
}

export function sendMessage(
  sessionId: string,
  message: string,
  handlers: ChunkHandler
): () => void {
  const controller = new AbortController()

  fetch('/api/chat', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, message }),
    signal: controller.signal,
    ...credentialsOpt,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text()
        handlers.onError(`HTTP ${res.status}: ${body}`, 'http_error')
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let activityFired = false
      let pendingEvent = ''
      let doneFired = false
      let errorFired = false

      // Inactivity timeout — if no data arrives for 90s, treat as a hung connection.
      // Reset on every chunk; cleared when stream ends normally.
      const INACTIVITY_MS = 90_000
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null
      const resetInactivity = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer)
        inactivityTimer = setTimeout(() => {
          reader.cancel()
          if (!doneFired && !errorFired) {
            errorFired = true
            handlers.onError('No response from server — connection timed out', 'process_error')
          }
        }, INACTIVITY_MS)
      }
      resetInactivity()

      function processLines(lines: string[]): void {
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            pendingEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6)
            if (pendingEvent === 'done') {
              doneFired = true
              handlers.onDone()
            } else if (pendingEvent === 'title') {
              try {
                const payload = JSON.parse(raw) as { title: string }
                handlers.onTitle?.(payload.title)
              } catch { /* ignore */ }
            } else if (pendingEvent === 'error') {
              errorFired = true
              try {
                const payload = JSON.parse(raw) as { message: string; code?: ClaudeErrorCode }
                handlers.onError(payload.message, payload.code)
              } catch {
                handlers.onError(raw)
              }
            } else if (pendingEvent === 'chunk') {
              try {
                const chunk = JSON.parse(raw) as {
                  type: string
                  event?: {
                    type: string
                    delta?: { type: string; text: string }
                    content_block?: { type: string; name?: string }
                  }
                  // assistant chunks carry the assembled message with full tool inputs
                  message?: {
                    role?: string
                    content?: Array<{
                      type: string
                      id?: string
                      name?: string
                      input?: Record<string, unknown>
                      tool_use_id?: string
                      is_error?: boolean
                    }>
                  }
                }
                if (chunk.type === 'stream_event') {
                  const evt = chunk.event
                  if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
                    // Tool is starting to stream its input — show name immediately as live indicator
                    handlers.onToolActivity?.(evt.content_block.name ?? 'tool')
                  } else if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                    handlers.onToolActivity?.(null)   // clear indicator when text arrives
                    handlers.onTextDelta(evt.delta.text)
                  }
                } else if (chunk.type === 'assistant') {
                  // Full tool call assembled (--include-partial-messages) — extract name + detail
                  for (const block of chunk.message?.content ?? []) {
                    if (block.type === 'tool_use' && block.name) {
                      handlers.onToolCall?.({
                        id: block.id ?? '',
                        name: block.name,
                        detail: extractToolDetail(block.name, block.input ?? {}),
                      })
                    }
                  }
                } else if (chunk.type === 'user') {
                  for (const block of chunk.message?.content ?? []) {
                    if (block.type === 'tool_result' && block.tool_use_id !== undefined) {
                      handlers.onToolResult?.(
                        block.tool_use_id,
                        (block as unknown as { content: string }).content ?? '',
                        block.is_error ?? false,
                      )
                    }
                  }
                } else if (chunk.type === 'result') {
                  const r = chunk as unknown as { usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; total_cost_usd?: number }
                  if (r.usage) {
                    handlers.onUsage?.({ ...r.usage, total_cost_usd: r.total_cost_usd })
                  }
                }
              } catch {
                // ignore malformed chunks
              }
            }
            pendingEvent = ''
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        if (!activityFired) { activityFired = true; handlers.onActivity?.() }
        resetInactivity()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        processLines(lines)
      }
      if (inactivityTimer) clearTimeout(inactivityTimer)
      // Process any remaining buffer (final "event: done\ndata: ..." or "data: ..." when event was in previous chunk)
      if (buffer.trim()) processLines(buffer.split('\n'))
      // If we had "event: done" at end of previous chunk and no data in last chunk, stream ended without data — still stop spinner
      if (pendingEvent === 'done') { doneFired = true; handlers.onDone() }
      // Stream ended without a terminal event — server likely restarted or connection dropped
      if (!doneFired && !errorFired) {
        errorFired = true
        handlers.onError('Connection lost — server may have restarted', 'connection_lost')
      }
    })
    .catch((err: Error) => {
      if (err.name !== 'AbortError') {
        handlers.onError(err.message)
      }
    })

  return () => controller.abort()
}

/**
 * Ask the server to kill the in-progress Claude subprocess for this session.
 * Fire-and-forget; the caller should also abort the SSE fetch via the cancel
 * function returned by sendMessage.
 */
export function stopChat(sessionId: string): void {
  fetch(`/api/chat/${sessionId}`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
    ...credentialsOpt,
  }).catch(() => { /* ignore */ })
}

/**
 * Compact a session: summarizes it via Claude and creates a new session
 * primed with that summary. Returns the new session ID.
 */
export async function compactSession(sessionId: string): Promise<{ sessionId: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/compact`, {
    method: 'POST',
    headers: JSON_HEADERS,
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Compact failed: ${body}`)
  }
  return res.json() as Promise<{ sessionId: string }>
}
