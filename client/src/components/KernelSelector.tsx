import { useEffect, useRef, useState } from 'react'
import { type KernelInfo, killKernel, listKernels, resetKernel } from '../lib/kernelApi'

interface Props {
  projectId: string
  /** Increment to trigger a refresh of kernel list */
  refreshTick?: number
}

export function KernelSelector({ projectId, refreshTick = 0 }: Props) {
  const [kernels, setKernels] = useState<KernelInfo[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = () => {
    listKernels(projectId).then(setKernels).catch(() => setKernels([]))
  }

  useEffect(() => { load() }, [projectId, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const alive = kernels.filter(k => k.alive)

  async function handleKill(k: KernelInfo) {
    try {
      await killKernel(k.projectId, k.name, k.language)
      load()
    } catch { /* ignore */ }
  }

  async function handleReset(k: KernelInfo) {
    try {
      await resetKernel(k.projectId, k.name, k.language)
      load()
    } catch { /* ignore */ }
  }

  function formatAge(ms: number): string {
    const s = Math.floor((Date.now() - ms) / 1000)
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    return `${Math.floor(s / 3600)}h ago`
  }

  const langColor: Record<string, string> = {
    python: 'text-blue-400',
    node: 'text-green-400',
    bash: 'text-yellow-400',
    cpp: 'text-orange-400',
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#666] hover:text-[#aaa] hover:bg-[#1a1a1a] transition-colors cursor-pointer"
        title="Kernels"
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${alive.length > 0 ? 'bg-green-500' : 'bg-[#444]'}`} />
        <span className="hidden sm:inline">{alive.length > 0 ? `${alive.length} kernel${alive.length !== 1 ? 's' : ''}` : 'kernels'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[#151515] border border-[#2a2a2a] rounded-lg shadow-lg min-w-[220px] py-1 text-xs">
          {kernels.length === 0 && (
            <div className="px-3 py-2 text-[#555]">No active kernels</div>
          )}
          {kernels.map((k) => (
            <div key={`${k.name}:${k.language}`} className="flex items-center gap-2 px-3 py-2 hover:bg-[#1e1e1e]">
              <span className={`font-mono ${langColor[k.language] ?? 'text-[#aaa]'}`}>{k.language}</span>
              <span className="text-[#888] truncate flex-1">{k.name}</span>
              <span className="text-[#444] shrink-0">{formatAge(k.lastUsedAt)}</span>
              <button
                onClick={() => handleReset(k)}
                className="text-[#555] hover:text-yellow-400 transition-colors cursor-pointer"
                title="Reset kernel state"
              >↺</button>
              <button
                onClick={() => handleKill(k)}
                className="text-[#555] hover:text-red-400 transition-colors cursor-pointer"
                title="Kill kernel"
              >✕</button>
            </div>
          ))}
          <div className="px-3 py-1.5 border-t border-[#1e1e1e] text-[#444] text-[10px]">
            Kernels idle 30 min are auto-killed
          </div>
        </div>
      )}
    </div>
  )
}
