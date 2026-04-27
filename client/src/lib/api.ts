const JSON_HEADERS: HeadersInit = { 'Content-Type': 'application/json' }

// Include credentials (session cookie) in every request.
const credentialsOpt = { credentials: 'include' } as const

/**
 * Returns true when an error is the result of an intentional stream abort.
 *
 * Browsers are inconsistent about what they throw when AbortController.abort()
 * is called while reading a fetch() body stream:
 *   - Chrome:  DOMException  { name: 'AbortError' }
 *   - Safari:  TypeError     { name: 'TypeError', message: 'BodyStreamBuffer was aborted' }
 *   - Firefox: DOMException  { name: 'AbortError' } (same as Chrome)
 *
 * Checking only err.name misses the Safari case, causing spurious error banners
 * and unnecessary reconnect cycles.
 */
function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'AbortError' || err.message.includes('BodyStreamBuffer was aborted')
}

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

export async function startRegistration(opts?: { bootstrapKey?: string }): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts?.bootstrapKey) headers['X-Bootstrap-Key'] = opts.bootstrapKey
  const res = await fetch('/api/auth/register/start', {
    method: 'POST',
    headers,
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

export async function loginWithApiKey(apiKey: string): Promise<void> {
  const res = await fetch('/api/auth/login/apikey', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ apiKey }),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Invalid API key')
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

/** Which CLI adapter drives a session. NOT NULL on the server side; the
 *  field is optional in this type only for older client builds reading a
 *  pre-migration session row over the wire. */
export type CliName = 'claude' | 'opencode'

export type Session = {
  id: string
  title: string
  claude_session_id: string | null
  project_id: string | null
  system_prompt: string | null
  permission_mode: PermissionMode
  timezone: string | null
  model: string | null
  cli?: CliName
  compacted_from: string | null
  created_at: number
  updated_at: number
}

export type ChainSegment = Session & { compactSummary: string | null }

export type Message = {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  is_error: number        // 0 = normal, 1 = error message
  error_code: string | null
  status: 'complete' | 'streaming' | 'interrupted'
  tool_calls: string | null  // JSON-encoded ToolCall array, null if none
  source: string | null      // null = user-initiated, 'scheduler' = agent-initiated scheduled message
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

/** One option in the chat UI's model picker, mirrored from the server's
 *  active CliAdapter. `value: null` means "no --model flag", letting the
 *  CLI / env-default decide. */
export type ModelOption = { value: string | null; label: string }

/** Per-CLI capability flags, mirrored from server CliCapabilities. */
export type CliCapabilities = {
  streamingTokens: boolean
  toolUseStructured: boolean
  supportsMcp: boolean
  branchResume: boolean
}

/** Adapter info bundle exposed at /api/meta — every supported CLI's
 *  curated model list and capabilities, keyed by CLI name. */
export type AdapterInfo = {
  models: ModelOption[]
  capabilities: CliCapabilities
}

/** Public meta exposed at /api/meta.
 *
 *  Modern shape (post per-session-adapter migration): the `adapters` map
 *  contains every supported CLI's models + capabilities, plus a
 *  `defaultCli` for new sessions.
 *
 *  Legacy fields `cli` and `models` describe the deploy's *default*
 *  adapter only — kept for clients built before per-session-cli landed
 *  so they keep rendering a sensible model picker. New code should
 *  prefer `adapters[<session.cli>]`.
 */
export type ServerMeta = {
  appRoot: string
  cli?: CliName
  models?: ModelOption[]
  defaultCli?: CliName
  adapters?: Record<CliName, AdapterInfo>
}

export async function fetchMeta(): Promise<ServerMeta> {
  const res = await fetch('/api/meta')
  if (!res.ok) throw new Error('Failed to fetch meta')
  return res.json() as Promise<ServerMeta>
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

// ── File upload ──────────────────────────────────────────────────────────────

export type UploadedFile = { name: string; path: string; size: number }

/**
 * Upload files to a project directory via multipart POST.
 * @param projectId  Target project
 * @param files      File objects from <input type="file"> or DataTransfer
 * @param targetPath Relative directory within the project (default: root)
 * @param onProgress Optional callback for upload progress
 */
export function uploadFiles(
  projectId: string,
  files: File[],
  targetPath = '',
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ uploaded: UploadedFile[] }> {
  const formData = new FormData()
  for (const f of files) formData.append('files', f)

  const url = `/api/projects/${projectId}/files/upload${targetPath ? `?path=${encodeURIComponent(targetPath)}` : ''}`

  if (onProgress) {
    // Use XMLHttpRequest for upload progress (fetch doesn't support it)
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url)
      xhr.withCredentials = true
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)) } catch { reject(new Error('Invalid response')) }
        } else {
          try {
            const body = JSON.parse(xhr.responseText)
            reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
          } catch { reject(new Error(`Upload failed (${xhr.status})`)) }
        }
      }
      xhr.onerror = () => reject(new Error('Upload failed (network error)'))
      xhr.send(formData)
    })
  }

  // Simple fetch path when progress isn't needed
  return fetch(url, { method: 'POST', body: formData, ...credentialsOpt })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
        throw new Error(body.error ?? `Upload failed (${res.status})`)
      }
      return res.json() as Promise<{ uploaded: UploadedFile[] }>
    })
}

