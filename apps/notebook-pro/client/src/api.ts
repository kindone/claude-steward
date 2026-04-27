import type { Cell, Language, CellType, KernelStatus, Notebook } from './types'

const BASE = '/api'

// ── Notebooks ─────────────────────────────────────────────────────────────────

export async function listNotebooks(): Promise<Notebook[]> {
  const r = await fetch(`${BASE}/notebooks`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function createNotebook(title: string): Promise<Notebook> {
  const r = await fetch(`${BASE}/notebooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function renameNotebook(id: string, title: string): Promise<Notebook> {
  const r = await fetch(`${BASE}/notebooks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function deleteNotebook(id: string): Promise<void> {
  const r = await fetch(`${BASE}/notebooks/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

// ── Cells ─────────────────────────────────────────────────────────────────────

export async function listCells(notebookId: string): Promise<Cell[]> {
  const r = await fetch(`${BASE}/notebooks/${notebookId}/cells`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function createCell(
  notebookId: string,
  opts: { type?: CellType; language?: Language; position?: number; source?: string },
): Promise<Cell> {
  const r = await fetch(`${BASE}/notebooks/${notebookId}/cells`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function updateCell(id: string, updates: { source?: string; language?: Language; type?: CellType; position?: number; name?: string | null }): Promise<Cell> {
  const r = await fetch(`${BASE}/cells/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function deleteCell(id: string): Promise<void> {
  const r = await fetch(`${BASE}/cells/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

export async function moveCell(id: string, position: number): Promise<Cell> {
  const r = await fetch(`${BASE}/cells/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

// ── Kernel ────────────────────────────────────────────────────────────────────

export async function kernelStatus(notebookId: string): Promise<KernelStatus[]> {
  const r = await fetch(`${BASE}/notebooks/${notebookId}/kernel/status`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function restartKernel(notebookId: string, lang: Language): Promise<void> {
  const r = await fetch(`${BASE}/notebooks/${notebookId}/kernel/restart/${lang}`, { method: 'POST' })
  if (!r.ok) throw new Error(await r.text())
}

export async function killNotebookKernels(notebookId: string): Promise<void> {
  const r = await fetch(`${BASE}/notebooks/${notebookId}/kernel/kill`, { method: 'POST' })
  if (!r.ok) throw new Error(await r.text())
}

export function streamKernelRun(
  cellId: string,
  onLine: (line: string) => void,
  onCompile: (ok: boolean, output: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  onRichOutput: (kind: string, payload: string) => void = () => {},
  signal?: AbortSignal,
): void {
  fetch(`${BASE}/kernel/run/${cellId}`, { method: 'POST', signal })
    .then(async (res) => {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let event = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            if (event === 'output') onLine(data.line)
            else if (event === 'rich_output') onRichOutput(data.kind, data.payload)
            else if (event === 'compile') onCompile(data.ok, data.output)
            else if (event === 'done') onDone()
            else if (event === 'error') onError(data.message)
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(String(err))
    })
}

// ── Chat sessions ─────────────────────────────────────────────────────────────

export async function listChatSessions(notebookId: string): Promise<import('./types').ChatSession[]> {
  const res = await fetch(`${BASE}/notebooks/${notebookId}/chat/sessions`)
  if (!res.ok) return []
  return res.json()
}

export async function createChatSession(notebookId: string): Promise<import('./types').ChatSession> {
  const res = await fetch(`${BASE}/notebooks/${notebookId}/chat/sessions`, { method: 'POST' })
  return res.json()
}

export async function deleteChatSession(notebookId: string, sessionId: string): Promise<void> {
  await fetch(`${BASE}/notebooks/${notebookId}/chat/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function compactChatSession(notebookId: string, sessionId: string): Promise<void> {
  const res = await fetch(`${BASE}/notebooks/${notebookId}/chat/compact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export async function getChatMessages(notebookId: string, sessionId: string): Promise<import('./types').ChatMessage[]> {
  const res = await fetch(`${BASE}/notebooks/${notebookId}/chat/messages?sessionId=${sessionId}`)
  if (!res.ok) return []
  return res.json()
}

// ── Chat stream ───────────────────────────────────────────────────────────────

export function streamChat(
  notebookId: string,
  sessionId: string,
  message: string,
  onChunk: (chunk: unknown) => void,
  onDone: (sessionId: string) => void,
  onError: (err: { message: string; code: string }) => void,
  signal?: AbortSignal,
  model?: string | null,
): void {
  fetch(`${BASE}/notebooks/${notebookId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, ...(model ? { model } : {}) }),
    signal,
  })
    .then(async (res) => {
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let event = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (event === 'chunk') onChunk(data)
              else if (event === 'done') { finished = true; onDone(data.session_id ?? '') }
              else if (event === 'error') { finished = true; onError(data) }
              // cell:* events are handled by the persistent /api/watch EventSource
              // (useWatchStream hook) — no dispatching needed here
            } catch { /* ignore malformed */ }
          }
        }
      }

      // Stream ended without a done/error event — server restarted mid-stream
      if (!finished) {
        onError({ message: 'Connection lost — the response may be incomplete. Please try again.', code: 'process_error' })
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError({ message: String(err), code: 'process_error' })
    })
}
