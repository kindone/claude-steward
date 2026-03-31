import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type LightboxContent =
  | { type: 'img'; src: string; alt: string }
  | { type: 'svg'; markup: string }

type Props = {
  content: LightboxContent
  onClose: () => void
}

export function ImageLightbox({ content, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Use refs for scale/offset so the wheel handler never needs to be re-attached.
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef({ mx: 0, my: 0, ox: 0, oy: 0 })

  // Separate display state that drives re-renders — written from both wheel and drag.
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })

  // Reset state whenever content changes (new image/SVG opened).
  useEffect(() => {
    scaleRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    setTransform({ scale: 1, x: 0, y: 0 })
    setIsDragging(false)
  }, [content])

  // Escape key to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Wheel-to-zoom — must be non-passive so preventDefault() works.
  // Reads scale/offset from refs to avoid re-attaching on every state change.
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newScale = Math.min(20, Math.max(0.1, scaleRef.current * factor))

      // Anchor zoom to cursor position so the point under the cursor stays fixed.
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      const newX = cx - (cx - offsetRef.current.x) * (newScale / scaleRef.current)
      const newY = cy - (cy - offsetRef.current.y) * (newScale / scaleRef.current)

      scaleRef.current = newScale
      offsetRef.current = { x: newX, y: newY }
      setTransform({ scale: newScale, x: newX, y: newY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // stable: handler reads from refs, never needs re-attachment

  function handleMouseDown(e: React.MouseEvent) {
    e.stopPropagation()
    setIsDragging(true)
    dragStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return
    const dx = e.clientX - dragStartRef.current.mx
    const dy = e.clientY - dragStartRef.current.my
    const newX = dragStartRef.current.ox + dx
    const newY = dragStartRef.current.oy + dy
    offsetRef.current = { x: newX, y: newY }
    setTransform(t => ({ ...t, x: newX, y: newY }))
  }

  function endDrag() {
    setIsDragging(false)
  }

  function resetView(e: React.MouseEvent) {
    e.stopPropagation()
    scaleRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    setTransform({ scale: 1, x: 0, y: 0 })
  }

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/88 z-[300] flex items-center justify-center"
      onClick={onClose}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center
                   bg-[#1a1a1a] border border-[#333] rounded-full text-[#888]
                   hover:text-white hover:border-[#666] cursor-pointer text-lg leading-none
                   transition-colors"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        aria-label="Close lightbox"
      >
        ✕
      </button>

      {/* Reset zoom button */}
      <button
        className="absolute top-4 right-16 z-10 h-9 px-3 flex items-center
                   bg-[#1a1a1a] border border-[#333] rounded-full text-[#666]
                   hover:text-[#aaa] cursor-pointer text-xs transition-colors"
        onClick={resetView}
        title="Reset zoom"
      >
        1:1
      </button>

      {/* Content — transform via CSS, drag handled here */}
      <div
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          maxWidth: '90vw',
          maxHeight: '85vh',
        }}
        onMouseDown={handleMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        {content.type === 'img' ? (
          <img
            src={content.src}
            alt={content.alt}
            style={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block', objectFit: 'contain' }}
            draggable={false}
          />
        ) : (
          <div
            style={{ maxWidth: '90vw', maxHeight: '85vh' }}
            dangerouslySetInnerHTML={{ __html: content.markup }}
          />
        )}
      </div>

      {/* Hint text */}
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-[#555] select-none pointer-events-none whitespace-nowrap">
        scroll to zoom · drag to pan · click outside to close
      </p>
    </div>,
    document.body
  )
}