// ── Push notifications ────────────────────────────────────────────────────────

/** Fetch the server's VAPID public key (avoids needing a build-time env var). */
export async function getVapidPublicKey(): Promise<string> {
  const res = await fetch('/api/push/vapid-public-key', credentialsOpt)
  if (!res.ok) throw new Error('Push not configured on server')
  const data = await res.json() as { key: string }
  return data.key
}

export async function savePushSubscription(sub: PushSubscription, sessionId?: string): Promise<void> {
  const json = sub.toJSON()
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      sessionId,
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

// ── Schedules ─────────────────────────────────────────────────────────────────

export type Schedule = {
  id: string
  session_id: string
  cron: string
  prompt: string
  label: string
  enabled: number
  once: number        // 1 = fires once then deletes, 0 = recurring
  condition: string | null  // JSON-encoded ScheduleCondition
  expires_at: number | null // unix seconds
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export async function listSchedules(sessionId: string): Promise<Schedule[]> {
  const res = await fetch(`/api/schedules?sessionId=${encodeURIComponent(sessionId)}`, credentialsOpt)
  if (!res.ok) throw new Error('Failed to fetch schedules')
  return res.json() as Promise<Schedule[]>
}

export async function createSchedule(sessionId: string, cronExpr: string, prompt: string): Promise<Schedule> {
  const res = await fetch('/api/schedules', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, cron: cronExpr, prompt }),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Failed to create schedule')
  }
  return res.json() as Promise<Schedule>
}

export async function updateSchedule(id: string, patch: { cron?: string; prompt?: string; enabled?: boolean }): Promise<Schedule> {
  const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Failed to update schedule')
  }
  return res.json() as Promise<Schedule>
}

export async function deleteSchedule(id: string): Promise<void> {
  await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...credentialsOpt,
  })
}

export async function runScheduleNow(id: string): Promise<void> {
  await fetch(`/api/schedules/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    ...credentialsOpt,
  })
}

// ── Artifacts ─────────────────────────────────────────────────────────────────

export type ArtifactType = 'chart' | 'report' | 'data' | 'code' | 'pikchr' | 'html' | 'mdart'

export interface Artifact {
  id: string
  project_id: string
  name: string
  type: ArtifactType
  path: string
  metadata: string | null
  topic_id: string | null
  created_from_session: string | null
  created_at: number
  updated_at: number
}

export interface Topic {
  id: string
  project_id: string
  name: string
  created_at: number
}

export async function listArtifacts(projectId: string): Promise<Artifact[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts`, credentialsOpt)
  if (!res.ok) throw new Error('Failed to list artifacts')
  return res.json() as Promise<Artifact[]>
}

