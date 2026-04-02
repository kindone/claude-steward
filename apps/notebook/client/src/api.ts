import type { Cell, Language, CellType, KernelStatus } from './types'

const BASE = '/api'

// ── Cells ─────────────────────────────────────────────────────────────────────

export async function listCells(): Promise<Cell[]> {
  const r = await fetch(`${BASE}/cells`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function createCell(opts: { type?: CellType; language?: Language; position?: number; source?: string }): Promise<Cell> {
  const r = await fetch(`${BASE}/cells`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function updateCell(id: string, updates: { source?: string; language?: Language; type?: CellType; position?: number }): Promise<Cell> {
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

export async function kernelStatus(): Promise<KernelStatus[]> {
  const r = await fetch(`${BASE}/kernel/status`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function restartKernel(lang: Language): Promise<void> {
  const r = await fetch(`${BASE}/kernel/restart/${lang}`, { method: 'POST' })
  if (!r.ok) throw new Error(await r.text())
}

export function streamKernelRun(
  cellId: string,
  onLine: (line: string) => void,
  onCompile: (ok: boolean, output: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
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

// ── Chat ──────────────────────────────────────────────────────────────────────

export function streamChat(
  message: string,
  onChunk: (chunk: unknown) => void,
  onDone: (sessionId: string) => void,
  onError: (err: { message: string; code: string }) => void,
  signal?: AbortSignal,
): void {
  fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  })
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
            try {
              const data = JSON.parse(line.slice(6))
              if (event === 'chunk') onChunk(data)
              else if (event === 'done') onDone(data.session_id ?? '')
              else if (event === 'error') onError(data)
              else if (event === 'cell:updated') {
                // Cell update from file watcher — dispatch as custom event
                window.dispatchEvent(new CustomEvent('notebook:cell-updated', { detail: data }))
              }
            } catch { /* ignore malformed */ }
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError({ message: String(err), code: 'process_error' })
    })
}

export async function clearSession(): Promise<void> {
  await fetch(`${BASE}/chat/session`, { method: 'DELETE' })
}
