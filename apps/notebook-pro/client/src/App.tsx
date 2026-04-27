import { useState, useEffect, useCallback, useRef } from 'react'
import type { Cell, Language, CellType, Notebook } from './types'
import { listNotebooks, listCells, createCell, deleteCell, moveCell, killNotebookKernels } from './api'
import { Cell as CellComponent } from './components/Cell'
import { AddCellButton } from './components/AddCellButton'
import { ChatPanel } from './components/ChatPanel'
import { KernelStatusBar } from './components/KernelStatusBar'
import { NotebookHome } from './components/NotebookHome'
import { useWatchStream } from './hooks/useWatchStream'

// ── Persistence helpers ───────────────────────────────────────────────────────

function loadTabs(): string[] {
  try { return JSON.parse(localStorage.getItem('nb:openTabs') ?? '[]') } catch { return [] }
}
function saveTabs(tabs: string[]): void {
  localStorage.setItem('nb:openTabs', JSON.stringify(tabs))
}
function loadActiveTab(): string | null {
  return localStorage.getItem('nb:activeTab')
}
function saveActiveTab(id: string | null): void {
  if (id) localStorage.setItem('nb:activeTab', id)
  else localStorage.removeItem('nb:activeTab')
}

// ── NotebookEditor ────────────────────────────────────────────────────────────

interface EditorProps {
  notebook: Notebook
  visible: boolean
}

