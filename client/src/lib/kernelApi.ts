/**
 * Client API for named project-scoped kernels.
 *
 * Kernels are identified by (projectId, name, language). Any session in
 * the project can share a kernel by name — state survives compaction.
 */

export type Language = 'python' | 'node' | 'bash' | 'cpp'

export interface KernelInfo {
  name: string
  language: Language
  projectId: string
  alive: boolean
  pid: number | null
  createdAt: number
  lastUsedAt: number
}

export interface KernelOutputEvent {
  type: 'output'
  text: string
}

export interface KernelCompileEvent {
  type: 'compile'
  ok: boolean
  output: string
}

export interface KernelDoneEvent {
  type: 'done'
  exitCode: number
  durationMs: number
  error?: string
}

export type KernelRunEvent = KernelOutputEvent | KernelCompileEvent | KernelDoneEvent

/**
 * Map common fence language identifiers to kernel language IDs.
 * Returns null for languages without a kernel (no Run button shown).
 */
export function normalizeLanguage(lang: string): Language | null {
  const l = lang.toLowerCase().trim()
  if (['python', 'python3', 'py'].includes(l)) return 'python'
  if (['javascript', 'js', 'typescript', 'ts', 'node'].includes(l)) return 'node'
  if (['bash', 'sh', 'shell', 'zsh', 'fish'].includes(l)) return 'bash'
  if (['cpp', 'c++', 'cxx', 'cc'].includes(l)) return 'cpp'
  return null
}

export async function listKernels(projectId: string): Promise<KernelInfo[]> {
  const res = await fetch(`/api/projects/${projectId}/kernels`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Failed to list kernels: ${res.statusText}`)
  return res.json() as Promise<KernelInfo[]>
}

export async function ensureKernel(projectId: string, name: string, language: Language): Promise<KernelInfo> {
  const res = await fetch(`/api/projects/${projectId}/kernels`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, language }),
  })
  if (!res.ok) throw new Error(`Failed to create kernel: ${res.statusText}`)
  return res.json() as Promise<KernelInfo>
}

export async function killKernel(projectId: string, name: string, language: Language): Promise<void> {
  await fetch(`/api/projects/${projectId}/kernels/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  })
}

export async function resetKernel(projectId: string, name: string, language: Language): Promise<void> {
  await fetch(`/api/projects/${projectId}/kernels/${encodeURIComponent(name)}/reset`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  })
}

/**
 * Run code in a named kernel.
 *
 * Calls onEvent for each SSE event (output lines, compile status, final done).
 * Returns a cleanup function — call it to abort the run.
 */
export function runCode(
  projectId: string,
  kernelName: string,
  language: Language,
  code: string,
  onEvent: (e: KernelRunEvent) => void,
): () => void {
  const ac = new AbortController()

  const doRun = async () => {
    const res = await fetch(`/api/projects/${projectId}/kernels/${encodeURIComponent(kernelName)}/run`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, code }),
      signal: ac.signal,
    })

    if (!res.ok || !res.body) {
      onEvent({ type: 'done', exitCode: 1, durationMs: 0, error: `HTTP ${res.status}` })
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE chunks — each event is separated by double newline
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        if (!chunk.trim() || chunk.startsWith(':')) continue // keepalive / comment

        let eventType = 'message'
        let dataLine = ''

        for (const line of chunk.split('\n')) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim()
          else if (line.startsWith('data: ')) dataLine = line.slice(6)
        }

        if (!dataLine) continue

        try {
          const payload = JSON.parse(dataLine) as Record<string, unknown>

          if (eventType === 'output') {
            onEvent({ type: 'output', text: String(payload.text ?? '') })
          } else if (eventType === 'compile') {
            onEvent({ type: 'compile', ok: Boolean(payload.ok), output: String(payload.output ?? '') })
          } else if (eventType === 'done') {
            onEvent({
              type: 'done',
              exitCode: Number(payload.exitCode ?? 0),
              durationMs: Number(payload.durationMs ?? 0),
              error: payload.error != null ? String(payload.error) : undefined,
            })
          }
        } catch {
          // Malformed SSE data — ignore
        }
      }
    }
  }

  doRun().catch((err: unknown) => {
    if (err instanceof Error && err.name === 'AbortError') return
    onEvent({ type: 'done', exitCode: 1, durationMs: 0, error: String(err) })
  })

  return () => ac.abort()
}
