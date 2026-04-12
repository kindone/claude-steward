/**
 * LinkPreviewCard — floating preview shown on link hover/tap inside ReportView.
 *
 * Dismissal is always animated:
 *   - Auto-dismiss: 4 s after mount, starts an 800 ms fade then calls onDismiss
 *   - Hover/touch-away: immediate fade (fadeNow) — same 800 ms fade, no 4 s wait
 *
 * The parent triggers fadeNow() via a forwarded ref when the cursor leaves the
 * link element (onMouseOut), keeping desktop and mobile behaviour consistent.
 *
 * Positioning:
 *   - Receives a DOMRect snapshot captured synchronously inside the event handler
 *     before React batches any state updates or iOS shifts the viewport.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listArtifacts, getArtifactContent } from '../lib/api'
import type { ArtifactType } from '../lib/api'

interface PreviewState {
  loading: boolean
  title?: string
  excerpt?: string
  kind?: 'artifact' | 'external'
  artifactType?: ArtifactType
  error?: boolean
}

interface Props {
  href: string
  /** Inline title from [text](url "title") — shown without fetching. */
  title?: string
  /** DOMRect captured synchronously during the triggering event. */
  anchorRect: DOMRect
  projectId: string
  onMouseEnter?: () => void
  onDismiss: () => void
}

export interface LinkPreviewCardHandle {
  /** Immediately start the fade-out animation then call onDismiss. */
  fadeNow(): void
  /** Start (or restart) the auto-dismiss countdown — called when cursor leaves the link. */
  startTimer(): void
  /** Pause auto-dismiss — called while cursor is confirmed over the triggering link. */
  cancelTimer(): void
}

const CARD_W         = 288
const CARD_GAP       = 10
// Touch devices (mobile) get longer to read before auto-dismiss.
const AUTO_DISMISS_MS = window.matchMedia('(hover: none)').matches ? 4000 : 1500
const FADE_MS         = 800

const TYPE_LABEL: Record<ArtifactType, string> = {
  chart:  'Chart',
  report: 'Report',
  data:   'Data',
  code:   'Code',
  pikchr: 'Pikchr',
  html:   'HTML',
  mdart:  'Diagram',
}