export async function createArtifact(projectId: string, body: {
  name: string
  type: ArtifactType
  content: string
  metadata?: Record<string, unknown>
  created_from_session?: string
}): Promise<Artifact> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(b.error ?? 'Failed to create artifact')
  }
  return res.json() as Promise<Artifact>
}

export async function getArtifact(id: string): Promise<Artifact> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, credentialsOpt)
  if (!res.ok) throw new Error('Failed to get artifact')
  return res.json() as Promise<Artifact>
}

export async function updateArtifact(id: string, patch: { name?: string; metadata?: string }): Promise<Artifact> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(b.error ?? 'Failed to update artifact')
  }
  return res.json() as Promise<Artifact>
}

export function deriveArtifactName(content: string, lang: string, type: ArtifactType): string {
  const trimmed = content.trim()

  // Markdown/report: use first heading
  if (type === 'report') {
    const m = trimmed.match(/^#{1,3}\s+(.+)/m)
    if (m) return m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
  }

  // JSON/chart: use description or title field
  if (type === 'chart' || (type === 'data' && (trimmed.startsWith('{') || trimmed.startsWith('[')))) {
    try {
      const p = JSON.parse(trimmed) as Record<string, unknown>
      const label = (p['description'] ?? p['title'] ?? p['name']) as string | undefined
      if (label) return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
    } catch { /* ignore */ }
  }

  // Code: first function/class/def name
  if (type === 'code') {
    const m = trimmed.match(/(?:^|\n)\s*(?:def|function|class|fn|func)\s+([\w_]+)/m)
    if (m) return m[1].toLowerCase().replace(/_/g, '-')
  }

  // Pikchr: first line comment or first named object
  if (type === 'pikchr') {
    const m = trimmed.match(/^#\s*(.+)/m) ?? trimmed.match(/"([^"]{3,40})"/)
    if (m) return m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)
  }

  // Fallback: lang or type + short base36 timestamp
  const prefix = lang || type
  const suffix = Math.floor(Date.now() / 1000).toString(36)
  return `${prefix}-${suffix}`
}

export async function deleteArtifact(id: string): Promise<void> {
  await fetch(`/api/artifacts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...credentialsOpt,
  })
}

export async function getArtifactContent(id: string): Promise<string> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}/content`, credentialsOpt)
  if (!res.ok) throw new Error('Failed to get artifact content')
  const data = await res.json() as { content: string }
  return data.content
}

export async function putArtifactContent(id: string, content: string): Promise<void> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}/content`, {
    method: 'PUT',
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({ content }),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to update artifact content')
}

export async function refreshArtifact(id: string): Promise<void> {
  await fetch(`/api/artifacts/${encodeURIComponent(id)}/refresh`, {
    method: 'POST',
    ...credentialsOpt,
  })
}

// ── Topics ────────────────────────────────────────────────────────────────────

export async function listTopics(projectId: string): Promise<Topic[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/topics`, credentialsOpt)
  if (!res.ok) throw new Error('Failed to list topics')
  return res.json() as Promise<Topic[]>
}

export async function createTopic(projectId: string, name: string): Promise<Topic> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/topics`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(b.error ?? 'Failed to create topic')
  }
  return res.json() as Promise<Topic>
}

export async function updateTopic(id: string, name: string): Promise<Topic> {
  const res = await fetch(`/api/topics/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
    ...credentialsOpt,
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(b.error ?? 'Failed to update topic')
  }
  return res.json() as Promise<Topic>
}

