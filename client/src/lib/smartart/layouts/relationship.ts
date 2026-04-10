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
    case 'concentric':        return renderConcentric(spec, theme)
    case 'venn-3':            return renderVenn3(spec, theme)
    case 'venn-4':            return renderVenn4(spec, theme)
    case 'target':            return renderTarget(spec, theme)
    case 'radial':            return renderRadial(spec, theme)
    case 'converging':        return renderConverging(spec, theme)
    case 'diverging':         return renderDiverging(spec, theme)
    case 'opposing-arrows':   return renderOpposingArrows(spec, theme)
    case 'counterbalance':
    case 'balance':           return renderCounterbalance(spec, theme)
    case 'plus':              return renderPlus(spec, theme)
    case 'web':               return renderWeb(spec, theme)
    case 'cluster':           return renderCluster(spec, theme)
    default:                  return renderVenn2(spec, theme)
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

// ── Venn-4 (2×2 circle grid) ──────────────────────────────────────────────────

function renderVenn4(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items.filter(i => !i.isIntersection)
  const ixItem = spec.items.find(i => i.isIntersection)
  const W = 560, TITLE_H = spec.title ? 28 : 8, H = 380 + TITLE_H
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2
  const R = 105, dx = 60, dy = 44
  const centers = [
    [cx - dx, cy - dy], [cx + dx, cy - dy],
    [cx - dx, cy + dy], [cx + dx, cy + dy],
  ]
  const colors = [theme.primary, theme.secondary, theme.accent, theme.primary]
  const labelOff: [number, number][] = [[-R * 0.58, -R * 0.52], [R * 0.58, -R * 0.52], [-R * 0.58, R * 0.52], [R * 0.58, R * 0.52]]
  const parts: string[] = []
  centers.forEach(([x, y], i) => {
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${R}" fill="${colors[i]}20" stroke="${colors[i]}66" stroke-width="1.5"/>`)
  })
  items.slice(0, 4).forEach((item, i) => {
    const [x, y] = centers[i]
    const lx = x + labelOff[i][0], ly = y + labelOff[i][1]
    parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 12))}</text>`)
    item.children.slice(0, 2).forEach((ch, j) => {
      parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 14 + j * 13).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 10))}</text>`)
    })
  })
  if (ixItem) parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="9" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(ixItem.label, 10))}</text>`)
  return svg(W, H, theme, spec.title, parts)
}

// ── Target / Bullseye ─────────────────────────────────────────────────────────

function renderTarget(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const W = 480, TITLE_H = spec.title ? 28 : 8, H = 380 + TITLE_H
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2
  const MAX_R = Math.min(cx - 10, (H - TITLE_H) / 2 - 12)
  const parts: string[] = []
  // Crosshairs
  parts.push(`<line x1="${cx - MAX_R - 6}" y1="${cy}" x2="${cx + MAX_R + 6}" y2="${cy}" stroke="${theme.border}28" stroke-width="1"/>`)
  parts.push(`<line x1="${cx}" y1="${cy - MAX_R - 6}" x2="${cx}" y2="${cy + MAX_R + 6}" stroke="${theme.border}28" stroke-width="1"/>`)
  // Rings (outermost = items[0], innermost = items[n-1])
  for (let i = n - 1; i >= 0; i--) {
    const r = MAX_R * (i + 1) / n
    const t = i / Math.max(n - 1, 1)  // 1=outer 0=inner
    const fillAlpha = Math.round(14 + (1 - t) * 36).toString(16).padStart(2, '0')
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${theme.primary}${fillAlpha}" stroke="${theme.primary}66" stroke-width="1.5"/>`)
    const bandR = r - MAX_R / n / 2
    parts.push(`<text x="${cx}" y="${(cy - bandR + 5).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="${i === n - 1 ? '700' : '400'}">${escapeXml(truncate(items[i].label, 18))}</text>`)
  }
  return svg(W, H, theme, spec.title, parts)
}

// ── Radial (non-hierarchical hub + peers) ─────────────────────────────────────

