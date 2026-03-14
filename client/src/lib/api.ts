const API_KEY = import.meta.env.VITE_API_KEY as string

const authHeaders = (): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${API_KEY}`,
})

export type Project = {
  id: string
  name: string
  path: string
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
  created_at: number
  updated_at: number
}

export type Message = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects', { headers: authHeaders() })
  if (!res.ok) throw new Error('Failed to list projects')
  return res.json() as Promise<Project[]>
}

export async function createProject(name: string, path: string): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, path }),
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

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('Failed to delete project')
}

export async function listFiles(projectId: string, filePath = ''): Promise<FileEntry[]> {
  const url = `/api/projects/${projectId}/files${filePath ? `?path=${encodeURIComponent(filePath)}` : ''}`
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error('Failed to list files')
  return res.json() as Promise<FileEntry[]>
}

export async function getFileContent(projectId: string, filePath: string): Promise<string> {
  const res = await fetch(
    `/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`,
    { headers: authHeaders() }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
    throw new Error(body.error ?? 'Failed to load file')
  }
  const data = await res.json() as { content: string }
  return data.content
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(projectId?: string | null): Promise<Session> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ projectId: projectId ?? null }),
  })
  if (!res.ok) throw new Error('Failed to create session')
  return res.json() as Promise<Session>
}

export async function listSessions(projectId?: string | null): Promise<Session[]> {
  const url = projectId ? `/api/sessions?projectId=${projectId}` : '/api/sessions'
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error('Failed to list sessions')
  return res.json() as Promise<Session[]>
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`, { headers: authHeaders() })
  if (!res.ok) throw new Error('Failed to load messages')
  return res.json() as Promise<Message[]>
}

export async function renameSession(sessionId: string, title: string): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error('Failed to rename session')
  return res.json() as Promise<Session>
}

export async function updateSystemPrompt(sessionId: string, systemPrompt: string | null): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ systemPrompt }),
  })
  if (!res.ok) throw new Error('Failed to update system prompt')
  return res.json() as Promise<Session>
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
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
        headers: authHeaders(),
        signal: controller.signal,
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

export type ClaudeErrorCode = 'session_expired' | 'process_error' | 'http_error'

export type ChunkHandler = {
  onTextDelta: (text: string) => void
  onTitle?: (title: string) => void
  onDone: () => void
  onError: (message: string, code?: ClaudeErrorCode) => void
  onActivity?: () => void
}

export function sendMessage(
  sessionId: string,
  message: string,
  handlers: ChunkHandler
): () => void {
  const controller = new AbortController()

  fetch('/api/chat', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId, message }),
    signal: controller.signal,
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

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        if (!activityFired) { activityFired = true; handlers.onActivity?.() }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let pendingEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            pendingEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6)
            if (pendingEvent === 'done') {
              handlers.onDone()
            } else if (pendingEvent === 'title') {
              try {
                const payload = JSON.parse(raw) as { title: string }
                handlers.onTitle?.(payload.title)
              } catch { /* ignore */ }
            } else if (pendingEvent === 'error') {
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
                  event?: { type: string; delta?: { type: string; text: string } }
                  message?: { content?: Array<{ type: string; text: string }> }
                }
                if (
                  chunk.type === 'stream_event' &&
                  chunk.event?.type === 'content_block_delta' &&
                  chunk.event.delta?.type === 'text_delta'
                ) {
                  handlers.onTextDelta(chunk.event.delta.text)
                }
              } catch {
                // ignore malformed chunks
              }
            }
            pendingEvent = ''
          }
        }
      }
    })
    .catch((err: Error) => {
      if (err.name !== 'AbortError') {
        handlers.onError(err.message)
      }
    })

  return () => controller.abort()
}