export async function deleteTopic(id: string): Promise<void> {
  await fetch(`/api/topics/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    ...credentialsOpt,
  })
}

export async function moveArtifactToTopic(artifactId: string, topicId: string | null): Promise<void> {
  await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ topic_id: topicId }),
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
    if (!isAbortError(err)) handlers.onError?.((err as Error).message ?? 'Connection failed')
  })

  return () => controller.abort()
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(projectId: string, cli?: CliName): Promise<Session> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: JSON_HEADERS,
    // `cli` is optional — when omitted, the server applies its
    // STEWARD_CLI-derived default. Pass explicitly to override per-session.
    body: JSON.stringify(cli ? { projectId, cli } : { projectId }),
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
  let doneFired = false
  const es = new EventSource(`/api/sessions/${sessionId}/watch`, { withCredentials: true })
  es.addEventListener('done', () => { doneFired = true; es.close(); onDone() })
  // Ignore onerror if done already fired: the server closes the TCP connection immediately
  // after sending the done event, which causes a spurious onerror in some browsers.
  es.onerror = () => { if (!doneFired) { es.close(); onError?.() } }
  return () => es.close()
}

/**
 * Persistent subscription to a session's message updates.
 * Fires `onUpdate` every time any message is finalized for this session —
 * enabling multi-client sync without polling. The connection stays open until
 * the returned cancel function is called.
 */
export function subscribeToSession(
  sessionId: string,
  onUpdate: () => void,
): () => void {
  const es = new EventSource(`/api/sessions/${sessionId}/subscribe`, { withCredentials: true })
  es.addEventListener('updated', () => onUpdate())
  es.onerror = () => { /* auto-reconnects — no action needed */ }
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

export async function updateSessionTimezone(sessionId: string, timezone: string): Promise<void> {
  await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ timezone }),
    ...credentialsOpt,
  })
}

export async function updateSessionModel(sessionId: string, model: string | null): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ model }),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to update model')
  return res.json() as Promise<Session>
}

/** Switch the session's CLI adapter. Server-side this is destructive: it
 *  atomically clears `claude_session_id` (the previous adapter's session
 *  handle is meaningless to the new one) and `model` (slug shape differs
 *  between adapters). Callers should warn the user before invoking. The
 *  returned Session reflects the cleared state. */
export async function updateSessionCli(sessionId: string, cli: CliName): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ cli }),
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to update CLI')
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
  /** Fired when the server sends a push notification — carries the target session/project for navigation. */
  onPushTarget?: (target: { sessionId: string; projectId: string | null }) => void
  /** Fired when an MCP schedule tool mutates schedules — sessionId may be null for global. */
  onSchedulesChanged?: (sessionId: string | null) => void
  /** Fired when an artifact is created or updated — triggers ArtifactPanel refresh. */
  onArtifactUpdated?: () => void
  /** Fired when the SSE connection is established (initial + every reconnect). */
  onConnect?: () => void
  /** Fired when the SSE connection drops unexpectedly (before the reconnect delay). */
  onDisconnect?: () => void
  /** Fired on every received SSE data line — useful for tracking last-activity time. */
  onActivity?: () => void
}

/**
 * Execute JS sent via the eval SSE event and POST the result back to the server.
 * Called internally by subscribeToAppEvents — not exported.
 *
 * Serialisation rules:
 *   - Primitives and plain objects → JSON.stringify
 *   - Promises → awaited (up to 8 s), then serialised
 *   - Errors → { error: message }
 *   - Unserializable values (DOM nodes, functions…) → String(value)
 */
async function handleEval(raw: string): Promise<void> {
  let id: string
  let code: string
  try {
    const payload = JSON.parse(raw) as { id: string; code: string }
    id = payload.id
    code = payload.code
  } catch {
    return // malformed payload — ignore
  }

  let resultStr: string | undefined
  let errorStr: string | undefined

  try {
    // eslint-disable-next-line no-eval
    let value: unknown = eval(code) // intentional — this is the whole point
    // Await promises with a generous timeout
    if (value instanceof Promise) {
      value = await Promise.race([
        value,
        new Promise((_, reject) => setTimeout(() => reject(new Error('eval promise timed out')), 8_000)),
      ])
    }
    try {
      resultStr = JSON.stringify(value, null, 2)
    } catch {
      resultStr = String(value)
    }
  } catch (err) {
    errorStr = err instanceof Error ? err.message : String(err)
  }

  // Fire-and-forget — don't let a network failure here crash the SSE listener
  fetch(`/api/eval/${encodeURIComponent(id)}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result: resultStr, error: errorStr }),
    ...credentialsOpt,
  }).catch(() => { /* ignore */ })
}

