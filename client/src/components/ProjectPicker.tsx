import { useState, useRef, useEffect } from 'react'
import type { Project } from '../lib/api'

type Props = {
  projects: Project[]
  activeProjectId: string | null
  onSelect: (id: string | null) => void
  onCreate: (name: string, path: string) => Promise<void>
  onDelete: (id: string) => void
  onUpdateSystemPrompt?: (projectId: string, systemPrompt: string | null) => Promise<void>
  protectedPath?: string | null
}

export function ProjectPicker({ projects, activeProjectId, onSelect, onCreate, onDelete, onUpdateSystemPrompt, protectedPath }: Props) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [name, setName] = useState('')
  const [pathVal, setPathVal] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const activeProject = projects.find((p) => p.id === activeProjectId)

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !pathVal.trim()) return
    setError('')
    setSubmitting(true)
    try {
      await onCreate(name.trim(), pathVal.trim())
      setName('')
      setPathVal('')
      setCreating(false)
      setOpen(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (window.confirm('Delete this project? Sessions will be unlinked but not deleted.')) {
      onDelete(id)
    }
  }

  async function handlePromptSave(e: React.FormEvent) {
    e.preventDefault()
    if (!activeProjectId || !onUpdateSystemPrompt) return
    setSubmitting(true)
    try {
      await onUpdateSystemPrompt(activeProjectId, promptDraft.trim() || null)
      setEditingPrompt(false)
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpenPrompt() {
    setPromptDraft(activeProject?.system_prompt ?? '')
    setCreating(false)
    setEditingPrompt(true)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 bg-transparent border-none text-app-text-2 hover:bg-app-bg-card hover:text-white cursor-pointer text-sm font-semibold text-left gap-1.5 transition-colors min-h-[44px]"
        onClick={() => setOpen((o) => !o)}
        title="Switch project"
      >
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {activeProject ? activeProject.name : 'Select project…'}
        </span>
        <span className="text-app-text-6 text-[10px] flex-shrink-0">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 bg-app-bg-overlay border border-app-border-2 rounded-lg z-[100] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          <ul className="list-none p-1 max-h-[200px] overflow-y-auto">
            {projects.map((p) => (
              <li
                key={p.id}
                className={`group flex items-center gap-1 px-2.5 py-2 rounded cursor-pointer text-sm transition-colors
                  ${p.id === activeProjectId
                    ? 'bg-app-blue-tint text-app-text'
                    : 'text-app-text-2 hover:bg-app-bg-hover hover:text-white'}`}
                onClick={() => { onSelect(p.id); setOpen(false) }}
              >
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{p.name}</span>
                {p.path !== protectedPath && (
                  <button
                    className="bg-transparent border-none text-app-text-5 cursor-pointer text-[15px] px-0.5 rounded leading-none flex-shrink-0 transition-colors
                      hidden group-hover:block [@media(hover:none)]:block
                      hover:text-red-500 hover:bg-red-500/15"
                    onClick={(e) => handleDelete(e, p.id)}
                    title="Delete project"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="border-t border-app-bg-hover p-1.5">
            {!creating && !editingPrompt ? (
              <div className="flex flex-col gap-0.5">
                <button
                  className="w-full bg-transparent border-none text-app-text-6 text-xs px-2 py-1.5 cursor-pointer text-left rounded hover:bg-app-bg-overlay hover:text-app-text-3 transition-colors"
                  onClick={() => { setCreating(true) }}
                >
                  + New project
                </button>
                {activeProject && onUpdateSystemPrompt && (
                  <button
                    className="w-full bg-transparent border-none text-app-text-6 text-xs px-2 py-1.5 cursor-pointer text-left rounded hover:bg-app-bg-overlay hover:text-app-text-3 transition-colors"
                    onClick={handleOpenPrompt}
                  >
                    {activeProject.system_prompt ? '✎ Edit default prompt' : '+ Set default prompt'}
                  </button>
                )}
              </div>
            ) : creating ? (
              <form className="flex flex-col gap-1.5 p-0.5" onSubmit={handleCreate}>
                <input
                  autoFocus
                  className="bg-app-bg-card border border-app-border-2 focus:border-blue-600 rounded text-app-text text-base px-2 py-1.5 outline-none font-[inherit]"
                  placeholder="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input
                  className="bg-app-bg-card border border-app-border-2 focus:border-blue-600 rounded text-app-text text-base px-2 py-1.5 outline-none font-[inherit]"
                  placeholder="/absolute/path/on/server"
                  value={pathVal}
                  onChange={(e) => setPathVal(e.target.value)}
                />
                {error && <p className="text-[11px] text-red-400">{error}</p>}
                <div className="flex gap-1.5 justify-end">
                  <button
                    type="button"
                    className="bg-transparent border border-app-border-3 hover:border-app-border-5 hover:text-app-text-2 rounded text-app-text-4 text-xs px-2.5 py-1.5 cursor-pointer transition-colors"
                    onClick={() => { setCreating(false); setError('') }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-app-blue-tint-subtle disabled:text-app-text-6 disabled:cursor-not-allowed border-none rounded text-white text-xs px-3 py-1.5 cursor-pointer transition-colors"
                    disabled={submitting || !name.trim() || !pathVal.trim()}
                  >
                    {submitting ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </form>
            ) : (
              <form className="flex flex-col gap-1.5 p-0.5" onSubmit={handlePromptSave}>
                <p className="text-[10px] text-app-text-6 px-0.5">Default system prompt for new sessions</p>
                <textarea
                  autoFocus
                  rows={4}
                  className="bg-app-bg-card border border-app-border-2 focus:border-blue-600 rounded text-app-text text-xs px-2 py-1.5 outline-none font-[inherit] resize-none"
                  placeholder="You are a helpful assistant…"
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                />
                <div className="flex gap-1.5 justify-end">
                  <button
                    type="button"
                    className="bg-transparent border border-app-border-3 hover:border-app-border-5 hover:text-app-text-2 rounded text-app-text-4 text-xs px-2.5 py-1.5 cursor-pointer transition-colors"
                    onClick={() => setEditingPrompt(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-app-blue-tint-subtle disabled:text-app-text-6 disabled:cursor-not-allowed border-none rounded text-white text-xs px-3 py-1.5 cursor-pointer transition-colors"
                    disabled={submitting}
                  >
                    {submitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
