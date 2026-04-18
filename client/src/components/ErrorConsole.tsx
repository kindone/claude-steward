import { useState } from 'react'

export type ErrorEntry = {
  id: string
  timestamp: number   // Date.now()
  message: string
  stack?: string
}

type Props = {
  errors: ErrorEntry[]
  onDismiss: (id: string) => void
  onClearAll: () => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ErrorConsole({ errors, onDismiss, onClearAll }: Props) {
  const [open, setOpen] = useState(false)

  if (errors.length === 0) return null

  const latest = errors[errors.length - 1]
  const count = errors.length

  return (
    <>
      {/* Top banner — always visible when there are errors */}
      <div className="fixed top-0 inset-x-0 z-[9998] bg-red-900/90 border-b border-red-700 px-4 py-2 flex items-center gap-3 text-sm text-red-100">
        {count > 1 && (
          <span className="flex-shrink-0 bg-red-700 text-red-100 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
            {count}
          </span>
        )}
        <span className="flex-1 font-mono text-xs leading-relaxed break-all line-clamp-1">{latest.message}</span>
        <button
          onClick={() => setOpen(true)}
          className="flex-shrink-0 text-red-300 hover:text-white text-xs border border-red-700 hover:border-red-400 rounded px-2 py-0.5 transition-colors"
        >
          Details
        </button>
        <button
          onClick={() => onDismiss(latest.id)}
          className="flex-shrink-0 text-red-300 hover:text-white leading-none text-lg"
          title="Dismiss latest"
        >✕</button>
      </div>

      {/* Error history drawer */}
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />

          {/* Panel */}
          <div className="relative w-full sm:max-w-2xl max-h-[80vh] flex flex-col bg-app-bg-raised border border-app-border-2 sm:rounded-xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-app-bg-overlay flex-shrink-0">
              <span className="text-red-400 text-sm font-medium flex-1">Error Console ({count})</span>
              <button
                onClick={onClearAll}
                className="text-[11px] text-app-text-6 hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
              <button onClick={() => setOpen(false)} className="text-app-text-6 hover:text-white text-lg leading-none ml-1">✕</button>
            </div>

            {/* Error list */}
            <div className="overflow-y-auto flex-1 divide-y divide-[#1a1a1a]">
              {[...errors].reverse().map((err) => (
                <ErrorRow key={err.id} err={err} onDismiss={onDismiss} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ErrorRow({ err, onDismiss }: { err: ErrorEntry; onDismiss: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <span className="text-[10px] text-app-text-7 font-mono flex-shrink-0 mt-0.5">{formatTime(err.timestamp)}</span>
        <span className="flex-1 font-mono text-xs text-red-300 break-all leading-relaxed">{err.message}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {err.stack && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] text-app-text-7 hover:text-app-text-4 transition-colors"
            >
              {expanded ? 'hide stack' : 'stack trace'}
            </button>
          )}
          <button
            onClick={() => onDismiss(err.id)}
            className="text-app-text-7 hover:text-app-text-4 leading-none text-base"
            title="Dismiss"
          >✕</button>
        </div>
      </div>
      {expanded && err.stack && (
        <pre className="text-[10px] text-app-text-6 bg-app-bg border border-app-bg-overlay rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-[300px] overflow-y-auto">
          {err.stack}
        </pre>
      )}
    </div>
  )
}
