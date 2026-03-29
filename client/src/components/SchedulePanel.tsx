import { useState, useEffect } from 'react'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, type Schedule } from '../lib/api'

type Props = {
  sessionId: string
}

function formatNextRun(nextRunAt: number | null): string {
  if (!nextRunAt) return '—'
  return new Date(nextRunAt * 1000).toLocaleString()
}

export function SchedulePanel({ sessionId }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [cronDraft, setCronDraft] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    listSchedules(sessionId)
      .then(setSchedules)
      .catch(() => setSchedules([]))
      .finally(() => setLoading(false))
  }, [sessionId])

  async function handleCreate() {
    if (!cronDraft.trim() || !promptDraft.trim()) return
    setSaving(true)
    setError(null)
    try {
      const s = await createSchedule(sessionId, cronDraft.trim(), promptDraft.trim())
      setSchedules((prev) => [...prev, s])
      setCronDraft('')
      setPromptDraft('')
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(s: Schedule) {
    try {
      const updated = await updateSchedule(s.id, { enabled: s.enabled === 0 })
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? updated : x)))
    } catch (err) {
      console.error('[schedule] toggle failed:', err)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSchedule(id)
      setSchedules((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      console.error('[schedule] delete failed:', err)
    }
  }

  async function handleRunNow(id: string) {
    try {
      await runScheduleNow(id)
    } catch (err) {
      console.error('[schedule] run failed:', err)
    }
  }

  return (
    <div className="px-3 pb-3 flex flex-col gap-2">
      {loading ? (
        <p className="text-[11px] text-[#555]">Loading…</p>
      ) : (
        <>
          {schedules.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {schedules.map((s) => (
                <li key={s.id} className="border border-[#2a2a2a] rounded-md px-2.5 py-2 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {/* Enable toggle */}
                    <button
                      onClick={() => handleToggle(s)}
                      title={s.enabled ? 'Disable' : 'Enable'}
                      className={`w-8 h-4 rounded-full flex-shrink-0 transition-colors relative ${s.enabled ? 'bg-blue-600' : 'bg-[#333]'}`}
                    >
                      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${s.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                    <code className="text-[11px] text-blue-400 font-mono flex-shrink-0">{s.cron}</code>
                    <span className="flex-1 text-[11px] text-[#888] truncate">{s.prompt}</span>
                    <button
                      onClick={() => handleRunNow(s.id)}
                      title="Run now"
                      className="text-[11px] text-[#555] hover:text-[#aaa] flex-shrink-0 px-1"
                    >
                      ▶
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      title="Delete"
                      className="text-[11px] text-[#555] hover:text-red-500 flex-shrink-0 px-1"
                    >
                      ×
                    </button>
                  </div>
                  <div className="text-[10px] text-[#444] pl-10">
                    Next: {formatNextRun(s.next_run_at)}
                    {s.last_run_at && (
                      <span className="ml-2">· Last: {new Date(s.last_run_at * 1000).toLocaleString()}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="self-start text-[11px] text-[#555] hover:text-[#aaa] border border-[#2a2a2a] hover:border-[#444] rounded px-2 py-1 bg-transparent cursor-pointer transition-colors"
            >
              + Add schedule
            </button>
          )}

          {showForm && (
            <div className="flex flex-col gap-2 border border-[#2a2a2a] rounded-md p-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[#555] uppercase tracking-wide">Cron expression</label>
                <input
                  className="bg-[#0d0d0d] border border-[#2a2a2a] focus:border-blue-600 rounded text-[#e8e8e8] text-[13px] font-mono px-2 py-1.5 outline-none"
                  value={cronDraft}
                  onChange={(e) => setCronDraft(e.target.value)}
                  placeholder="0 9 * * 1-5"
                  autoFocus
                />
                <span className="text-[10px] text-[#444]">UTC. Examples: <code>0 9 * * *</code> daily 9am, <code>0 9 * * 1-5</code> weekdays</span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[#555] uppercase tracking-wide">Prompt</label>
                <textarea
                  className="bg-[#0d0d0d] border border-[#2a2a2a] focus:border-blue-600 rounded text-[#e8e8e8] text-[13px] font-[inherit] px-2 py-1.5 resize-y outline-none"
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  placeholder="What would you like Claude to say at this time?"
                  rows={2}
                />
              </div>
              {error && <p className="text-[11px] text-red-400">{error}</p>}
              <div className="flex gap-1.5">
                <button
                  onClick={handleCreate}
                  disabled={saving || !cronDraft.trim() || !promptDraft.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 border-none rounded text-white cursor-pointer text-xs px-3 py-1.5 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => { setShowForm(false); setCronDraft(''); setPromptDraft(''); setError(null) }}
                  className="bg-transparent border border-[#2a2a2a] hover:border-[#444] hover:text-[#aaa] rounded text-[#666] cursor-pointer text-xs px-2.5 py-1.5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