function NotebookEditor({ notebook, visible }: EditorProps) {
  const notebookId = notebook.id
  const [cells, setCells] = useState<Cell[]>([])
  const [loading, setLoading] = useState(true)
  const [aiRunningCellId, setAiRunningCellId] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [mobileTab, setMobileTab] = useState<'cells' | 'chat'>('cells')

  // Persistent SSE watch stream — single source of truth for all cell broadcasts
  useWatchStream()

  useEffect(() => {
    listCells(notebookId)
      .then(setCells)
      .finally(() => setLoading(false))
  }, [notebookId])

  // Real-time cell sync from Claude MCP tool calls (via watch SSE broadcasts)
  useEffect(() => {
    const onUpdated = (e: Event) => {
      const { cellId, source, cell } = (e as CustomEvent<{ cellId: string; source?: string; cell?: Cell }>).detail
      setCells(prev => prev.map(c => c.id === cellId ? (cell ?? { ...c, source: source ?? c.source }) : c))
    }
    const onCreated = (e: Event) => {
      const cell = (e as CustomEvent<Cell>).detail
      if (cell.notebook_id !== notebookId) return
      setCells(prev => prev.some(c => c.id === cell.id) ? prev : [...prev, cell])
    }
    const onDeleted = (e: Event) => {
      const { cellId } = (e as CustomEvent<{ cellId: string }>).detail
      setCells(prev => prev.filter(c => c.id !== cellId))
    }
    window.addEventListener('notebook:cell-updated', onUpdated)
    window.addEventListener('notebook:cell-created', onCreated)
    window.addEventListener('notebook:cell-deleted', onDeleted)
    return () => {
      window.removeEventListener('notebook:cell-updated', onUpdated)
      window.removeEventListener('notebook:cell-created', onCreated)
      window.removeEventListener('notebook:cell-deleted', onDeleted)
    }
  }, [notebookId])

  const sorted = cells.slice().sort((a, b) => a.position - b.position)

  const handleAddCell = useCallback(async (type: CellType, language?: Language) => {
    const cell = await createCell(notebookId, { type, language: language ?? 'python', source: '' })
    setCells(prev => [...prev, cell])
  }, [notebookId])

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
        window.dispatchEvent(new CustomEvent('notebook:run-cell', { detail: { cellId: cell.id, onDone: resolve } }))
        setTimeout(resolve, 30_000)
      })
    }
    setRunningAll(false)
  }, [sorted, runningAll])

  if (loading) {
    return (
      <div className={`flex items-center justify-center flex-1 text-[var(--color-muted)] ${visible ? '' : 'hidden'}`}>
        Loading…
      </div>
    )
  }

  return (
    <div className={`flex flex-col flex-1 overflow-hidden ${visible ? '' : 'hidden'}`}>

      {/* Mobile tab bar (cells ↔ chat) */}
      <div className="flex md:hidden border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0">
        <button
          onClick={() => setMobileTab('cells')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'cells'
              ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-muted)]'
          }`}
        >
          Cells
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            mobileTab === 'chat'
              ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-muted)]'
          }`}
        >
          AI Chat
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Cell panel */}
        <div className={`${mobileTab === 'cells' ? 'flex' : 'hidden'} md:flex flex-col flex-1 overflow-hidden min-w-0`}>

          {/* Notebook header */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0">
            <span className="text-sm font-semibold text-[var(--color-text)] flex-shrink-0 truncate max-w-[140px]" title={notebook.title}>
              {notebook.title}
            </span>
            <span className="text-xs text-[var(--color-muted)] flex-shrink-0">
              {sorted.length} cell{sorted.length !== 1 ? 's' : ''}
            </span>

            <div className="flex-1 min-w-0">
              <KernelStatusBar notebookId={notebookId} />
            </div>

            <button
              onClick={() => window.dispatchEvent(new CustomEvent('notebook:fold-all', { detail: true }))}
              className="flex-shrink-0 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/10 transition-colors"
              title="Fold all cells"
            >⊟ Fold</button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('notebook:fold-all', { detail: false }))}
              className="flex-shrink-0 text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/10 transition-colors"
              title="Expand all cells"
            >⊞ Expand</button>

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
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
        <div className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[260px] lg:w-[340px] md:border-l border-[var(--color-border)] flex-shrink-0 overflow-hidden`}>
          <ChatPanel
            notebookId={notebookId}
            onCellRunByAI={setAiRunningCellId}
            onCellUpdatedByAI={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

// ── App (tab bar + routing) ───────────────────────────────────────────────────

export default function App() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [loading, setLoading] = useState(true)

  // openTabs: ordered list of notebook IDs open in the tab bar (desktop)
  const [openTabs, setOpenTabs] = useState<string[]>(loadTabs)
  // activeTabId: currently shown notebook (null = home screen)
  const [activeTabId, setActiveTabId] = useState<string | null>(loadActiveTab)

  // Persist tabs on change
  useEffect(() => { saveTabs(openTabs) }, [openTabs])
  useEffect(() => { saveActiveTab(activeTabId) }, [activeTabId])

  useEffect(() => {
    listNotebooks()
      .then(nbs => {
        setNotebooks(nbs)
        // Prune persisted tabs that no longer exist
        const ids = new Set(nbs.map(n => n.id))
        setOpenTabs(prev => prev.filter(id => ids.has(id)))
        setActiveTabId(prev => (prev && ids.has(prev)) ? prev : null)
      })
      .finally(() => setLoading(false))
  }, [])

  const openNotebook = useCallback((id: string) => {
    setOpenTabs(prev => prev.includes(id) ? prev : [...prev, id])
    setActiveTabId(id)
  }, [])

  const closeTab = useCallback(async (id: string) => {
    // Kill kernels for this notebook on tab close
    killNotebookKernels(id).catch(() => {})

    setOpenTabs(prev => {
      const next = prev.filter(t => t !== id)
      // If we're closing the active tab, switch to adjacent or null
      setActiveTabId(cur => {
        if (cur !== id) return cur
        const idx = prev.indexOf(id)
        return next[idx] ?? next[idx - 1] ?? null
      })
      return next
    })
  }, [])

  const handleCreated = useCallback((nb: Notebook) => {
    setNotebooks(prev => [...prev, nb])
  }, [])

  const handleDeleted = useCallback((id: string) => {
    setNotebooks(prev => prev.filter(n => n.id !== id))
    closeTab(id)
  }, [closeTab])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--color-muted)]">
        Loading…
      </div>
    )
  }

  const notebookMap = new Map(notebooks.map(n => [n.id, n]))
  const showHome = activeTabId === null || !notebookMap.has(activeTabId)

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">

      {/* ── Desktop tab bar (md+) ─────────────────────────────────────────── */}
      <div className="hidden md:flex items-center border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0 overflow-x-auto">

        {/* Home tab */}
        <button
          onClick={() => setActiveTabId(null)}
          title="All notebooks"
          className={`flex-shrink-0 px-3 py-2.5 text-sm transition-colors border-r border-[var(--color-border)] ${
            showHome
              ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/5'
              : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          ⌂
        </button>

        {/* Open notebook tabs */}
        {openTabs.map(id => {
          const nb = notebookMap.get(id)
          if (!nb) return null
          const isActive = activeTabId === id
          return (
            <div
              key={id}
              className={`group flex items-center gap-1.5 px-3 py-2.5 border-r border-[var(--color-border)] cursor-pointer flex-shrink-0 min-w-0 max-w-[180px] transition-colors ${
                isActive
                  ? 'text-[var(--color-text)] bg-[var(--color-accent)]/5 border-b-2 border-b-[var(--color-accent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/5'
              }`}
              onClick={() => setActiveTabId(id)}
            >
              <span className="text-xs truncate flex-1">{nb.title}</span>
              <button
                onClick={e => { e.stopPropagation(); closeTab(id) }}
                className="flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-400 transition-all text-xs leading-none pb-0.5"
                title="Close tab"
              >
                ×
              </button>
            </div>
          )
        })}

        {/* New tab button */}
        <button
          onClick={() => setActiveTabId(null)}
          title="New notebook"
          className="flex-shrink-0 px-3 py-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors text-base leading-none"
        >
          +
        </button>
      </div>

      {/* ── Mobile: back button when inside a notebook ────────────────────── */}
      {!showHome && (
        <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0">
          <button
            onClick={() => setActiveTabId(null)}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)] text-sm transition-colors"
          >
            ← Notebooks
          </button>
          <span className="text-sm text-[var(--color-text)] font-medium truncate">
            {notebookMap.get(activeTabId!)?.title}
          </span>
        </div>
      )}

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Home screen — shown when no tab active */}
        {showHome && (
          <NotebookHome
            notebooks={notebooks}
            onOpen={openNotebook}
            onCreated={handleCreated}
            onDeleted={handleDeleted}
          />
        )}

        {/* Keep all open editors mounted (hidden when not active) so state is preserved */}
        {openTabs.map(id => {
          const nb = notebookMap.get(id)
          if (!nb) return null
          return (
            <NotebookEditor
              key={id}
              notebook={nb}
              visible={!showHome && activeTabId === id}
            />
          )
        })}
      </div>
    </div>
  )
}