function renderRadial(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const centerLabel = spec.title ?? spec.items[0]?.label ?? 'Hub'
  const spokes = spec.title ? spec.items : spec.items.slice(1)
  const n = spokes.length || 1
  const W = 560, H = 440
  const cx = W / 2, cy = H / 2
  const R = 158
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2
    const sx = cx + R * Math.cos(angle), sy = cy + R * Math.sin(angle)
    const item = spokes[i]
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${theme.border}44" stroke-width="1.5"/>`)
    if (item) {
      parts.push(`<rect x="${(sx - 52).toFixed(1)}" y="${(sy - 18).toFixed(1)}" width="104" height="36" rx="5" fill="${theme.surface}" stroke="${theme.primary}66" stroke-width="1.2"/>`)
      parts.push(`<text x="${sx.toFixed(1)}" y="${(sy + 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 12))}</text>`)
      item.children.slice(0, 2).forEach((ch, j) => {
        const offY = sy + 26 + j * 13
        parts.push(`<text x="${sx.toFixed(1)}" y="${offY.toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 12))}</text>`)
      })
    }
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="38" fill="${theme.accent}33" stroke="${theme.accent}" stroke-width="1.5"/>`)
  const cw = centerLabel.split(' ')
  if (cw.length === 1) {
    parts.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(centerLabel, 12))}</text>`)
  } else {
    const m = Math.ceil(cw.length / 2)
    parts.push(`<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(cw.slice(0, m).join(' '), 12))}</text>`)
    parts.push(`<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(cw.slice(m).join(' '), 12))}</text>`)
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join('\n  ')}
</svg>`
}

// ── Converging (many → one) ───────────────────────────────────────────────────

function renderConverging(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  // Last item is target; all others converge into it
  const sources = items.length > 1 ? items.slice(0, -1) : items
  const target  = items.length > 1 ? items[items.length - 1] : { label: spec.title ?? 'Result', children: [] as typeof items[0]['children'] }
  const n = sources.length
  const W = 520, TITLE_H = spec.title ? 28 : 8
  const ROW_H = Math.max(44, Math.min(60, 300 / n))
  const H = Math.max(200, n * ROW_H + TITLE_H + 40)
  const cy = TITLE_H + (H - TITLE_H) / 2
  const SRC_X = 10, TGT_X = W - 130
  const parts: string[] = []
  parts.push(`<defs><marker id="arr-c" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L7,4 L0,8 Z" fill="${theme.accent}cc"/></marker></defs>`)
  // Target
  const tBH = Math.min(64, n * 18 + 20)
  parts.push(`<rect x="${TGT_X}" y="${(cy - tBH / 2).toFixed(1)}" width="116" height="${tBH}" rx="6" fill="${theme.accent}28" stroke="${theme.accent}" stroke-width="1.5"/>`)
  const tw = target.label.split(' '), tm = Math.ceil(tw.length / 2)
  parts.push(`<text x="${(TGT_X + 58).toFixed(1)}" y="${tw.length > 1 ? (cy - 2).toFixed(1) : (cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(tw.slice(0, tm).join(' '), 13))}</text>`)
  if (tw.length > 1) parts.push(`<text x="${(TGT_X + 58).toFixed(1)}" y="${(cy + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(tw.slice(tm).join(' '), 13))}</text>`)
  // Sources + arrows
  sources.forEach((item, i) => {
    const sy = n === 1 ? cy : TITLE_H + 20 + i * (H - TITLE_H - 40) / (n - 1)
    parts.push(`<rect x="${SRC_X}" y="${(sy - 16).toFixed(1)}" width="112" height="32" rx="5" fill="${theme.surface}" stroke="${theme.primary}66" stroke-width="1.2"/>`)
    parts.push(`<text x="${(SRC_X + 56).toFixed(1)}" y="${(sy + 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 13))}</text>`)
    const x1 = SRC_X + 112, x2 = TGT_X - 4
    const mid = (x1 + x2) / 2
    parts.push(`<path d="M${x1},${sy.toFixed(1)} C${mid},${sy.toFixed(1)} ${mid},${cy.toFixed(1)} ${x2},${cy.toFixed(1)}" fill="none" stroke="${theme.primary}66" stroke-width="1.5" marker-end="url(#arr-c)"/>`)
  })
  return svg(W, H, theme, spec.title, parts)
}

// ── Diverging (one → many) ────────────────────────────────────────────────────

