/**
 * Interactive MdArt `tab-list`: SVG is static from the renderer; this module
 * toggles visibility and tab chrome when the user clicks a tab hit-area.
 */

const TAB_HIT = '.mdart-tab-hit'
const TAB_PANEL = '.mdart-tab-panel'
const TAB_ROOT = '.mdart-tab-root'

export function activateMdArtTab(root: Element, activeIdx: number): void {
  const textMuted = root.getAttribute('data-text-muted') ?? '#888888'
  const hits = root.querySelectorAll<SVGGElement>(TAB_HIT)
  const panels = root.querySelectorAll<SVGGElement>(TAB_PANEL)

  hits.forEach((hit, k) => {
    const color = hit.getAttribute('data-color') ?? '#666666'
    const rect = hit.querySelector<SVGRectElement>('.mdart-tab-rect')
    const label = hit.querySelector<SVGTextElement>('.mdart-tab-label')
    const on = k === activeIdx
    if (rect) {
      if (on) {
        rect.setAttribute('fill', color)
        rect.removeAttribute('stroke')
        rect.removeAttribute('stroke-width')
      } else {
        rect.setAttribute('fill', `${color}22`)
        rect.setAttribute('stroke', `${color}55`)
        rect.setAttribute('stroke-width', '1')
      }
    }
    if (label) {
      label.setAttribute('fill', on ? '#ffffff' : textMuted)
      label.setAttribute('font-weight', on ? '700' : '400')
    }
  })

  panels.forEach((panel) => {
    const t = parseInt(panel.getAttribute('data-tab') ?? '-1', 10)
    panel.setAttribute('visibility', t === activeIdx ? 'visible' : 'hidden')
  })

  const contentBg = root.querySelector<SVGRectElement>('.mdart-tab-content-bg')
  const activeColor = hits[activeIdx]?.getAttribute('data-color')
  if (contentBg && activeColor) {
    contentBg.setAttribute('fill', `${activeColor}11`)
    contentBg.setAttribute('stroke', `${activeColor}44`)
    contentBg.setAttribute('stroke-width', '1.2')
  }
}

/** If target is a MdArt tab (or inside one), activate it and return true. */
export function tryActivateMdArtTabFromEventTarget(target: EventTarget | null): boolean {
  const el =
    target instanceof Element ? target : target instanceof Text ? target.parentElement : null
  if (!el) return false
  const hit = el.closest(TAB_HIT)
  if (!hit) return false
  const root = hit.closest(TAB_ROOT)
  if (!root) return false
  const hits = [...root.querySelectorAll(TAB_HIT)]
  const idx = hits.indexOf(hit)
  if (idx < 0) return false
  activateMdArtTab(root, idx)
  return true
}
