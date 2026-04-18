import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { listFiles, getFileContent, patchFile, uploadFiles, FileConflictError, type FileEntry } from '../lib/api'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

// ── File-type helpers ────────────────────────────────────────────────────────

function fileExt(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? ''
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif'])
const MD_EXTS = new Set(['md', 'markdown', 'mdx'])

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  html: 'xml', htm: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  graphql: 'graphql',
}

function getLang(filePath: string): string | null {
  const basename = filePath.split('/').pop()?.toLowerCase() ?? ''
  if (basename === 'dockerfile') return 'dockerfile'
  if (basename === 'makefile') return 'makefile'
  return EXT_TO_LANG[fileExt(filePath)] ?? null
}

function isImage(filePath: string): boolean { return IMAGE_EXTS.has(fileExt(filePath)) }
function isMarkdown(filePath: string): boolean { return MD_EXTS.has(fileExt(filePath)) }

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── FileViewer / FileEditor modal ────────────────────────────────────────────

type ViewerState = {
  path: string
  content: string
  lastModified: number
  type: 'text' | 'image'
} | null

function FileViewer({
  viewer,
  projectId,
  onClose,
}: {
  viewer: NonNullable<ViewerState>
  projectId: string
  onClose: () => void
}) {
  // Displayed (saved) content — updated after a successful save
  const [displayContent, setDisplayContent] = useState(viewer.content)
  const [lastModified, setLastModified] = useState(viewer.lastModified)

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isDirty = editing && draft !== displayContent
  const canEdit = viewer.type !== 'image'

  function startEdit() {
    setDraft(displayContent)
    setConflict(false)
    setSaveError(null)
    setEditing(true)
    // Focus textarea after render
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function cancelEdit() {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    setEditing(false)
    setConflict(false)
    setSaveError(null)
  }

  const save = useCallback(async (force = false) => {
    setSaving(true)
    setSaveError(null)
    setConflict(false)
    try {
      const result = await patchFile(
        projectId,
        viewer.path,
        draft,
        force ? undefined : lastModified,
        force,
      )
      setDisplayContent(draft)
      setLastModified(result.lastModified)
      setEditing(false)
    } catch (err) {
      if (err instanceof FileConflictError) {
        setConflict(true)
      } else {
        setSaveError((err as Error).message)
      }
    } finally {
      setSaving(false)
    }
  }, [projectId, viewer.path, draft, lastModified])

  const reloadFile = useCallback(async () => {
    try {
      const fresh = await getFileContent(projectId, viewer.path)
      setDisplayContent(fresh.content)
      setLastModified(fresh.lastModified)
      setDraft(fresh.content)
      setConflict(false)
    } catch (err) {
      setSaveError((err as Error).message)
    }
  }, [projectId, viewer.path])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (editing) {
          // Only auto-cancel if no unsaved changes
          if (!isDirty) { setEditing(false); setConflict(false); setSaveError(null) }
        } else {
          onClose()
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && editing) {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, isDirty, onClose, save])

  function handleCopy() {
    navigator.clipboard.writeText(displayContent).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {/* ignore */})
  }

  const lang = getLang(viewer.path)
  const rawSrc = `/api/projects/${projectId}/files/raw?path=${encodeURIComponent(viewer.path)}`

  // ── Content area ─────────────────────────────────────────────────────────

  let body: React.ReactNode

  if (editing) {
    body = (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-0 w-full resize-none bg-app-bg text-app-text-2 font-mono text-[13px] leading-relaxed p-5 border-none outline-none"
        style={{ fontFamily: "'SF Mono', 'Fira Code', monospace" }}
      />
    )
  } else if (viewer.type === 'image') {
    body = (
      <div className="flex-1 overflow-auto flex items-center justify-center p-6 bg-app-bg min-h-0">
        <img src={rawSrc} alt={viewer.path.split('/').pop()} className="max-w-full max-h-full object-contain rounded" />
      </div>
    )
  } else if (isMarkdown(viewer.path)) {
    const html = marked.parse(displayContent) as string
    body = (
      <div
        className="flex-1 overflow-auto p-6 prose text-sm leading-relaxed min-h-0"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  } else {
    let highlighted: string
    if (lang) {
      try { highlighted = hljs.highlight(displayContent, { language: lang, ignoreIllegals: true }).value }
      catch { highlighted = escapeHtml(displayContent) }
    } else {
      try { highlighted = hljs.highlightAuto(displayContent).value }
      catch { highlighted = escapeHtml(displayContent) }
    }

    const lineCount = displayContent.split('\n').length
    body = (
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div
          className="select-none text-right text-app-text-7 font-mono text-[13px] leading-relaxed flex-shrink-0 px-3 py-5 border-r border-app-border bg-app-bg overflow-hidden"
          aria-hidden="true"
        >
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <pre className="flex-1 overflow-auto p-5 m-0 bg-transparent text-[13px] leading-relaxed font-['SF_Mono','Fira_Code',monospace]">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>
    )
  }

  // ── Type badge ────────────────────────────────────────────────────────────

  const badge = lang ?? (isMarkdown(viewer.path) ? 'md' : isImage(viewer.path) ? fileExt(viewer.path) : null)

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-2 md:p-6"
      onClick={editing ? undefined : onClose}
    >
      <div
        className="bg-app-bg-overlay border border-app-border-2 rounded-xl flex flex-col overflow-hidden shadow-2xl"
        style={{ width: 'min(96vw, 1200px)', height: 'min(92dvh, 900px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {badge && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-app-border-2 text-app-text-6 uppercase tracking-wider font-semibold">
                {badge}
              </span>
            )}
            <span className="text-[13px] text-app-text-4 font-mono truncate" title={viewer.path}>
              {viewer.path}
            </span>
            {isDirty && (
              <span className="text-app-text-6 text-[11px] flex-shrink-0" title="Unsaved changes">●</span>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {editing ? (
              <>
                <button
                  onClick={() => void save()}
                  disabled={saving}
                  className="text-xs text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 rounded transition-colors cursor-pointer border-none font-medium"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={cancelEdit}
                  className="text-xs text-app-text-5 hover:text-app-text-2 hover:bg-app-bg-hover px-2.5 py-1.5 rounded transition-colors cursor-pointer border-none bg-transparent"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {canEdit && (
                  <button
                    onClick={startEdit}
                    className="text-xs text-app-text-5 hover:text-app-text-2 hover:bg-app-bg-hover px-2.5 py-1.5 rounded transition-colors cursor-pointer border-none bg-transparent"
                  >
                    Edit
                  </button>
                )}
                {viewer.type !== 'image' && (
                  <button
                    onClick={handleCopy}
                    className="text-xs text-app-text-5 hover:text-app-text-2 hover:bg-app-bg-hover px-2.5 py-1.5 rounded transition-colors cursor-pointer border-none bg-transparent"
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                )}
                <a
                  href={`${rawSrc}&download=1`}
                  download
                  className="text-xs text-app-text-5 hover:text-app-text-2 hover:bg-app-bg-hover px-2.5 py-1.5 rounded transition-colors cursor-pointer border-none bg-transparent no-underline"
                >
                  Download
                </a>
                <button
                  className="bg-transparent border-none text-app-text-5 hover:text-app-text-2 hover:bg-app-bg-hover text-xl cursor-pointer leading-none px-2 py-1 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  onClick={onClose}
                  aria-label="Close"
                >
                  ×
                </button>
              </>
            )}
          </div>
        </div>

        {/* Conflict banner */}
        {conflict && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-300 text-[12px] flex-shrink-0">
            <span className="flex-1">File was modified externally since you opened it.</span>
            <button
              onClick={() => void save(true)}
              className="px-2.5 py-1 rounded bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 cursor-pointer text-yellow-200 transition-colors"
            >
              Overwrite
            </button>
            <button
              onClick={reloadFile}
              className="px-2.5 py-1 rounded hover:bg-app-bg-hover border border-app-border-2 cursor-pointer text-app-text-3 transition-colors"
            >
              Reload file
            </button>
            <button onClick={() => setConflict(false)} className="text-app-text-6 hover:text-app-text-4 cursor-pointer bg-transparent border-none text-base leading-none">×</button>
          </div>
        )}

        {/* Error banner */}
        {saveError && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20 text-red-300 text-[12px] flex-shrink-0">
            <span className="flex-1">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="text-app-text-6 hover:text-app-text-4 cursor-pointer bg-transparent border-none text-base leading-none">×</button>
          </div>
        )}

        {/* Body */}
        {body}

        {/* Edit mode footer hint */}
        {editing && (
          <div className="flex-shrink-0 px-4 py-1.5 border-t border-app-border text-[11px] text-app-text-7">
            ⌘S / Ctrl+S to save · Escape to cancel (if no changes)
          </div>
        )}
      </div>
    </div>
  )
}