// Report page visibility changes to the server so it knows whether to
// send a push notification (backgrounded) or an in-app toast (foreground).
let visibilityCleanup: (() => void) | null = null
function setupVisibilityReporting(connectionId: string) {
  // Clean up previous listener (e.g. on reconnect)
  visibilityCleanup?.()

  const handler = () => {
    const visible = document.visibilityState === 'visible'
    // Use sendBeacon for hidden (fires reliably even as page suspends on iOS)
    // Use fetch for visible (sendBeacon is fire-and-forget, fine for hidden)
    if (!visible) {
      navigator.sendBeacon(
        '/api/events/visibility',
        new Blob([JSON.stringify({ connectionId, visible: false })], { type: 'application/json' })
      )
    } else {
      fetch('/api/events/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, visible: true }),
        ...credentialsOpt,
      }).catch(() => { /* ignore */ })
    }
  }

  document.addEventListener('visibilitychange', handler)
  visibilityCleanup = () => document.removeEventListener('visibilitychange', handler)
}

// Connect to the app-level SSE stream. Reconnects automatically on drop.
// Returns a cancel function to close the connection.
export function subscribeToAppEvents(handlers: AppEventHandlers): () => void {
  let cancelled = false
  let controller: AbortController | null = null

  async function connect() {
    if (cancelled) return
    if (controller) {
      try {
        controller.abort()
      } catch { /* ignore */ }
    }
    const ac = new AbortController()
    controller = ac
    try {
      const res = await fetch('/api/events', {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: ac.signal,
        ...credentialsOpt,
      })

      if (!res.ok) {
        void res.text().catch(() => { /* drain body; release the HTTP/1.1 connection slot */ })
        handlers.onDisconnect?.()
        if (!cancelled) {
          const delay = res.status === 401 || res.status === 403 ? 5_000 : 3_000
          setTimeout(() => { if (!cancelled) void connect() }, delay)
        }
        return
      }

      handlers.onConnect?.()

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
            const raw = line.slice(6)
            handlers.onActivity?.()
            if (pendingEvent === 'connected') {
              try {
                const { connectionId } = JSON.parse(raw) as { connectionId: string }
                setupVisibilityReporting(connectionId)
              } catch { /* ignore */ }
            }
            if (pendingEvent === 'reload') handlers.onReload?.()
            if (pendingEvent === 'eval') void handleEval(raw)
            if (pendingEvent === 'pushTarget') {
              try { handlers.onPushTarget?.(JSON.parse(raw)) } catch { /* ignore */ }
            }
            if (pendingEvent === 'schedules_changed') {
              try {
                const { sessionId } = JSON.parse(raw) as { sessionId?: string | null }
                handlers.onSchedulesChanged?.(sessionId ?? null)
              } catch { /* ignore */ }
            }
            if (pendingEvent === 'artifact_updated' || pendingEvent === 'artifact_created' || pendingEvent === 'artifact_deleted') {
              handlers.onArtifactUpdated?.()
            }
            pendingEvent = ''
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) return
    }
    // Reconnect after 3s on unexpected drop
    if (!cancelled) {
      handlers.onDisconnect?.()
      setTimeout(() => { if (!cancelled) void connect() }, 3000)
    }
  }

  void connect()
  return () => {
    cancelled = true
    try {
      controller?.abort()
    } catch { /* ignore */ }
  }
}

export type ClaudeErrorCode = 'session_expired' | 'context_limit' | 'provider_quota' | 'process_error' | 'http_error' | 'connection_lost'

/**
 * Normalize a tool_result content value to a plain string.
 * The Claude API allows content to be either a string or an array of text blocks
 * (e.g. [{type:'text', text:'...'}]). Coerce to string so callers never receive
 * an object/array, which would cause React error #31 when rendered.
 */
function normalizeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => typeof b === 'object' && b !== null && b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  }
  return String(content ?? '')
}

/** A single tool invocation with the key detail extracted from its input. */
export type ToolCall = {
  id: string
  name: string
  /** Human-readable summary of what the tool is doing (command, file path, query…). */
  detail?: string
  output?: string
  isError?: boolean
}

/**
 * For display purposes: when a tool is "Bash", return the executable name
 * (first token of the command) so the badge says "git" / "npm" / etc.
 * Falls back to the raw tool name for all other tools.
 */
export function toolDisplayName(name: string, detail?: string): string {
  if (name === 'Bash' && detail) {
    const first = detail.trimStart().split(/\s+/)[0]
    return first || name
  }
  return name
}

/**
 * For display purposes: when a tool is "Bash", strip the leading executable
 * from the detail so it isn't shown twice (badge already has it).
 */
export function toolDisplayDetail(name: string, detail?: string): string | undefined {
  if (name === 'Bash' && detail) {
    const rest = detail.trimStart().replace(/^\S+\s*/, '')
    return rest || undefined
  }
  return detail
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
    default: {
      return (
        str(input.path) ??
        str(input.target_directory) ??
        str(input.directory) ??
        str(input.pattern) ??
        str(input.file_path) ??
        str(input.filePath) ??
        undefined
      )
    }
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

/** opencode: stringify tool result for display (object → JSON) */
function opencodeOutputString(out: unknown): string {
  if (typeof out === 'string') return out
  if (out == null) return ''
  return JSON.stringify(out)
}

/**
 * `opencode run --format json` tool lines are `type: "tool_use"`; fire the same
 * {@link ChunkHandler} hooks as the Claude `assistant` / `user` message shapes.
 */
function handleOpencodeToolUseChunk(
  raw: Record<string, unknown>,
  handlers: Pick<ChunkHandler, 'onToolCall' | 'onToolResult'>,
): void {
  if (raw.type !== 'tool_use' || !raw.part || typeof raw.part !== 'object') return
  const part = raw.part as Record<string, unknown>
  const tool = part.tool
  const callID = part.callID
  if (typeof tool !== 'string' || typeof callID !== 'string') return
  const state = (part.state as Record<string, unknown>) ?? {}
  const input = (state.input as Record<string, unknown>) ?? {}
  handlers.onToolCall?.({
    id: callID,
    name: tool,
    detail: extractToolDetail(tool, input),
  })
  if (state.status === 'completed' && 'output' in state) {
    const output = opencodeOutputString((state as { output: unknown }).output)
    const exit = (state.metadata as { exit?: number } | undefined)?.exit
    const isError = typeof exit === 'number' && exit !== 0
    handlers.onToolResult?.(callID, output, isError)
  }
}

export function sendMessage(
  sessionId: string,
  message: string,
  handlers: ChunkHandler
): () => void {
  const controller = new AbortController()
  /** Fires if we abort because the request never got a response in time (browser queue, dead server, etc.). */
  let ttfbTimeoutFired = false
  // Covers time until the first response headers — 90s inactivity below only runs after the body stream exists.
  const TTFB_MS = 90_000
  const ttfbTimer = setTimeout(() => {
    ttfbTimeoutFired = true
    controller.abort()
  }, TTFB_MS)
  const clearTtfbTimer = () => {
    clearTimeout(ttfbTimer)
  }

  fetch('/api/chat', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ sessionId, message }),
    signal: controller.signal,
    ...credentialsOpt,
  })
    .then(async (res) => {
      clearTtfbTimer()
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
      let textBlockCount = 0
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
                  } else if (evt?.type === 'content_block_start' && evt.content_block?.type === 'text') {
                    // New text block after a tool use — inject paragraph break between segments
                    if (textBlockCount > 0) {
                      handlers.onTextDelta('\n\n')
                    }
                    textBlockCount++
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
                        normalizeToolResultContent((block as unknown as { content: unknown }).content),
                        block.is_error ?? false,
                      )
                    }
                  }
                } else if (chunk.type === 'text') {
                  // opencode run --format json: assistant text (whole line, not stream_event)
                  const t = (chunk as { part?: { text?: string } }).part?.text
                  if (typeof t === 'string' && t) {
                    if (textBlockCount > 0) handlers.onTextDelta('\n\n')
                    textBlockCount++
                    handlers.onToolActivity?.(null)
                    handlers.onTextDelta(t)
                  }
                } else if (chunk.type === 'tool_use') {
                  handleOpencodeToolUseChunk(chunk as Record<string, unknown>, handlers)
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
      clearTtfbTimer()
      if (isAbortError(err)) {
        if (ttfbTimeoutFired) {
          handlers.onError(
            'The server did not start responding in time. Your connection may be busy (try refreshing), or the server is overloaded.',
            'http_error',
          )
        }
        return
      }
      // fetch() itself rejected — network failure before any response (e.g. DNS error,
      // offline, connection refused).  Pass http_error so the assistant bubble shows the
      // "Connection error" banner instead of silently staying empty with no spinner.
      handlers.onError(err.message, 'http_error')
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
export async function compactSession(sessionId: string): Promise<{ sessionId: string; summary: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/compact`, {
    method: 'POST',
    headers: JSON_HEADERS,
    ...credentialsOpt,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Compact failed: ${body}`)
  }
  return res.json() as Promise<{ sessionId: string; summary: string }>
}

