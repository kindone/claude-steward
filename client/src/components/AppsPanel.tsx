import { useState, useEffect, useCallback } from 'react'
import { listApps, createApp, deleteApp, startApp, stopApp, type AppConfig } from '../lib/api'

type Props = {
  projectId: string
  projectPath: string
  onOpenApp?: (url: string, name: string) => void
}

const MKDOCS_TEMPLATE = '/home/ubuntu/venv/bin/mkdocs serve --dev-addr 0.0.0.0:{port}'

const STATUS_DOT: Record<AppConfig['status'], string> = {
  stopped: 'bg-[#444]',
  starting: 'bg-yellow-500 animate-pulse',
  running: 'bg-green-500',
  error:   'bg-red-500',
}

export function AppsPanel({ projectId, projectPath, onOpenApp }: Props) {
  const [apps, setApps] = useState<AppConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // Create form state
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formTemplate, setFormTemplate] = useState(MKDOCS_TEMPLATE)
  const [formDir, setFormDir] = useState(projectPath)
  const [formError, setFormError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setApps(await listApps(projectId))
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    void refresh()
    // Poll every 3s so running/starting status stays fresh
    const timer = setInterval(() => void refresh(), 3_000)
    return () => clearInterval(timer)
  }, [refresh])

  async function handleCreate() {
    setFormError(null)
    if (!formName.trim()) { setFormError('Name is required'); return }
    if (!formTemplate.includes('{port}')) { setFormError('Command must contain {port}'); return }
    setCreating(true)
    try {
      await createApp(projectId, { name: formName.trim(), command_template: formTemplate.trim(), work_dir: formDir.trim() })
      setShowForm(false)
      setFormName('')
      setFormTemplate(MKDOCS_TEMPLATE)
      setFormDir(projectPath)
      await refresh()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setCreating(false)
    }
  }

  async function handleStart(app: AppConfig) {
    setBusy((b) => ({ ...b, [app.id]: true }))
    try {
      await startApp(app.id)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy((b) => ({ ...b, [app.id]: false }))
    }
  }

  async function handleStop(app: AppConfig) {
    setBusy((b) => ({ ...b, [app.id]: true }))
    try {
      await stopApp(app.id)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy((b) => ({ ...b, [app.id]: false }))
    }
  }

  async function handleDelete(app: AppConfig) {
    setBusy((b) => ({ ...b, [app.id]: true }))
    try {
      await deleteApp(app.id)
      setPendingDelete(null)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy((b) => ({ ...b, [app.id]: false }))
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-[#555] text-xs">Loading…</div>

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1.5 flex-shrink-0">
        <span className="text-[11px] text-[#555] uppercase tracking-widest font-semibold">Apps</span>
        <button
          onClick={() => { setShowForm((v) => !v); setFormError(null) }}
          className="bg-[#1e3a5f] hover:bg-blue-600 text-white border-none w-7 h-7 rounded-md cursor-pointer text-lg leading-none flex items-center justify-center transition-colors"
          title="New app"
        >
          +
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mb-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5 flex items-start gap-1.5 flex-shrink-0">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 flex-shrink-0">✕</button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="mx-3 mb-3 p-2.5 bg-[#111] border border-[#2a2a2a] rounded-lg flex flex-col gap-2 flex-shrink-0">
          <input
            className="bg-[#1a1a1a] border border-[#2a2a2a] focus:border-blue-600 rounded px-2 py-1.5 text-[12px] text-[#e8e8e8] outline-none w-full"
            placeholder="Name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
          />
          <input
            className="bg-[#1a1a1a] border border-[#2a2a2a] focus:border-blue-600 rounded px-2 py-1.5 text-[11px] text-[#aaa] font-mono outline-none w-full"
            placeholder="Command template (must include {port})"
            value={formTemplate}
            onChange={(e) => setFormTemplate(e.target.value)}
          />
          <input
            className="bg-[#1a1a1a] border border-[#2a2a2a] focus:border-blue-600 rounded px-2 py-1.5 text-[11px] text-[#aaa] font-mono outline-none w-full"
            placeholder="Working directory"
            value={formDir}
            onChange={(e) => setFormDir(e.target.value)}
          />
          {formError && <p className="text-[11px] text-red-400">{formError}</p>}
          <div className="flex gap-1.5">
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white border-none rounded px-3 py-1 text-[12px] cursor-pointer transition-colors"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => { setShowForm(false); setFormError(null) }}
              className="bg-transparent border border-[#2a2a2a] hover:border-[#444] text-[#666] hover:text-[#aaa] rounded px-3 py-1 text-[12px] cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* App list */}
      <ul className="list-none flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-1">
        {apps.length === 0 && !showForm && (
          <li className="text-[#444] text-xs text-center py-8">No apps yet</li>
        )}
        {apps.map((app) => {
          const isRunning = app.status === 'running'
          const isStarting = app.status === 'starting'
          const isBusy = busy[app.id] ?? false
          const appUrl = app.slot != null ? `https://app${app.slot}.steward.jradoo.com` : null

          return (
            <li key={app.id} className="bg-[#111] border border-[#1f1f1f] rounded-lg px-2.5 py-2 flex flex-col gap-1.5">
              {/* Name + status */}
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[app.status]}`} />
                <span className="text-[13px] text-[#e8e8e8] font-medium truncate flex-1">{app.name}</span>
                {isRunning && appUrl && (
                  <a
                    href={appUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex-shrink-0"
                    title={appUrl}
                  >
                    ↗
                  </a>
                )}
              </div>

              {/* URL when running */}
              {isRunning && appUrl && (
                <a
                  href={appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-500 hover:text-blue-400 hover:underline truncate"
                >
                  {appUrl}
                </a>
              )}
              {app.status === 'error' && (
                <span className="text-[11px] text-red-400">Process exited unexpectedly</span>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1.5">
                {(isRunning || isStarting) ? (
                  <>
                    <button
                      onClick={() => void handleStop(app)}
                      disabled={isBusy || isStarting}
                      className="bg-transparent border border-[#2a2a2a] hover:border-red-500/50 hover:text-red-400 text-[#666] rounded px-2 py-0.5 text-[11px] cursor-pointer transition-colors disabled:opacity-40"
                    >
                      {isBusy ? 'Stopping…' : isStarting ? 'Starting…' : 'Stop'}
                    </button>
                    {isRunning && appUrl && onOpenApp && (
                      <button
                        onClick={() => onOpenApp(appUrl, app.name)}
                        className="bg-transparent border border-[#2a2a2a] hover:border-blue-500/50 hover:text-blue-400 text-[#666] rounded px-2 py-0.5 text-[11px] cursor-pointer transition-colors"
                      >
                        View
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => void handleStart(app)}
                    disabled={isBusy}
                    className="bg-transparent border border-[#2a2a2a] hover:border-green-500/50 hover:text-green-400 text-[#666] rounded px-2 py-0.5 text-[11px] cursor-pointer transition-colors disabled:opacity-40"
                  >
                    {isBusy ? 'Starting…' : 'Start'}
                  </button>
                )}

                {!isRunning && !isStarting && (
                  pendingDelete === app.id ? (
                    <>
                      <button
                        onClick={() => void handleDelete(app)}
                        disabled={isBusy}
                        className="text-[11px] text-red-400 hover:text-red-300 cursor-pointer bg-transparent border-none px-1 disabled:opacity-40"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setPendingDelete(null)}
                        className="text-[11px] text-[#555] hover:text-[#888] cursor-pointer bg-transparent border-none px-1"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setPendingDelete(app.id)}
                      className="text-[#333] hover:text-red-500 cursor-pointer bg-transparent border-none text-[11px] px-1 ml-auto transition-colors"
                      title="Delete"
                    >
                      ✕
                    </button>
                  )
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