function renderDiverging(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  // First item is source; all others diverge from it
  const source  = items[0]
  const targets = items.length > 1 ? items.slice(1) : [{ label: spec.title ?? 'Output', children: [] as typeof items[0]['children'] }]
  const n = targets.length
  const W = 520, TITLE_H = spec.title ? 28 : 8
  const ROW_H = Math.max(44, Math.min(60, 300 / n))
  const H = Math.max(200, n * ROW_H + TITLE_H + 40)
  const cy = TITLE_H + (H - TITLE_H) / 2
  const SRC_X = 10, TGT_X = W - 122
  const parts: string[] = []
  parts.push(`<defs><marker id="arr-d" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L7,4 L0,8 Z" fill="${theme.primary}cc"/></marker></defs>`)
  // Source
  const sBH = Math.min(64, n * 18 + 20)
  parts.push(`<rect x="${SRC_X}" y="${(cy - sBH / 2).toFixed(1)}" width="116" height="${sBH}" rx="6" fill="${theme.primary}28" stroke="${theme.primary}" stroke-width="1.5"/>`)
  const sw = source.label.split(' '), sm2 = Math.ceil(sw.length / 2)
  parts.push(`<text x="${(SRC_X + 58).toFixed(1)}" y="${sw.length > 1 ? (cy - 2).toFixed(1) : (cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(sw.slice(0, sm2).join(' '), 13))}</text>`)
  if (sw.length > 1) parts.push(`<text x="${(SRC_X + 58).toFixed(1)}" y="${(cy + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(sw.slice(sm2).join(' '), 13))}</text>`)
  // Targets + arrows
  targets.forEach((item, i) => {
    const ty = n === 1 ? cy : TITLE_H + 20 + i * (H - TITLE_H - 40) / (n - 1)
    parts.push(`<rect x="${TGT_X}" y="${(ty - 16).toFixed(1)}" width="112" height="32" rx="5" fill="${theme.surface}" stroke="${theme.secondary}66" stroke-width="1.2"/>`)
    parts.push(`<text x="${(TGT_X + 56).toFixed(1)}" y="${(ty + 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 13))}</text>`)
    const x1 = SRC_X + 116 + 4, x2 = TGT_X
    const mid = (x1 + x2) / 2
    parts.push(`<path d="M${x1},${cy.toFixed(1)} C${mid},${cy.toFixed(1)} ${mid},${ty.toFixed(1)} ${x2},${ty.toFixed(1)}" fill="none" stroke="${theme.secondary}66" stroke-width="1.5" marker-end="url(#arr-d)"/>`)
  })
  return svg(W, H, theme, spec.title, parts)
}

// ── Opposing arrows ───────────────────────────────────────────────────────────

function renderOpposingArrows(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const left  = spec.items[0] ?? { label: 'Force A', children: [] as SmartArtSpec['items'][0]['children'] }
  const right = spec.items[1] ?? { label: 'Force B', children: [] as SmartArtSpec['items'][0]['children'] }
  const W = 520, TITLE_H = spec.title ? 28 : 8, H = 240 + TITLE_H
  const cy = TITLE_H + (H - TITLE_H) / 2
  const AH = 68, gap = 18
  const lx1 = 8, lx2 = W / 2 - gap / 2
  const rx1 = W / 2 + gap / 2, rx2 = W - 8
  const parts: string[] = []
  // Left arrow → pointing right
  parts.push(`<polygon points="${lx1},${cy - AH/2} ${lx2 - 32},${cy - AH/2} ${lx2},${cy} ${lx2 - 32},${cy + AH/2} ${lx1},${cy + AH/2}" fill="${theme.primary}2a" stroke="${theme.primary}77" stroke-width="1.5"/>`)
  parts.push(`<text x="${((lx1 + lx2) / 2 - 14).toFixed(1)}" y="${(cy - 10).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(left.label, 15))}</text>`)
  left.children.slice(0, 3).forEach((ch, i) => {
    parts.push(`<text x="${((lx1 + lx2) / 2 - 14).toFixed(1)}" y="${(cy + 8 + i * 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 13))}</text>`)
  })
  // Right arrow ← pointing left
  parts.push(`<polygon points="${rx2},${cy - AH/2} ${rx1 + 32},${cy - AH/2} ${rx1},${cy} ${rx1 + 32},${cy + AH/2} ${rx2},${cy + AH/2}" fill="${theme.secondary}2a" stroke="${theme.secondary}77" stroke-width="1.5"/>`)
  parts.push(`<text x="${((rx1 + rx2) / 2 + 14).toFixed(1)}" y="${(cy - 10).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(right.label, 15))}</text>`)
  right.children.slice(0, 3).forEach((ch, i) => {
    parts.push(`<text x="${((rx1 + rx2) / 2 + 14).toFixed(1)}" y="${(cy + 8 + i * 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 13))}</text>`)
  })
  return svg(W, H, theme, spec.title, parts)
}

// ── Counterbalance (scale / balance) ─────────────────────────────────────────

