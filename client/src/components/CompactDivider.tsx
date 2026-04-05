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
        <div className="flex-1 h-px bg-[#1e1e1e]" />
        <button
          onClick={() => summary && setExpanded((o) => !o)}
          className={`flex items-center gap-1.5 text-[11px] text-[#3a3a3a] transition-colors
            ${summary ? 'hover:text-[#666] cursor-pointer' : 'cursor-default'}`}
          title={summary ? (expanded ? 'Hide summary' : 'Show compact summary') : undefined}
        >
          <span>⊡ Compacted</span>
          <span className="text-[#2a2a2a]">·</span>
          <span>{dateLabel}</span>
          {summary && (
            <span className="text-[#2a2a2a] ml-0.5">{expanded ? '▲' : '▼'}</span>
          )}
        </button>
        <div className="flex-1 h-px bg-[#1e1e1e]" />
      </div>
      {expanded && summary && (
        <div className="mx-2 px-3 py-2.5 bg-[#0f0f0f] border border-[#1e1e1e] rounded-lg">
          <p className="text-[10px] text-[#333] uppercase tracking-wider mb-1.5">
            Summary of &ldquo;{fromTitle}&rdquo;
          </p>
          <p className="text-[12px] text-[#555] leading-relaxed">{summary}</p>
        </div>
      )}
    </div>
  )
}