// ── FileTree ─────────────────────────────────────────────────────────────────

type Props = {
  projectId: string
  /** When true the tree is always shown without a toggle button and fills available height. */
  alwaysExpanded?: boolean
}

export function FileTree({ projectId, alwaysExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(alwaysExpanded)
  const [tree, setTree] = useState<Map<string, FileEntry[]>>(new Map())
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [viewer, setViewer] = useState<ViewerState>(null)

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Track the "current directory" for uploads — last opened dir or root
  const currentDirRef = useRef('')

  /** Force-reload a directory listing. */
  const refreshDir = useCallback(async (dirPath: string) => {
    setLoading(true)
    try {
      const entries = await listFiles(projectId, dirPath)
      setTree((prev) => new Map(prev).set(dirPath, entries))
    } catch (err) {
      console.error('[FileTree] load error', err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadDir = useCallback(async (dirPath: string) => {
    if (tree.has(dirPath)) return
    await refreshDir(dirPath)
  }, [tree, refreshDir])

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return
    setUploading(true)
    setUploadProgress(null)
    setUploadStatus(null)
    try {
      const result = await uploadFiles(
        projectId,
        fileArray,
        currentDirRef.current,
        (loaded, total) => setUploadProgress({ loaded, total }),
      )
      setUploadStatus(`Uploaded ${result.uploaded.length} file${result.uploaded.length > 1 ? 's' : ''}`)
      // Refresh the target directory
      void refreshDir(currentDirRef.current)
      // Timeout to clear status message
      setTimeout(() => setUploadStatus(null), 3000)
    } catch (err) {
      setUploadStatus(`Error: ${(err as Error).message}`)
      setTimeout(() => setUploadStatus(null), 5000)
    } finally {
      setUploading(false)
      setUploadProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [projectId, refreshDir])

  useEffect(() => {
    if (expanded && !tree.has('')) {
      void loadDir('')
    }
  }, [expanded, loadDir, tree])

  async function toggleDir(path: string) {
    if (openDirs.has(path)) {
      setOpenDirs((prev) => { const s = new Set(prev); s.delete(path); return s })
    } else {
      currentDirRef.current = path
      setOpenDirs((prev) => new Set(prev).add(path))
      await loadDir(path)
    }
  }

  async function openFile(path: string) {
    if (isImage(path)) {
      setViewer({ path, content: '', lastModified: 0, type: 'image' })
      return
    }
    try {
      const { content, lastModified } = await getFileContent(projectId, path)
      setViewer({ path, content, lastModified, type: 'text' })
    } catch (err) {
      alert((err as Error).message)
    }
  }

  function renderEntries(entries: FileEntry[], depth: number) {
    return entries.map((entry) => (
      <div key={entry.path} style={{ paddingLeft: depth * 12 }}>
        {entry.type === 'directory' ? (
          <>
            <button
              className="flex items-center gap-1 w-full bg-transparent border-none text-app-blue-link hover:text-app-blue-link-hover font-medium text-xs px-1.5 py-1.5 cursor-pointer text-left rounded hover:bg-app-bg-card transition-colors min-h-[36px]"
              onClick={() => void toggleDir(entry.path)}
            >
              <span>{openDirs.has(entry.path) ? '▾' : '▸'}</span>
              <span>{entry.name}/</span>
            </button>
            {openDirs.has(entry.path) && tree.has(entry.path) &&
              renderEntries(tree.get(entry.path)!, depth + 1)
            }
          </>
        ) : (
          <button
            className="flex items-center gap-1 w-full bg-transparent border-none text-app-text-4 hover:text-app-text-2 text-xs px-1.5 py-1.5 cursor-pointer text-left rounded hover:bg-app-bg-card transition-colors font-[inherit] min-h-[36px]"
            onClick={() => void openFile(entry.path)}
          >
            <span className="text-app-text-7 flex-shrink-0">·</span>
            <span className="truncate">{entry.name}</span>
          </button>
        )}
      </div>
    ))
  }

  const closeViewer = useCallback(() => setViewer(null), [])

  // Drag-and-drop handlers for the tree container
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) void handleUpload(e.dataTransfer.files)
  }, [handleUpload])

  const uploadBar = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) void handleUpload(e.target.files) }}
      />
      {/* Upload status / progress */}
      {(uploading || uploadStatus) && (
        <div className="px-3 py-1.5 text-[11px]">
          {uploading && uploadProgress ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-app-bg-card rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-200"
                  style={{ width: `${Math.round((uploadProgress.loaded / uploadProgress.total) * 100)}%` }}
                />
              </div>
              <span className="text-app-text-6 flex-shrink-0">{Math.round((uploadProgress.loaded / uploadProgress.total) * 100)}%</span>
            </div>
          ) : uploading ? (
            <span className="text-app-text-6">Uploading…</span>
          ) : uploadStatus ? (
            <span className={uploadStatus.startsWith('Error') ? 'text-red-400' : 'text-green-400'}>{uploadStatus}</span>
          ) : null}
        </div>
      )}
    </>
  )

  return (
    <>
      {alwaysExpanded ? (
        <div
          className={`flex-1 flex flex-col overflow-y-auto min-h-0 ${dragOver ? 'ring-1 ring-inset ring-blue-500/40 bg-blue-500/5' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0">
            <span className="text-[11px] text-app-text-7 font-semibold tracking-widest uppercase">
              {currentDirRef.current || 'Root'}
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-[11px] text-app-text-6 hover:text-app-text-4 bg-transparent border-none cursor-pointer px-1.5 py-0.5 rounded hover:bg-app-bg-card transition-colors disabled:opacity-50"
              title="Upload files"
            >
              ↑ Upload
            </button>
          </div>
          {uploadBar}
          <div className="flex-1 overflow-y-auto px-1.5 py-1.5 min-h-0">
            {loading && !tree.has('') && (
              <p className="text-xs text-app-text-7 px-2.5 py-1.5">Loading…</p>
            )}
            {tree.has('') && tree.get('')!.length === 0 && (
              <p className="text-xs text-app-text-7 px-2.5 py-1.5 italic">Empty directory</p>
            )}
            {tree.has('') && renderEntries(tree.get('')!, 0)}
          </div>
          {dragOver && (
            <div className="px-3 py-2 text-center text-[11px] text-blue-400 flex-shrink-0">
              Drop files to upload
            </div>
          )}
        </div>
      ) : (
        <div
          className={`border-t border-app-border flex-shrink-0 ${dragOver && expanded ? 'ring-1 ring-inset ring-blue-500/40 bg-blue-500/5' : ''}`}
          onDragOver={expanded ? handleDragOver : undefined}
          onDragLeave={expanded ? handleDragLeave : undefined}
          onDrop={expanded ? handleDrop : undefined}
        >
          <div className="flex items-center">
            <button
              className="flex-1 flex items-center gap-1.5 px-3 py-2 bg-transparent border-none text-app-text-6 hover:text-app-text-4 text-[11px] font-semibold tracking-widest uppercase cursor-pointer text-left transition-colors"
              onClick={() => setExpanded((e) => !e)}
            >
              <span>{expanded ? '▾' : '▸'}</span>
              <span>Files</span>
              {loading && <span className="text-app-text-7 text-[11px]">…</span>}
            </button>
            {expanded && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-[11px] text-app-text-6 hover:text-app-text-4 bg-transparent border-none cursor-pointer px-2 py-1.5 mr-1 rounded hover:bg-app-bg-card transition-colors disabled:opacity-50"
                title="Upload files"
              >
                ↑
              </button>
            )}
          </div>
          {uploadBar}
          {expanded && (
            <div className="max-h-[200px] overflow-y-auto px-1.5 pb-1.5">
              {tree.has('') && tree.get('')!.length === 0 && (
                <p className="text-xs text-app-text-7 px-2.5 py-1.5 italic">Empty directory</p>
              )}
              {tree.has('') && renderEntries(tree.get('')!, 0)}
            </div>
          )}
        </div>
      )}

      {viewer && createPortal(
        <FileViewer viewer={viewer} projectId={projectId} onClose={closeViewer} />,
        document.body
      )}
    </>
  )
}