function renderCounterbalance(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const left  = spec.items[0] ?? { label: 'Side A', children: [] as SmartArtSpec['items'][0]['children'] }
  const right = spec.items[1] ?? { label: 'Side B', children: [] as SmartArtSpec['items'][0]['children'] }
  const W = 520, TITLE_H = spec.title ? 28 : 8, H = 300 + TITLE_H
  const bx = W / 2, beamY = TITLE_H + 76, beamW = 400, plateW = 130, plateH = 18
  const parts: string[] = []
  // Fulcrum
  parts.push(`<polygon points="${bx},${beamY + 4} ${bx - 18},${beamY + 44} ${bx + 18},${beamY + 44}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1.5"/>`)
  parts.push(`<rect x="${bx - 30}" y="${beamY + 44}" width="60" height="8" rx="2" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`)
  // Beam
  parts.push(`<rect x="${(bx - beamW / 2).toFixed(1)}" y="${(beamY - 4).toFixed(1)}" width="${beamW}" height="8" rx="3" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1.5"/>`)
  // Left side
  const lx = bx - beamW / 2 + plateW / 2 - 6
  parts.push(`<line x1="${lx}" y1="${beamY}" x2="${lx}" y2="${beamY + 38}" stroke="${theme.border}66" stroke-width="1.5"/>`)
  parts.push(`<rect x="${(lx - plateW / 2).toFixed(1)}" y="${(beamY + 38).toFixed(1)}" width="${plateW}" height="${plateH}" rx="4" fill="${theme.primary}30" stroke="${theme.primary}77" stroke-width="1.2"/>`)
  parts.push(`<text x="${lx.toFixed(1)}" y="${(beamY + 38 + 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(left.label, 16))}</text>`)
  left.children.slice(0, 4).forEach((ch, i) => {
    parts.push(`<text x="${lx.toFixed(1)}" y="${(beamY + 66 + i * 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 16))}</text>`)
  })
  // Right side
  const rx = bx + beamW / 2 - plateW / 2 + 6
  parts.push(`<line x1="${rx}" y1="${beamY}" x2="${rx}" y2="${beamY + 38}" stroke="${theme.border}66" stroke-width="1.5"/>`)
  parts.push(`<rect x="${(rx - plateW / 2).toFixed(1)}" y="${(beamY + 38).toFixed(1)}" width="${plateW}" height="${plateH}" rx="4" fill="${theme.secondary}30" stroke="${theme.secondary}77" stroke-width="1.2"/>`)
  parts.push(`<text x="${rx.toFixed(1)}" y="${(beamY + 38 + 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(right.label, 16))}</text>`)
  right.children.slice(0, 4).forEach((ch, i) => {
    parts.push(`<text x="${rx.toFixed(1)}" y="${(beamY + 66 + i * 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 16))}</text>`)
  })
  return svg(W, H, theme, spec.title, parts)
}

// ── Plus / cross ──────────────────────────────────────────────────────────────

function renderPlus(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  const W = 500, TITLE_H = spec.title ? 28 : 8, H = 400 + TITLE_H
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2
  const ARM = 130, BW = 106, BH = 50, CR = 30
  const pos: [number, number][] = [[cx, cy - ARM], [cx + ARM, cy], [cx, cy + ARM], [cx - ARM, cy]]
  const colors = [theme.primary, theme.secondary, theme.accent, theme.primary]
  const parts: string[] = []
  // Plus arms (thick lines behind boxes)
  const armColor = `${theme.primary}55`
  parts.push(`<line x1="${cx}" y1="${cy - ARM + BH / 2}" x2="${cx}" y2="${cy - CR}" stroke="${armColor}" stroke-width="12"/>`)
  parts.push(`<line x1="${cx}" y1="${cy + CR}" x2="${cx}" y2="${cy + ARM - BH / 2}" stroke="${armColor}" stroke-width="12"/>`)
  parts.push(`<line x1="${cx - ARM + BW / 2}" y1="${cy}" x2="${cx - CR}" y2="${cy}" stroke="${armColor}" stroke-width="12"/>`)
  parts.push(`<line x1="${cx + CR}" y1="${cy}" x2="${cx + ARM - BW / 2}" y2="${cy}" stroke="${armColor}" stroke-width="12"/>`)
  // Center
  const centerItem = items[4]
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${CR}" fill="${theme.accent}33" stroke="${theme.accent}" stroke-width="1.5"/>`)
  if (centerItem) parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(centerItem.label, 9))}</text>`)
  // 4 directional items
  items.slice(0, 4).forEach((item, i) => {
    const [px, py] = pos[i]
    parts.push(`<rect x="${(px - BW / 2).toFixed(1)}" y="${(py - BH / 2).toFixed(1)}" width="${BW}" height="${BH}" rx="6" fill="${theme.surface}" stroke="${colors[i]}88" stroke-width="1.5"/>`)
    parts.push(`<text x="${px.toFixed(1)}" y="${(py - 7).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 13))}</text>`)
    item.children.slice(0, 2).forEach((ch, j) => {
      parts.push(`<text x="${px.toFixed(1)}" y="${(py + 9 + j * 12).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(ch.label, 14))}</text>`)
    })
  })
  return svg(W, H, theme, spec.title, parts)
}

