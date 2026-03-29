import { useState, useEffect } from 'react'
import { listSchedules, updateSchedule, deleteSchedule, runScheduleNow, type Schedule } from '../lib/api'

type Props = {
  sessionId: string
  timezone?: string | null
}

function formatNextRun(nextRunAt: number | null): string {
  if (!nextRunAt) return '—'
  return new Date(nextRunAt * 1000).toLocaleString()
}

export function SchedulePanel({ sessionId, timezone }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    listSchedules(sessionId)
      .then(setSchedules)
      .catch(() => setSchedules([]))
      .finally(() => setLoading(false))
  }, [sessionId])

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
      {timezone && (
        <p className="text-[10px] text-[#444]">Times shown in: {timezone}</p>
      )}
      {loading ? (
        <p className="text-[11px] text-[#555]">Loading…</p>
      ) : schedules.length === 0 ? (
        <p className="text-[11px] text-[#444] italic">
          No schedules yet — ask Claude to schedule something for you.
        </p>
      ) : (
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
                {s.once === 1 && (
                  <span className="text-[10px] text-[#555] border border-[#2a2a2a] rounded px-1 py-px flex-shrink-0">once</span>
                )}
                <span className="flex-1 text-[11px] text-[#888] truncate" title={s.prompt}>{s.prompt}</span>
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
    </div>
  )
}
