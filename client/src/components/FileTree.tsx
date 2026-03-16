import { useState, useEffect, useCallback } from 'react'
import { listFiles, getFileContent, type FileEntry } from '../lib/api'
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

// ── FileViewer modal ─────────────────────────────────────────────────────────

type ViewerState = { path: string; content: string; type: 'text' | 'image' } | null

function FileViewer({
  viewer,
  projectId,
  onClose,
}: {
  viewer: NonNullable<ViewerState>
  projectId: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleCopy() {
    navigator.clipboard.writeText(viewer.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {/* ignore */})
  }

  const lang = getLang(viewer.path)
  const filename = viewer.path.split('/').pop() ?? viewer.path
  const rawSrc = `/api/projects/${projectId}/files/raw?path=${encodeURIComponent(viewer.path)}`

  // ── Content area ────────────────────────────────────────────────────────
  let body: React.ReactNode

  if (viewer.type === 'image') {
    body = (
      <div className="flex-1 overflow-auto flex items-center justify-center p-6 bg-[#0d0d0d] min-h-0">
        <img
          src={rawSrc}
          alt={filename}
          className="max-w-full max-h-full object-contain rounded"
        />
      </div>
    )
  } else if (isMarkdown(viewer.path)) {
    const html = marked.parse(viewer.content) as string
    body = (
      <div
        className="flex-1 overflow-auto p-6 prose text-sm leading-relaxed min-h-0"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  } else {
    // Code / plain text
    let highlighted: string
    if (lang) {
      try {
        highlighted = hljs.highlight(viewer.content, { language: lang, ignoreIllegals: true }).value
      } catch {
        highlighted = escapeHtml(viewer.content)
      }
    } else {
      try {
        const result = hljs.highlightAuto(viewer.content)
        highlighted = result.value
      } catch {
        highlighted = escapeHtml(viewer.content)
      }
    }

    const lineCount = viewer.content.split('\n').length

    body = (
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Gutter */}
        <div
          className="select-none text-right text-[#3a3a3a] font-mono text-[13px] leading-relaxed flex-shrink-0 px-3 py-5 border-r border-[#1f1f1f] bg-[#0d0d0d] overflow-hidden"
          aria-hidden="true"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        {/* Code */}
        <pre className="flex-1 overflow-auto p-5 m-0 bg-transparent text-[13px] leading-relaxed font-['SF_Mono','Fira_Code',monospace]">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="bg-[#131313] border border-[#2a2a2a] rounded-xl flex flex-col overflow-hidden shadow-2xl"
        style={{ width: 'min(92vw, 1200px)', height: 'min(88dvh, 900px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f1f1f] gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {lang && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#555] uppercase tracking-wider font-semibold">
                {lang}
              </span>
            )}
            {isImage(viewer.path) && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#555] uppercase tracking-wider font-semibold">
                {fileExt(viewer.path)}
              </span>
            )}
            {isMarkdown(viewer.path) && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#555] uppercase tracking-wider font-semibold">
                md
              </span>
            )}
            <span className="text-[13px] text-[#888] font-mono truncate" title={viewer.path}>
              {viewer.path}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {viewer.type !== 'image' && (
              <button
                onClick={handleCopy}
                className="text-xs text-[#666] hover:text-[#ccc] hover:bg-[#222] px-2.5 py-1.5 rounded transition-colors cursor-pointer border-none bg-transparent"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            )}
            <button
              className="bg-transparent border-none text-[#666] hover:text-[#ccc] hover:bg-[#222] text-xl cursor-pointer leading-none px-2 py-1 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        {body}
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

  const loadDir = useCallback(async (dirPath: string) => {
    if (tree.has(dirPath)) return
    setLoading(true)
    try {
      const entries = await listFiles(projectId, dirPath)
      setTree((prev) => new Map(prev).set(dirPath, entries))
    } catch (err) {
      console.error('[FileTree] load error', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, tree])

  useEffect(() => {
    if (expanded && !tree.has('')) {
      void loadDir('')
    }
  }, [expanded, loadDir, tree])

  async function toggleDir(path: string) {
    if (openDirs.has(path)) {
      setOpenDirs((prev) => { const s = new Set(prev); s.delete(path); return s })
    } else {
      setOpenDirs((prev) => new Set(prev).add(path))
      await loadDir(path)
    }
  }

  async function openFile(path: string) {
    if (isImage(path)) {
      setViewer({ path, content: '', type: 'image' })
      return
    }
    try {
      const content = await getFileContent(projectId, path)
      setViewer({ path, content, type: 'text' })
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
              className="flex items-center gap-1 w-full bg-transparent border-none text-[#7aa2d4] hover:text-[#93bbf0] font-medium text-xs px-1.5 py-1.5 cursor-pointer text-left rounded hover:bg-[#1a1a1a] transition-colors min-h-[36px]"
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
            className="flex items-center gap-1 w-full bg-transparent border-none text-[#888] hover:text-[#ccc] text-xs px-1.5 py-1.5 cursor-pointer text-left rounded hover:bg-[#1a1a1a] transition-colors font-[inherit] min-h-[36px]"
            onClick={() => void openFile(entry.path)}
          >
            <span className="text-[#444] flex-shrink-0">·</span>
            <span className="truncate">{entry.name}</span>
          </button>
        )}
      </div>
    ))
  }

  const closeViewer = useCallback(() => setViewer(null), [])

  return (
    <>
      {alwaysExpanded ? (
        /* Full-height mode used when embedded in the Files tab */
        <div className="flex-1 overflow-y-auto px-1.5 py-1.5 min-h-0">
          {loading && !tree.has('') && (
            <p className="text-xs text-[#444] px-2.5 py-1.5">Loading…</p>
          )}
          {tree.has('') && tree.get('')!.length === 0 && (
            <p className="text-xs text-[#444] px-2.5 py-1.5 italic">Empty directory</p>
          )}
          {tree.has('') && renderEntries(tree.get('')!, 0)}
        </div>
      ) : (
        /* Collapsed-by-default mode used at the bottom of the Sessions tab */
        <div className="border-t border-[#1f1f1f] flex-shrink-0">
          <button
            className="w-full flex items-center gap-1.5 px-3 py-2 bg-transparent border-none text-[#555] hover:text-[#888] text-[11px] font-semibold tracking-widest uppercase cursor-pointer text-left transition-colors"
            onClick={() => setExpanded((e) => !e)}
          >
            <span>{expanded ? '▾' : '▸'}</span>
            <span>Files</span>
            {loading && <span className="text-[#444] text-[11px]">…</span>}
          </button>
          {expanded && (
            <div className="max-h-[200px] overflow-y-auto px-1.5 pb-1.5">
              {tree.has('') && tree.get('')!.length === 0 && (
                <p className="text-xs text-[#444] px-2.5 py-1.5 italic">Empty directory</p>
              )}
              {tree.has('') && renderEntries(tree.get('')!, 0)}
            </div>
          )}
        </div>
      )}

      {viewer && (
        <FileViewer viewer={viewer} projectId={projectId} onClose={closeViewer} />
      )}
    </>
  )
}