/** Fetch the full chain of sessions (root → current) that this session belongs to. */
export async function getSessionChain(sessionId: string): Promise<ChainSegment[]> {
  const res = await fetch(`/api/sessions/${sessionId}/chain`, {
    headers: JSON_HEADERS,
    ...credentialsOpt,
  })
  if (!res.ok) throw new Error('Failed to load session chain')
  return res.json() as Promise<ChainSegment[]>
}

// ── Mini-apps ─────────────────────────────────────────────────────────────────

export type AppConfig = {
  id: string
  project_id: string
  name: string
  type: string
  command_template: string
  work_dir: string
  created_at: number
  updated_at: number
  // joined fields from slot
  slot: number | null
  status: 'stopped' | 'starting' | 'running' | 'error'
  pid: number | null
  error: string | null
}

export async function listApps(projectId: string): Promise<AppConfig[]> {
  const res = await fetch(`/api/projects/${projectId}/apps`, credentialsOpt)
  if (!res.ok) throw new Error('Failed to list apps')
  const data = await res.json() as { apps: AppConfig[] }
  return data.apps
}

export async function createApp(projectId: string, body: {
  name: string; command_template: string; work_dir: string; type?: string
}): Promise<AppConfig> {
  const res = await fetch(`/api/projects/${projectId}/apps`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    ...credentialsOpt,
  })
  const data = await res.json() as { app: AppConfig; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Failed to create app')
  return data.app
}

export async function deleteApp(configId: string): Promise<void> {
  const res = await fetch(`/api/apps/${configId}`, { method: 'DELETE', ...credentialsOpt })
  if (!res.ok) {
    const data = await res.json() as { error?: string }
    throw new Error(data.error ?? 'Failed to delete app')
  }
}

export async function startApp(configId: string): Promise<{ slot: number; port: number; pid: number; url: string }> {
  const res = await fetch(`/api/apps/${configId}/start`, { method: 'POST', ...credentialsOpt })
  const data = await res.json() as { slot?: number; port?: number; pid?: number; url?: string; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Failed to start app')
  return data as { slot: number; port: number; pid: number; url: string }
}

export async function stopApp(configId: string): Promise<void> {
  const res = await fetch(`/api/apps/${configId}/stop`, { method: 'POST', ...credentialsOpt })
  if (!res.ok) {
    const data = await res.json() as { error?: string }
    throw new Error(data.error ?? 'Failed to stop app')
  }
}
