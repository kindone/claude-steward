import { useState } from 'react'
import type { Notebook } from '../types'
import { createNotebook, deleteNotebook } from '../api'

interface Props {
  notebooks: Notebook[]
  onOpen: (id: string) => void
  onCreated: (nb: Notebook) => void
  onDeleted: (id: string) => void
}

export function NotebookHome({ notebooks, onOpen, onCreated, onDeleted }: Props) {
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleCreate = async () => {
    const title = newTitle.trim()
    if (!title || submitting) return
    setSubmitting(true)
    try {
      const nb = await createNotebook(title)
      onCreated(nb)
      setNewTitle('')
      setCreating(false)
      onOpen(nb.id)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (nb: Notebook) => {
    if (!confirm(`Delete "${nb.title}"? This will permanently remove all cells.`)) return
    setDeletingId(nb.id)
    try {
      await deleteNotebook(nb.id)
      onDeleted(nb.id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold text-[var(--color-text)]">Notebooks</h1>
          <button
            onClick={() => { setCreating(true); setNewTitle('') }}
            className="text-sm px-3 py-1.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 transition-colors font-medium"
          >
            + New
          </button>
        </div>

        {/* New notebook form */}
        {creating && (
          <div className="mb-4 p-3 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-surface)]">
            <p className="text-xs text-[var(--color-muted)] mb-2">Notebook name</p>
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') { setCreating(false); setNewTitle('') }
                }}
                placeholder="e.g. Data Analysis"
                className="flex-1 bg-transparent border border-[var(--color-border)] rounded px-2 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || submitting}
                className="px-3 py-1.5 rounded bg-[var(--color-accent)] text-white text-sm font-medium disabled:opacity-40 hover:bg-[var(--color-accent)]/80"
              >
                Create
              </button>
              <button
                onClick={() => { setCreating(false); setNewTitle('') }}
                className="px-2 py-1.5 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {notebooks.length === 0 && !creating && (
          <div className="text-center py-16 text-[var(--color-muted)]">
            <div className="text-4xl mb-3 opacity-30">📒</div>
            <p className="text-sm">No notebooks yet.</p>
            <p className="text-xs mt-1">Create one to get started.</p>
          </div>
        )}

        {/* Notebook list */}
        <div className="space-y-2">
          {notebooks.map(nb => (
            <div
              key={nb.id}
              className="group flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/40 transition-colors cursor-pointer"
              onClick={() => onOpen(nb.id)}
            >
              <span className="text-xl opacity-60">📒</span>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)] truncate">{nb.title}</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  {new Date(nb.created_at * 1000).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </p>
              </div>

              <button
                onClick={e => { e.stopPropagation(); handleDelete(nb) }}
                disabled={deletingId === nb.id}
                className="text-[var(--color-muted)] hover:text-red-400 transition-colors text-xs px-2 py-1 rounded"
                title="Delete notebook"
              >
                {deletingId === nb.id ? '…' : '🗑'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