// ── Web (mesh network) ────────────────────────────────────────────────────────

function renderWeb(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const W = 520, TITLE_H = spec.title ? 28 : 8, H = 420 + TITLE_H
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2
  const R = 148
  const pos: [number, number][] = items.map((_, i) => [
    cx + R * Math.cos(2 * Math.PI * i / n - Math.PI / 2),
    cy + R * Math.sin(2 * Math.PI * i / n - Math.PI / 2),
  ])
  const parts: string[] = []
  // Edges
  const drawn = new Set<string>()
  const edge = (i: number, j: number) => {
    const k = `${Math.min(i, j)}-${Math.max(i, j)}`
    if (drawn.has(k)) return; drawn.add(k)
    parts.push(`<line x1="${pos[i][0].toFixed(1)}" y1="${pos[i][1].toFixed(1)}" x2="${pos[j][0].toFixed(1)}" y2="${pos[j][1].toFixed(1)}" stroke="${theme.primary}55" stroke-width="1.8"/>`)
  }
  for (let i = 0; i < n; i++) {
    edge(i, (i + 1) % n)
    if (n <= 7) edge(i, (i + 2) % n)
    if (n <= 4) for (let j = i + 1; j < n; j++) edge(i, j)
  }
  // Nodes
  const nodeR = Math.max(22, Math.min(34, 72 / n))
  items.forEach((item, i) => {
    const [nx, ny] = pos[i]
    parts.push(`<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${nodeR}" fill="${theme.primary}22" stroke="${theme.primary}99" stroke-width="1.8"/>`)
    parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + 4).toFixed(1)}" text-anchor="middle" font-size="${Math.max(8, Math.min(10, nodeR * 0.5)).toFixed(0)}" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 9))}</text>`)
  })
  return svg(W, H, theme, spec.title, parts)
}

// ── Cluster (grouped nodes) ───────────────────────────────────────────────────

function renderCluster(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const cols = n <= 2 ? n : n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const W = 560, TITLE_H = spec.title ? 28 : 8, H = TITLE_H + rows * 180 + 20
  const clW = (W - 20) / cols - 10, clH = 168
  const colors = [theme.primary, theme.secondary, theme.accent, theme.primary, theme.secondary]
  const parts: string[] = []
  items.forEach((group, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const gx = 10 + col * (clW + 10) + clW / 2
    const gy = TITLE_H + 10 + row * (clH + 10) + clH / 2
    const color = colors[i % colors.length]
    parts.push(`<ellipse cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" rx="${(clW / 2).toFixed(1)}" ry="${(clH / 2).toFixed(1)}" fill="${color}14" stroke="${color}55" stroke-width="1.5"/>`)
    parts.push(`<text x="${gx.toFixed(1)}" y="${(gy - clH / 2 + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(group.label, 16))}</text>`)
    const members = group.children, mR = 22
    const mCols = 3, spacing = clW / (mCols + 1)
    const nRows = Math.ceil(Math.min(members.length, 6) / mCols)
    const rowSpacing = 52
    // Center the circle block vertically in the space below the label
    const contentTop = gy - clH / 2 + 28   // below label
    const contentBot = gy + clH / 2 - 10
    const blockH = (nRows - 1) * rowSpacing
    const firstRowY = (contentTop + contentBot) / 2 - blockH / 2
    members.slice(0, 6).forEach((m, j) => {
      const mc = j % mCols, mr = Math.floor(j / mCols)
      const mx = gx - clW / 2 + spacing * (mc + 1)
      const my = firstRowY + mr * rowSpacing
      parts.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${mR}" fill="${color}2a" stroke="${color}66" stroke-width="1"/>`)
      parts.push(`<text x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(m.label, 8))}</text>`)
    })
  })
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
