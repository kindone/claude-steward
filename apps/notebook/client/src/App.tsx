import { useState, useEffect, useCallback } from 'react'
import type { Cell, Language, CellType } from './types'
import { listCells, createCell, deleteCell, moveCell } from './api'
import { Cell as CellComponent } from './components/Cell'
import { AddCellButton } from './components/AddCellButton'
import { ChatPanel } from './components/ChatPanel'
import { KernelStatusBar } from './components/KernelStatusBar'

export default function App() {
  const [cells, setCells] = useState<Cell[]>([])
  const [loading, setLoading] = useState(true)
  const [aiRunningCellId, setAiRunningCellId] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)

  useEffect(() => {
    listCells()
      .then(setCells)
      .finally(() => setLoading(false))
  }, [])

  // File watcher updates from Claude edits (via chat SSE)
  useEffect(() => {
    const handler = (e: Event) => {
      const { cellId, source } = (e as CustomEvent<{ cellId: string; source: string }>).detail
      setCells(prev => prev.map(c => c.id === cellId ? { ...c, source } : c))
    }
    window.addEventListener('notebook:cell-updated', handler)
    return () => window.removeEventListener('notebook:cell-updated', handler)
  }, [])

  const sorted = cells.slice().sort((a, b) => a.position - b.position)

  const handleAddCell = useCallback(async (type: CellType, language?: Language) => {
    const cell = await createCell({ type, language: language ?? 'python', source: '' })
    setCells(prev => [...prev, cell])
  }, [])

  const handleUpdateCell = useCallback((updated: Cell) => {
    setCells(prev => prev.map(c => c.id === updated.id ? updated : c))
  }, [])

  const handleDeleteCell = useCallback(async (id: string) => {
    await deleteCell(id)
    setCells(prev => prev.filter(c => c.id !== id))
  }, [])

  const handleMove = useCallback(async (id: string, direction: 'up' | 'down') => {
    const s = cells.slice().sort((a, b) => a.position - b.position)
    const idx = s.findIndex(c => c.id === id)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= s.length) return

    const target = s[targetIdx]
    const current = s[idx]

    // Swap positions
    const [updatedCurrent, updatedTarget] = await Promise.all([
      moveCell(current.id, target.position),
      moveCell(target.id, current.position),
    ])
    setCells(prev => prev.map(c =>
      c.id === updatedCurrent.id ? updatedCurrent :
      c.id === updatedTarget.id ? updatedTarget : c
    ))
  }, [cells])

  const handleRunAll = useCallback(async () => {
    if (runningAll) return
    setRunningAll(true)
    const codeCells = sorted.filter(c => c.type === 'code')
    for (const cell of codeCells) {
      await new Promise<void>((resolve) => {
        // Trigger run by dispatching a custom event the Cell component can listen to
        window.dispatchEvent(new CustomEvent('notebook:run-cell', { detail: { cellId: cell.id, onDone: resolve } }))
        // Fallback: resolve after 30s in case cell doesn't respond
        setTimeout(resolve, 30_000)
      })
    }
    setRunningAll(false)
  }, [sorted, runningAll])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--color-muted)]">
        Loading notebook…
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Cell panel */}
      <div className="flex-1 overflow-y-auto min-w-0 flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-10">
          <h1 className="text-sm font-semibold text-[var(--color-text)] flex-shrink-0">Notebook</h1>
          <span className="text-xs text-[var(--color-muted)] flex-shrink-0">
            {sorted.length} cell{sorted.length !== 1 ? 's' : ''}
          </span>

          <div className="flex-1 min-w-0">
            <KernelStatusBar />
          </div>

          <button
            onClick={handleRunAll}
            disabled={runningAll || sorted.filter(c => c.type === 'code').length === 0}
            className={`flex-shrink-0 text-xs px-3 py-1 rounded font-medium transition-colors ${
              runningAll
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {runningAll ? '⏳ Running…' : '▶▶ Run All'}
          </button>
        </div>

        {/* Cells */}
        <div className="p-4 space-y-3">
          {sorted.length === 0 && (
            <div className="text-center text-[var(--color-muted)] text-sm py-12">
              <p>No cells yet.</p>
              <p className="text-xs mt-1">Add a cell below or ask the AI to create one.</p>
            </div>
          )}

          {sorted.map((cell, idx) => (
            <CellComponent
              key={cell.id}
              cell={cell}
              onUpdate={handleUpdateCell}
              onDelete={handleDeleteCell}
              onMoveUp={() => handleMove(cell.id, 'up')}
              onMoveDown={() => handleMove(cell.id, 'down')}
              canMoveUp={idx > 0}
              canMoveDown={idx < sorted.length - 1}
              isRunningByAI={aiRunningCellId === cell.id}
            />
          ))}

          <AddCellButton onAdd={handleAddCell} />
        </div>
      </div>

      {/* Chat panel */}
      <div className="w-[360px] min-w-[280px] border-l border-[var(--color-border)] flex flex-col h-full flex-shrink-0">
        <ChatPanel
          onCellRunByAI={setAiRunningCellId}
          onCellUpdatedByAI={() => {}}
        />
      </div>
    </div>
  )
}
