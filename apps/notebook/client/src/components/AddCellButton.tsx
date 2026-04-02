import { useState } from 'react'
import type { Language, CellType } from '../types'

type AddOption = { type: CellType; language?: Language; label: string }

const OPTIONS: AddOption[] = [
  { type: 'code',     language: 'python', label: '🐍 Python' },
  { type: 'code',     language: 'node',   label: '⚡ Node.js' },
  { type: 'code',     language: 'bash',   label: '🐚 Bash' },
  { type: 'code',     language: 'cpp',    label: '⚙️  C++' },
  { type: 'markdown',                     label: '📝 Markdown' },
]

interface Props {
  onAdd: (type: CellType, language?: Language) => void
}

export function AddCellButton({ onAdd }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative flex justify-center">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs px-3 py-1 rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
      >
        + Add cell
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-7 z-20 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg overflow-hidden">
            {OPTIONS.map(({ type, language, label }) => (
              <button
                key={label}
                onClick={() => { onAdd(type, language); setOpen(false) }}
                className="block w-full text-left px-4 py-2 text-xs hover:bg-white/5 text-[var(--color-text)]"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
