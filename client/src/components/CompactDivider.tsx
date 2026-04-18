import { useState } from 'react'

type Props = {
  fromTitle: string
  summary: string | null
  compactedAt: number  // Unix seconds
}

export function CompactDivider({ fromTitle, summary, compactedAt }: Props) {
  const [expanded, setExpanded] = useState(false)

  const dateLabel = new Date(compactedAt * 1000).toLocaleDateString([], {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-2 select-none my-1">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-app-bg-overlay" />
        <button
          onClick={() => summary && setExpanded((o) => !o)}
          className={`flex items-center gap-1.5 text-[11px] text-app-text-7 transition-colors
            ${summary ? 'hover:text-app-text-5 cursor-pointer' : 'cursor-default'}`}
          title={summary ? (expanded ? 'Hide summary' : 'Show compact summary') : undefined}
        >
          <span>⊡ Compacted</span>
          <span className="text-app-border-2">·</span>
          <span>{dateLabel}</span>
          {summary && (
            <span className="text-app-border-2 ml-0.5">{expanded ? '▲' : '▼'}</span>
          )}
        </button>
        <div className="flex-1 h-px bg-app-bg-overlay" />
      </div>
      {expanded && summary && (
        <div className="mx-2 px-3 py-2.5 bg-app-bg border border-app-bg-overlay rounded-lg">
          <p className="text-[10px] text-app-border-3 uppercase tracking-wider mb-1.5">
            Summary of &ldquo;{fromTitle}&rdquo;
          </p>
          <p className="text-[12px] text-app-text-6 leading-relaxed">{summary}</p>
        </div>
      )}
    </div>
  )
}
