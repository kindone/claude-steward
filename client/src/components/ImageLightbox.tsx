import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type LightboxContent =
  | { type: 'img'; src: string; alt: string }
  | { type: 'svg'; markup: string }
  | { type: 'gallery'; images: Array<{ src: string; alt: string }>; startIndex: number }

type Props = {
  content: LightboxContent
  onClose: () => void
}

export function ImageLightbox({ content, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Gallery state — only used when content.type === 'gallery'
  const [galleryIdx, setGalleryIdx] = useState(
    content.type === 'gallery' ? content.startIndex : 0
  )

  const isGallery = content.type === 'gallery'
  const galleryImages = isGallery ? content.images : null
  const totalImages = galleryImages?.length ?? 0

  // Derived src/alt for the currently displayed image
  const currentSrc = isGallery
    ? (galleryImages![galleryIdx]?.src ?? '')
    : content.type === 'img' ? content.src : ''
  const currentAlt = isGallery
    ? (galleryImages![galleryIdx]?.alt ?? '')
    : content.type === 'img' ? content.alt : ''

  // Use refs for scale/offset so the wheel handler never needs to be re-attached.
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef({ mx: 0, my: 0, ox: 0, oy: 0 })

  // Separate display state that drives re-renders — written from both wheel and drag.
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })

  const resetView = useCallback(() => {
    scaleRef.current = 1
    offsetRef.current = { x: 0, y: 0 }
    setTransform({ scale: 1, x: 0, y: 0 })
  }, [])

  // Reset state whenever content changes (new image/SVG opened).
  useEffect(() => {
    resetView()
    setIsDragging(false)
    if (content.type === 'gallery') setGalleryIdx(content.startIndex)
  }, [content, resetView])

  // Reset view when navigating within a gallery
  useEffect(() => {
    resetView()
    setIsDragging(false)
  }, [galleryIdx, resetView])

  // Navigate to previous/next image in gallery
  const goTo = useCallback((idx: number) => {
    setGalleryIdx(idx)
  }, [])

  // Escape key to close; arrow keys for gallery navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (!isGallery) return
      if (e.key === 'ArrowLeft')  { setGalleryIdx(i => Math.max(0, i - 1)); e.preventDefault() }
      if (e.key === 'ArrowRight') { setGalleryIdx(i => Math.min(totalImages - 1, i + 1)); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, isGallery, totalImages])

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

  function handleResetView(e: React.MouseEvent) {
    e.stopPropagation()
    resetView()
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
                   bg-app-bg-card/50 border border-app-border-3/50 rounded-full text-app-text-4
                   hover:bg-app-bg-card/80 hover:text-white hover:border-app-text-5/80
                   cursor-pointer text-lg leading-none transition-all"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        aria-label="Close lightbox"
      >
        ✕
      </button>

      {/* Reset zoom button */}
      <button
        className="absolute top-4 right-16 z-10 h-9 px-3 flex items-center
                   bg-app-bg-card/50 border border-app-border-3/50 rounded-full text-app-text-5
                   hover:bg-app-bg-card/80 hover:text-app-text-3 cursor-pointer text-xs transition-all"
        onClick={handleResetView}
        title="Reset zoom"
      >
        1:1
      </button>

      {/* Gallery prev/next navigation */}
      {isGallery && galleryIdx > 0 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center
                     bg-app-bg-card/50 border border-app-border-3/50 rounded-full text-app-text-4
                     hover:bg-app-bg-card/80 hover:text-white hover:border-app-text-5/80
                     cursor-pointer text-lg transition-all"
          onClick={(e) => { e.stopPropagation(); goTo(galleryIdx - 1) }}
          aria-label="Previous image"
        >
          ‹
        </button>
      )}
      {isGallery && galleryIdx < totalImages - 1 && (
        <button
          className="absolute right-16 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center
                     bg-app-bg-card/50 border border-app-border-3/50 rounded-full text-app-text-4
                     hover:bg-app-bg-card/80 hover:text-white hover:border-app-text-5/80
                     cursor-pointer text-lg transition-all"
          onClick={(e) => { e.stopPropagation(); goTo(galleryIdx + 1) }}
          aria-label="Next image"
        >
          ›
        </button>
      )}

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
        {content.type === 'svg' ? (
          <div
            style={{ maxWidth: '90vw', maxHeight: '85vh' }}
            dangerouslySetInnerHTML={{ __html: content.markup }}
          />
        ) : (
          <img
            key={currentSrc}
            src={currentSrc}
            alt={currentAlt}
            style={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block', objectFit: 'contain' }}
            draggable={false}
          />
        )}
      </div>

      {/* Bottom hint / gallery counter */}
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-app-text-6 select-none pointer-events-none whitespace-nowrap">
        {isGallery
          ? `${galleryIdx + 1} / ${totalImages}  ·  scroll to zoom · drag to pan · ← → to navigate`
          : 'scroll to zoom · drag to pan · click outside to close'}
      </p>

      {/* Thumbnail strip for galleries */}
      {isGallery && galleryImages && galleryImages.length > 1 && (
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-1.5 items-center"
          onClick={(e) => e.stopPropagation()}
        >
          {galleryImages.map((img, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); goTo(i) }}
              className={`w-10 h-10 rounded overflow-hidden border-2 transition-all cursor-pointer p-0
                ${i === galleryIdx ? 'border-blue-500 opacity-100' : 'border-app-border-3 opacity-50 hover:opacity-80'}`}
              aria-label={`Go to image ${i + 1}`}
            >
              <img
                src={img.src}
                alt={img.alt}
                className="w-full h-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
