import { useState, useEffect } from 'react'
import type { KernelStatus, Language } from '../types'
import { kernelStatus, restartKernel } from '../api'

const LANG_LABELS: Record<Language, string> = {
  python: 'Python',
  node: 'Node.js',
  bash: 'Bash',
  cpp: 'C++',
}

const LANG_COLORS: Record<Language, string> = {
  python: 'text-blue-400',
  node: 'text-green-400',
  bash: 'text-yellow-400',
  cpp: 'text-orange-400',
}

interface Props {
  notebookId: string
}

export function KernelStatusBar({ notebookId }: Props) {
  const [statuses, setStatuses] = useState<KernelStatus[]>([])
  const [restarting, setRestarting] = useState<Language | null>(null)

  const refresh = () => {
    kernelStatus(notebookId).then(setStatuses).catch(() => {})
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [notebookId])

  const handleRestart = async (lang: Language) => {
    setRestarting(lang)
    try {
      await restartKernel(notebookId, lang)
      await new Promise(r => setTimeout(r, 300))
      refresh()
    } finally {
      setRestarting(null)
    }
  }

  if (statuses.length === 0) return null

  return (
    <div className="flex items-center gap-3 px-1 flex-wrap">
      {statuses.map(s => (
        <button
          key={s.language}
          onClick={() => s.alive ? handleRestart(s.language) : undefined}
          title={s.alive
            ? `${LANG_LABELS[s.language]} kernel running (pid ${s.pid}) — click to restart`
            : `${LANG_LABELS[s.language]} kernel not started`}
          className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors group"
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            restarting === s.language
              ? 'bg-yellow-400 animate-pulse'
              : s.alive
              ? 'bg-green-400'
              : 'bg-gray-600'
          }`} />
          <span className={s.alive ? LANG_COLORS[s.language] : ''}>
            {LANG_LABELS[s.language]}
          </span>
          {s.alive && (
            <span className="opacity-0 group-hover:opacity-60 text-[10px]">↺</span>
          )}
        </button>
      ))}
    </div>
  )
}
