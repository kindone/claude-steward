import type { SmartArtSpec } from '../parser'
import type { SmartArtTheme } from '../theme'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderRelationship(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'concentric': return renderConcentric(spec, theme)
    case 'venn-3':     return renderVenn3(spec, theme)
    default:           return renderVenn2(spec, theme)
  }
}

// ── 2-circle Venn ─────────────────────────────────────────────────────────────

function renderVenn2(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const all = spec.items
  const circles      = all.filter(i => !i.isIntersection)
  const intersects   = all.filter(i => i.isIntersection)

  const W = 560
  const TITLE_H = spec.title ? 28 : 8
  const H = 320 + TITLE_H
  const R = 115
  const overlap = 72
  const cy = TITLE_H + (H - TITLE_H) / 2

  const cx1 = W / 2 - R + overlap / 2
  const cx2 = W / 2 + R - overlap / 2

  const c1 = circles[0]
  const c2 = circles[1]

  const parts: string[] = []

  // Circles — render with opacity so overlap is visible
  parts.push(
    `<circle cx="${cx1.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${theme.primary}28" stroke="${theme.primary}88" stroke-width="1.5"/>`,
    `<circle cx="${cx2.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${theme.secondary}28" stroke="${theme.secondary}88" stroke-width="1.5"/>`,
  )

  // Circle labels
  if (c1) {
    parts.push(
      `<text x="${(cx1 - R / 3.5).toFixed(1)}" y="${(cy - 10).toFixed(1)}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(c1.label, 14))}</text>`,
    )
    // Child items
    c1.children.slice(0, 4).forEach((ch, idx) => {
      parts.push(`<text x="${(cx1 - R / 3.5).toFixed(1)}" y="${(cy + 12 + idx * 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 13))}</text>`)
    })
  }

  if (c2) {
    parts.push(
      `<text x="${(cx2 + R / 3.5).toFixed(1)}" y="${(cy - 10).toFixed(1)}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(c2.label, 14))}</text>`,
    )
    c2.children.slice(0, 4).forEach((ch, idx) => {
      parts.push(`<text x="${(cx2 + R / 3.5).toFixed(1)}" y="${(cy + 12 + idx * 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 13))}</text>`)
    })
  }

  // Intersection label(s) in overlap zone
  const ixLabel = intersects[0]?.label ?? ''
  if (ixLabel) {
    parts.push(
      `<text x="${(W / 2).toFixed(1)}" y="${(cy - 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="500">${escapeXml(truncate(ixLabel, 12))}</text>`,
    )
    intersects[0].children.slice(0, 3).forEach((ch, idx) => {
      parts.push(`<text x="${(W / 2).toFixed(1)}" y="${(cy + 14 + idx * 15).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.accent}" font-family="system-ui,sans-serif" opacity="0.8">${escapeXml(truncate(ch.label, 10))}</text>`)
    })
  }

  return svg(W, H, theme, spec.title, parts)
}

// ── 3-circle Venn ─────────────────────────────────────────────────────────────

function renderVenn3(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const all = spec.items
  const circles    = all.filter(i => !i.isIntersection)
  const intersects = all.filter(i => i.isIntersection)

  const W = 560
  const TITLE_H = spec.title ? 28 : 8
  const H = 380 + TITLE_H
  const R = 105
  const offset = 62
  const cy = TITLE_H + (H - TITLE_H) / 2

  const c1x = W / 2 - offset,       c1y = cy - offset * 0.65
  const c2x = W / 2 + offset,       c2y = cy - offset * 0.65
  const c3x = W / 2,                c3y = cy + offset * 0.9

  const colors = [theme.primary, theme.secondary, theme.accent]
  const cx = [c1x, c2x, c3x]
  const cy3 = [c1y, c2y, c3y]
  const labelOff: [number, number][] = [[-50, -R * 0.55], [50, -R * 0.55], [0, R * 0.6]]

  const parts: string[] = []

  // Circles
  for (let i = 0; i < 3; i++) {
    parts.push(`<circle cx="${cx[i].toFixed(1)}" cy="${cy3[i].toFixed(1)}" r="${R}" fill="${colors[i]}22" stroke="${colors[i]}77" stroke-width="1.5"/>`)
  }

  // Labels outside overlap zone
  circles.slice(0, 3).forEach((c, i) => {
    const lx = cx[i] + labelOff[i][0]
    const ly = cy3[i] + labelOff[i][1]
    parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(c.label, 13))}</text>`)
    c.children.slice(0, 2).forEach((ch, j) => {
      parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 15 + j * 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 10))}</text>`)
    })
  })

  // Center intersection
  const centerIx = intersects.find(i => i.label.includes('∩') || i.label.toLowerCase().includes('all')) ?? intersects[0]
  if (centerIx) {
    const icx = (c1x + c2x + c3x) / 3
    const icy = (c1y + c2y + c3y) / 3
    parts.push(`<text x="${icx.toFixed(1)}" y="${(icy + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(centerIx.label, 10))}</text>`)
  }

  return svg(W, H, theme, spec.title, parts)
}

// ── Concentric rings ──────────────────────────────────────────────────────────

function renderConcentric(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 500
  const TITLE_H = spec.title ? 28 : 8
  const H = 400 + TITLE_H
  const cxPos = W / 2
  const cyPos = TITLE_H + (H - TITLE_H) / 2
  const MAX_R = Math.min(cxPos, (H - TITLE_H) / 2) - 10

  const parts: string[] = []

  // Draw from outermost to innermost (innermost renders on top)
  for (let i = n - 1; i >= 0; i--) {
    const item = items[i]
    const r = MAX_R * (i + 1) / n
    // Opacity: outer rings lighter, inner darker
    const opacityHex = Math.round(12 + (1 - i / n) * 28).toString(16).padStart(2, '0')

    parts.push(
      `<circle cx="${cxPos.toFixed(1)}" cy="${cyPos.toFixed(1)}" r="${r.toFixed(1)}" fill="${theme.primary}${opacityHex}" stroke="${theme.primary}55" stroke-width="1.2"/>`,
    )

    // Label arced near the top of each ring band
    const labelY = cyPos - (r - MAX_R / n / 2) + 14
    parts.push(
      `<text x="${cxPos.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 18))}</text>`,
    )
  }

  return svg(W, H, theme, spec.title, parts)
}

// ── Shared SVG wrapper ────────────────────────────────────────────────────────

function svg(W: number, H: number, theme: SmartArtTheme, title: string | undefined, parts: string[]): string {
  const titleEl = title
    ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>`
    : ''
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl}
  ${parts.join('\n  ')}
</svg>`
}

function renderEmpty(theme: SmartArtTheme): string {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`
}
