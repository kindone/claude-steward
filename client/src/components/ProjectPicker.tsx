import { useState, useRef, useEffect } from 'react'
import type { Project } from '../lib/api'

type Props = {
  projects: Project[]
  activeProjectId: string | null
  onSelect: (id: string | null) => void
  onCreate: (name: string, path: string) => Promise<void>
  onDelete: (id: string) => void
  protectedPath?: string | null
}

export function ProjectPicker({ projects, activeProjectId, onSelect, onCreate, onDelete, protectedPath }: Props) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [pathVal, setPathVal] = useState('')
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

  return (
    <div className="project-picker" ref={dropdownRef}>
      <button
        className="project-picker__trigger"
        onClick={() => setOpen((o) => !o)}
        title="Switch project"
      >
        <span className="project-picker__label">
          {activeProject ? activeProject.name : 'No project'}
        </span>
        <span className="project-picker__chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="project-picker__dropdown">
          <ul className="project-picker__list">
            <li
              className={`project-picker__item${!activeProjectId ? ' project-picker__item--active' : ''}`}
              onClick={() => { onSelect(null); setOpen(false) }}
            >
              <span>No project</span>
            </li>
            {projects.map((p) => (
              <li
                key={p.id}
                className={`project-picker__item${p.id === activeProjectId ? ' project-picker__item--active' : ''}`}
                onClick={() => { onSelect(p.id); setOpen(false) }}
              >
                <span className="project-picker__item-name">{p.name}</span>
                {p.path !== protectedPath && (
                  <button
                    className="project-picker__delete"
                    onClick={(e) => handleDelete(e, p.id)}
                    title="Delete project"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="project-picker__footer">
            {!creating ? (
              <button
                className="project-picker__new-btn"
                onClick={() => setCreating(true)}
              >
                + New project
              </button>
            ) : (
              <form className="project-picker__form" onSubmit={handleCreate}>
                <input
                  autoFocus
                  className="project-picker__input"
                  placeholder="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input
                  className="project-picker__input"
                  placeholder="/absolute/path/on/server"
                  value={pathVal}
                  onChange={(e) => setPathVal(e.target.value)}
                />
                {error && <p className="project-picker__error">{error}</p>}
                <div className="project-picker__form-actions">
                  <button
                    type="button"
                    className="project-picker__cancel"
                    onClick={() => { setCreating(false); setError('') }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="project-picker__submit"
                    disabled={submitting || !name.trim() || !pathVal.trim()}
                  >
                    {submitting ? 'Adding…' : 'Add'}
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