export const LinkPreviewCard = forwardRef<LinkPreviewCardHandle, Props>(function LinkPreviewCard(
  { href, title: inlineTitle, anchorRect, projectId, onMouseEnter, onDismiss },
  ref
) {
  const [state, setState]   = useState<PreviewState>({ loading: true })
  const [fading, setFading] = useState(false)
  const timerRef            = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeRef             = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Fade immediately then call onDismiss after FADE_MS. */
  function fadeNow() {
    clearTimeout(timerRef.current!)
    clearTimeout(fadeRef.current!)
    setFading(true)
    fadeRef.current = setTimeout(onDismiss, FADE_MS)
  }

  /** Cancel any in-progress fade/auto-timer and reset to visible. */
  function cancelDismissTimer() {
    clearTimeout(timerRef.current!)
    clearTimeout(fadeRef.current!)
    setFading(false)
  }

  /** Start the 4 s auto-dismiss countdown (used on mount and on hover-re-enter). */
  function startAutoTimer() {
    clearTimeout(timerRef.current!)
    clearTimeout(fadeRef.current!)
    setFading(false)
    timerRef.current = setTimeout(() => {
      setFading(true)
      fadeRef.current = setTimeout(onDismiss, FADE_MS)
    }, AUTO_DISMISS_MS - FADE_MS)
  }

  useImperativeHandle(ref, () => ({ fadeNow, startTimer: startAutoTimer, cancelTimer: cancelDismissTimer }))

  // Always start the auto-dismiss timer on mount as a safety net — covers
  // touch devices (no mouseout) and edge cases where startTimer() is never
  // called (e.g. card appears under a stationary cursor, or link→card
  // transition clears the parent's hoverTimer before startTimer fires).
  // The parent calls cancelTimer() via onMouseOver while the cursor stays
  // on the link, and startTimer() via onMouseOut to restart the countdown.
  useEffect(() => {
    startAutoTimer()
    return () => {
      clearTimeout(timerRef.current!)
      clearTimeout(fadeRef.current!)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Position from snapshot ────────────────────────────────────────────────
  const vw          = window.innerWidth
  const aboveAnchor = anchorRect.top >= CARD_GAP + 40
  const top         = aboveAnchor ? anchorRect.top - CARD_GAP : anchorRect.bottom + CARD_GAP
  const left        = Math.min(Math.max(CARD_GAP, anchorRect.left), vw - CARD_W - CARD_GAP)
  const translateY  = aboveAnchor ? '-100%' : '0'

  // ── Fetch preview content ─────────────────────────────────────────────────
  useEffect(() => {
    if (inlineTitle) {
      setState({
        loading: false,
        title: inlineTitle,
        kind: href.startsWith('artifact:') ? 'artifact' : 'external',
      })
      return
    }

    setState({ loading: true })
    let cancelled = false

    async function load() {
      try {
        if (href.startsWith('artifact:')) {
          const nameOrId = decodeURIComponent(href.slice('artifact:'.length).trim())
          const artifacts = await listArtifacts(projectId)
          const artifact = artifacts.find(
            a => a.id === nameOrId || a.name.toLowerCase() === nameOrId.toLowerCase()
          )
          if (!artifact) {
            if (!cancelled) setState({ loading: false, title: nameOrId, error: true })
            return
          }
          const content = await getArtifactContent(artifact.id)
          if (!cancelled) setState({
            loading: false,
            title: artifact.name,
            excerpt: extractExcerpt(content, artifact.type),
            kind: 'artifact',
            artifactType: artifact.type,
          })

        } else if (/^https?:\/\//i.test(href)) {
          const res = await fetch(`/api/link-preview?url=${encodeURIComponent(href)}`, {
            credentials: 'include',
          })
          if (!res.ok) throw new Error('preview failed')
          const data = await res.json() as { title?: string; description?: string }
          if (!cancelled) setState({
            loading: false,
            title: data.title ?? extractDomain(href),
            excerpt: data.description ?? undefined,
            kind: 'external',
          })

        } else {
          if (!cancelled) setState({ loading: false, error: true })
        }
      } catch {
        if (!cancelled) setState({ loading: false, title: extractDomain(href) || href, error: true })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [href, inlineTitle, projectId])

  return createPortal(
    <div
      className="link-preview-card"
      style={{
        top, left, width: CARD_W,
        transform: `translateY(${translateY})`,
        opacity: fading ? 0 : 1,
        transition: fading ? `opacity ${FADE_MS}ms ease` : 'opacity 0.15s ease',
      }}
      onMouseEnter={() => { cancelDismissTimer(); startAutoTimer(); onMouseEnter?.() }}
      onMouseLeave={() => fadeNow()}
    >
      {state.loading ? (
        <div className="link-preview-loading">
          <span className="link-preview-spinner" />
          <span>Loading…</span>
        </div>
      ) : state.error && !state.title ? (
        <div className="link-preview-error">Preview unavailable</div>
      ) : (
        <>
          <div className="link-preview-header">
            {state.kind === 'artifact' && state.artifactType && (
              <span className="link-preview-badge">{TYPE_LABEL[state.artifactType]}</span>
            )}
            {state.kind === 'external' && (
              <span className="link-preview-domain">{extractDomain(href)}</span>
            )}
            <span className="link-preview-title">{state.title}</span>
          </div>
          {state.excerpt && (
            <div className="link-preview-excerpt">{state.excerpt}</div>
          )}
          {state.error && (
            <div className="link-preview-not-found">Artifact not found</div>
          )}
          {state.kind === 'external' && (
            <a
              className="link-preview-open"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open ↗
            </a>
          )}
        </>
      )}
    </div>,
    document.body
  )
})

function extractExcerpt(content: string, type: ArtifactType): string {
  const text = content.trim()
  if (type === 'report') {
    const line = text.split('\n').find(
      l => l.trim() && !l.startsWith('#') && !l.startsWith('```') && l.trim().length > 20
    )
    return (line ?? text).trim().slice(0, 220)
  }
  if (type === 'code' || type === 'html') return text.slice(0, 120)
  return text.slice(0, 220)
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}
