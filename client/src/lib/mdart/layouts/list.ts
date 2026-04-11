import type { MdArtSpec } from '../parser'
import type { MdArtTheme } from '../theme'

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
  return '#' + [lerp(r1, r2), lerp(g1, g2), lerp(b1, b2)].map(v => v.toString(16).padStart(2, '0')).join('')
}

export function renderList(spec: MdArtSpec, theme: MdArtTheme): string {
  switch (spec.type) {
    case 'numbered-list':   return renderNumberedList(spec, theme)
    case 'checklist':       return renderChecklist(spec, theme)
    case 'two-column-list': return renderTwoColumnList(spec, theme)
    case 'timeline-list':   return renderTimelineList(spec, theme)
    case 'block-list':      return renderBlockList(spec, theme)
    case 'chevron-list':    return renderChevronList(spec, theme)
    case 'card-list':       return renderCardList(spec, theme)
    case 'zigzag-list':     return renderZigzagList(spec, theme)
    case 'ribbon-list':     return renderRibbonList(spec, theme)
    case 'hexagon-list':    return renderHexagonList(spec, theme)
    case 'trapezoid-list':  return renderTrapezoidList(spec, theme)
    case 'tab-list':        return renderTabList(spec, theme)
    case 'circle-list':     return renderCircleList(spec, theme)
    case 'icon-list':       return renderIconList(spec, theme)
    default:                return renderBulletList(spec, theme)
  }
}

// ── Bullet list ───────────────────────────────────────────────────────────────

function renderBulletList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 460
  const ROW_H = 38
  const PAD = 16
  const titleH = spec.title ? 28 : 0
  const H = PAD + titleH + items.length * ROW_H + PAD

  let svgContent = ''

  if (spec.title) {
    svgContent += `<text x="${PAD}" y="${PAD + 16}" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const y = PAD + titleH + i * ROW_H
    const cy = y + ROW_H / 2
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.secondary, theme.primary, t)

    // Bullet dot
    svgContent += `<circle cx="${PAD + 8}" cy="${cy}" r="5" fill="${fill}" />`

    // Label
    svgContent += `<text x="${PAD + 22}" y="${cy + 4}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(item.label)}</text>`

    // Value
    if (item.value) {
      svgContent += `<text x="${W - PAD}" y="${cy + 4}" text-anchor="end" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`
    }

    // Children (indented)
    if (item.children.length > 0 && i < items.length) {
      // We'll just list first child inline for compactness
      const childText = item.children.map(c => c.label).join(', ')
      svgContent += `<text x="${PAD + 22}" y="${cy + 16}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(childText.slice(0, 60))}</text>`
    }

    // Separator line
    if (i < items.length - 1) {
      svgContent += `<line x1="${PAD}" y1="${y + ROW_H}" x2="${W - PAD}" y2="${y + ROW_H}" stroke="${theme.border}" stroke-width="0.5" />`
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Numbered list ─────────────────────────────────────────────────────────────

function renderNumberedList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 460
  const ROW_H = 40
  const PAD = 16
  const titleH = spec.title ? 28 : 0
  const H = PAD + titleH + items.length * ROW_H + PAD

  let svgContent = ''

  if (spec.title) {
    svgContent += `<text x="${PAD}" y="${PAD + 16}" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const y = PAD + titleH + i * ROW_H
    const cy = y + ROW_H / 2
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.secondary, theme.primary, t)

    // Number badge
    svgContent += `<rect x="${PAD}" y="${cy - 11}" width="22" height="22" rx="4" fill="${fill}" />`
    svgContent += `<text x="${PAD + 11}" y="${cy + 4}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${i + 1}</text>`

    // Label
    svgContent += `<text x="${PAD + 30}" y="${cy + 4}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(item.label)}</text>`

    if (item.value) {
      svgContent += `<text x="${W - PAD}" y="${cy + 4}" text-anchor="end" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`
    }

    if (i < items.length - 1) {
      svgContent += `<line x1="${PAD}" y1="${y + ROW_H}" x2="${W - PAD}" y2="${y + ROW_H}" stroke="${theme.border}" stroke-width="0.5" />`
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Checklist ─────────────────────────────────────────────────────────────────

function renderChecklist(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 460
  const ROW_H = 38
  const PAD = 16
  const titleH = spec.title ? 28 : 0
  const H = PAD + titleH + items.length * ROW_H + PAD

  let svgContent = ''

  if (spec.title) {
    svgContent += `<text x="${PAD}" y="${PAD + 16}" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const y = PAD + titleH + i * ROW_H
    const cy = y + ROW_H / 2
    const done = item.attrs.includes('done') || item.attrs.includes('✓') || item.attrs.includes('complete')

    // Checkbox
    svgContent += `<rect x="${PAD}" y="${cy - 9}" width="18" height="18" rx="3" fill="none" stroke="${theme.primary}" stroke-width="1.5" />`
    if (done) {
      svgContent += `<polyline points="${PAD + 4},${cy} ${PAD + 8},${cy + 4} ${PAD + 14},${cy - 4}" fill="none" stroke="${theme.accent}" stroke-width="2" stroke-linecap="round" />`
    }

    // Label
    const labelFill = done ? theme.textMuted : theme.text
    svgContent += `<text x="${PAD + 26}" y="${cy + 4}" font-size="12" fill="${labelFill}" font-family="system-ui,sans-serif"${done ? ' text-decoration="line-through"' : ''}>${escapeXml(item.label)}</text>`

    // Attrs (badges)
    const extraAttrs = item.attrs.filter(a => !['done', '✓', 'complete'].includes(a))
    if (extraAttrs.length > 0) {
      svgContent += `<text x="${W - PAD}" y="${cy + 4}" text-anchor="end" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">[${extraAttrs.join(', ')}]</text>`
    }

    if (i < items.length - 1) {
      svgContent += `<line x1="${PAD}" y1="${y + ROW_H}" x2="${W - PAD}" y2="${y + ROW_H}" stroke="${theme.border}" stroke-width="0.5" />`
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Two-column list ───────────────────────────────────────────────────────────

function renderTwoColumnList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const half = Math.ceil(items.length / 2)
  const left = items.slice(0, half)
  const right = items.slice(half)
  const maxRows = Math.max(left.length, right.length)

  const W = 500
  const ROW_H = 36
  const PAD = 16
  const titleH = spec.title ? 28 : 0
  const H = PAD + titleH + maxRows * ROW_H + PAD

  let svgContent = ''

  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`
  }

  // Divider
  svgContent += `<line x1="${W / 2}" y1="${PAD + titleH}" x2="${W / 2}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="1" />`

  const renderCol = (colItems: typeof items, startX: number) => {
    for (let i = 0; i < colItems.length; i++) {
      const item = colItems[i]
      const cy = PAD + titleH + i * ROW_H + ROW_H / 2
      const t = items.length > 1 ? items.indexOf(item) / (items.length - 1) : 0
      const fill = lerpColor(theme.secondary, theme.primary, t)

      svgContent += `<circle cx="${startX + 8}" cy="${cy}" r="4" fill="${fill}" />`
      svgContent += `<text x="${startX + 18}" y="${cy + 4}" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(item.label)}</text>`
    }
  }

  renderCol(left, PAD)
  renderCol(right, W / 2 + PAD)

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Timeline list ─────────────────────────────────────────────────────────────

function renderTimelineList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 500
  const CARD_H = 54
  const PAD = 20
  const LINE_X = W / 2
  const CARD_W = 180
  const ROW_H = CARD_H + 20
  const titleH = spec.title ? 28 : 0
  const H = PAD + titleH + items.length * ROW_H + PAD

  let svgContent = ''

  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`
  }

  // Vertical timeline line
  svgContent += `<line x1="${LINE_X}" y1="${PAD + titleH}" x2="${LINE_X}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="2" />`

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const cy = PAD + titleH + i * ROW_H + CARD_H / 2
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.secondary, theme.primary, t)
    const left = i % 2 === 0

    const cardX = left ? LINE_X - 14 - CARD_W : LINE_X + 14
    const cardY = cy - CARD_H / 2

    // Card
    svgContent += `<rect x="${cardX}" y="${cardY}" width="${CARD_W}" height="${CARD_H}" rx="6" fill="${theme.surface}" stroke="${fill}" stroke-width="1.5" />`

    // Timeline dot
    svgContent += `<circle cx="${LINE_X}" cy="${cy}" r="7" fill="${fill}" />`

    // Label
    svgContent += `<text x="${cardX + CARD_W / 2}" y="${cy - 6}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(item.label)}</text>`

    if (item.value) {
      svgContent += `<text x="${cardX + CARD_W / 2}" y="${cy + 10}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`
    }

    if (item.attrs.length > 0) {
      svgContent += `<text x="${cardX + CARD_W / 2}" y="${cy + 22}" text-anchor="middle" font-size="9" fill="${theme.accent}" font-family="system-ui,sans-serif">${escapeXml(item.attrs.join(', '))}</text>`
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Block list ────────────────────────────────────────────────────────────────
// 2-column grid of colored blocks; label: value for subtitle

function renderBlockList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500
  const COLS = 2
  const CELL_W = (W - 12) / COLS
  const CELL_H = 68
  const GAP = 8
  const rows = Math.ceil(items.length / COLS)
  const titleH = spec.title ? 30 : 8
  const H = titleH + rows * (CELL_H + GAP) + 8
  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)
  items.forEach((item, i) => {
    const col = i % COLS, row = Math.floor(i / COLS)
    const x = col * (CELL_W + GAP), y = titleH + row * (CELL_H + GAP)
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CELL_W.toFixed(1)}" height="${CELL_H}" rx="8" fill="${fill}33" stroke="${fill}88" stroke-width="1.5"/>`)
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="6" height="${CELL_H}" rx="3" fill="${fill}"/>`)
    parts.push(`<text x="${(x+16).toFixed(1)}" y="${(y+26).toFixed(1)}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 28))}</text>`)
    if (item.value) parts.push(`<text x="${(x+16).toFixed(1)}" y="${(y+44).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 34))}</text>`)
    const sub = item.children.map(c => c.label).join(' · ')
    if (sub) parts.push(`<text x="${(x+16).toFixed(1)}" y="${(y+58).toFixed(1)}" font-size="9" fill="${theme.muted}" font-family="system-ui,sans-serif">${escapeXml(truncate(sub, 38))}</text>`)
  })
  return svg(W, H, theme, parts)
}

// ── Chevron list ──────────────────────────────────────────────────────────────
// Stacked horizontal chevron arrows

function renderChevronList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500
  const ROW_H = 32, GAP = 4, NOTCH = 14
  const titleH = spec.title ? 30 : 8
  const H = titleH + items.length * (ROW_H + GAP) + 8
  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)
  items.forEach((item, i) => {
    const y = titleH + i * (ROW_H + GAP)
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    const x0 = i === 0 ? 0 : NOTCH, x1 = W - NOTCH, mid = y + ROW_H / 2
    // chevron shape: left indent (except first) → right point
    const d = i === 0
      ? `M0,${y} L${x1},${y} L${W},${mid} L${x1},${y+ROW_H} L0,${y+ROW_H} Z`
      : `M0,${y} L${x1},${y} L${W},${mid} L${x1},${y+ROW_H} L0,${y+ROW_H} L${NOTCH},${mid} Z`
    parts.push(`<path d="${d}" fill="${fill}33" stroke="${fill}" stroke-width="1"/>`)
    parts.push(`<text x="${(x0 + x1) / 2 + NOTCH/2}" y="${(mid + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 40))}</text>`)
    if (item.value) parts.push(`<text x="${W - NOTCH - 6}" y="${(mid + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`)
  })
  return svg(W, H, theme, parts)
}

// ── Card list ─────────────────────────────────────────────────────────────────
// Vertical cards with colored header; top-level items = columns, children = rows

function renderCardList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500
  const n = Math.min(items.length, 4)
  const GAP = 8, HEADER_H = 32, ROW_H = 20
  const maxChildren = Math.max(...items.slice(0, n).map(it => it.children.length), 2)
  const CARD_H = HEADER_H + maxChildren * ROW_H + 16
  const CARD_W = (W - (n - 1) * GAP) / n
  const titleH = spec.title ? 30 : 8
  const H = titleH + CARD_H + 8
  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)
  items.slice(0, n).forEach((item, i) => {
    const x = i * (CARD_W + GAP), y = titleH
    const t = n > 1 ? i / (n - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CARD_W.toFixed(1)}" height="${CARD_H}" rx="7" fill="${theme.surface}" stroke="${fill}66" stroke-width="1.2"/>`)
    // Rounded-top header path
    parts.push(`<path d="M${(x+7).toFixed(1)},${y.toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${(y+7).toFixed(1)} L${x.toFixed(1)},${(y+HEADER_H).toFixed(1)} L${(x+CARD_W).toFixed(1)},${(y+HEADER_H).toFixed(1)} L${(x+CARD_W).toFixed(1)},${(y+7).toFixed(1)} Q${(x+CARD_W).toFixed(1)},${y.toFixed(1)} ${(x+CARD_W-7).toFixed(1)},${y.toFixed(1)} Z" fill="${fill}"/>`)
    parts.push(`<text x="${(x+CARD_W/2).toFixed(1)}" y="${(y+HEADER_H/2+4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 14))}</text>`)
    item.children.slice(0, maxChildren).forEach((child, ci) => {
      const cy = y + HEADER_H + ci * ROW_H + ROW_H
      parts.push(`<text x="${(x+CARD_W/2).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(child.label, 14))}</text>`)
    })
  })
  return svg(W, H, theme, parts)
}

// ── Zigzag list ───────────────────────────────────────────────────────────────
// Alternating left/right nodes connected by a center spine

function renderZigzagList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500
  const ROW_H = 38, BOX_W = 190, BOX_H = 30
  const SPINE_X = W / 2
  const titleH = spec.title ? 30 : 8
  const H = titleH + items.length * ROW_H + 10
  const parts: string[] = []
  parts.push(`<line x1="${SPINE_X}" y1="${titleH}" x2="${SPINE_X}" y2="${H-8}" stroke="${theme.border}" stroke-width="2"/>`)
  if (spec.title) parts.push(`<text x="${SPINE_X}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)
  items.forEach((item, i) => {
    const cy = titleH + i * ROW_H + ROW_H / 2
    const left = i % 2 === 0
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    const bx = left ? SPINE_X - 8 - BOX_W : SPINE_X + 8
    parts.push(`<rect x="${bx.toFixed(1)}" y="${(cy - BOX_H/2).toFixed(1)}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="${fill}22" stroke="${fill}" stroke-width="1.2"/>`)
    parts.push(`<text x="${(bx + BOX_W/2).toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 22))}</text>`)
    if (item.value) parts.push(`<text x="${(bx + BOX_W/2).toFixed(1)}" y="${(cy + 16).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 26))}</text>`)
    // connector dot
    parts.push(`<circle cx="${SPINE_X}" cy="${cy}" r="4" fill="${fill}"/>`)
    const lineX = left ? SPINE_X - 8 : SPINE_X + 8
    parts.push(`<line x1="${SPINE_X}" y1="${cy}" x2="${lineX}" y2="${cy}" stroke="${fill}" stroke-width="1.2"/>`)
  })
  return svg(W, H, theme, parts)
}

// ── Ribbon list ───────────────────────────────────────────────────────────────
// Bold banner ribbons with folded left edge

function renderRibbonList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500
  const RIB_H = 26, GAP = 6, FOLD = 10, TAIL = 14
  const titleH = spec.title ? 30 : 8
  const rowH = RIB_H + 12  // ribbon + sub-text below
  const H = titleH + items.length * (rowH + GAP) + 8
  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)
  items.forEach((item, i) => {
    const y = titleH + i * (rowH + GAP)
    const mid = y + RIB_H / 2
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    const dark = lerpColor(theme.primary, theme.secondary, Math.min(1, t + 0.15))
    // Left fold triangle
    parts.push(`<polygon points="0,${y} ${FOLD},${mid} 0,${y+RIB_H}" fill="${dark}"/>`)
    // Main ribbon band
    parts.push(`<rect x="${FOLD}" y="${y}" width="${W - FOLD - TAIL}" height="${RIB_H}" fill="${fill}"/>`)
    // Right tail cutout
    parts.push(`<polygon points="${W-TAIL},${y} ${W},${y} ${W-TAIL/2},${mid} ${W},${y+RIB_H} ${W-TAIL},${y+RIB_H}" fill="${fill}"/>`)
    parts.push(`<polygon points="${W-TAIL/2},${mid} ${W},${y} ${W},${y+RIB_H}" fill="${dark}"/>`)
    // Label + value
    parts.push(`<text x="${FOLD + 10}" y="${(mid + 4).toFixed(1)}" font-size="11" fill="#fff" font-family="system-ui,sans-serif" font-weight="700" letter-spacing="0.06em">${escapeXml(truncate(item.label.toUpperCase(), 30))}</text>`)
    if (item.value) parts.push(`<text x="${W/2}" y="${(y + RIB_H + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 60))}</text>`)
  })
  return svg(W, H, theme, parts)
}

// ── Hexagon list ──────────────────────────────────────────────────────────────
// Honeycomb grid of pointy-top hexagons

function renderHexagonList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500
  const R = 44  // circumradius
  const HEX_W = R * Math.sqrt(3), HEX_H = R * 2
  const COL_W = HEX_W + 6, ROW_H = HEX_H * 0.75 + 4
  const COLS = Math.min(items.length, 4)
  const rows = Math.ceil(items.length / COLS)
  const totalW = COLS * COL_W - 6
  const startX = (W - totalW) / 2 + HEX_W / 2
  const titleH = spec.title ? 30 : 8
  const H = titleH + rows * ROW_H + R * 0.25 + 8

  const hexPoints = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = Math.PI / 6 + k * Math.PI / 3
      return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`
    }).join(' ')

  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)

  items.forEach((item, i) => {
    const col = i % COLS, row = Math.floor(i / COLS)
    const cx = startX + col * COL_W + (row % 2 === 1 ? COL_W / 2 : 0)
    const cy = titleH + R + row * ROW_H
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    parts.push(`<polygon points="${hexPoints(cx, cy)}" fill="${fill}33" stroke="${fill}" stroke-width="1.5"/>`)
    parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 9))}</text>`)
    if (item.value) parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 9))}</text>`)
  })
  return svg(W, H, theme, parts)
}

// ── Trapezoid list ────────────────────────────────────────────────────────────
// Stacked widening trapezoid bands (horizontal pyramid)

function renderTrapezoidList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500, BAND_H = 28, GAP = 3
  const titleH = spec.title ? 30 : 8
  const H = titleH + items.length * (BAND_H + GAP) + 8
  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)
  const maxInset = W * 0.18
  items.forEach((item, i) => {
    const y = titleH + i * (BAND_H + GAP)
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    // Top band narrowest, bottom widest
    const topInset = maxInset * (1 - t)
    const botInset = items.length > 1 ? maxInset * (1 - (i + 1) / (items.length - 1 || 1)) : 0
    const clampedBotInset = Math.max(0, botInset)
    const d = `M${topInset.toFixed(1)},${y} L${(W-topInset).toFixed(1)},${y} L${(W-clampedBotInset).toFixed(1)},${(y+BAND_H)} L${clampedBotInset.toFixed(1)},${(y+BAND_H)} Z`
    parts.push(`<path d="${d}" fill="${fill}33" stroke="${fill}" stroke-width="1"/>`)
    parts.push(`<text x="${W/2}" y="${(y + BAND_H/2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 40))}</text>`)
    if (item.value) parts.push(`<text x="${(W - topInset - 8).toFixed(1)}" y="${(y + BAND_H/2 + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`)
  })
  return svg(W, H, theme, parts)
}

// ── Tab list ──────────────────────────────────────────────────────────────────
// Tabbed panel: top-level items = tabs; first item's children shown in content panel

function renderTabList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500, TAB_H = 28, CONTENT_H = 100, TAB_W = Math.min(110, (W - 8) / items.length)
  const titleH = spec.title ? 30 : 8
  const H = titleH + TAB_H + CONTENT_H + 8
  const t0 = items.length > 1 ? 0 : 0
  const activeFill = lerpColor(theme.primary, theme.secondary, t0)
  const active = items[0]
  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)

  // Tabs
  items.forEach((item, i) => {
    const tx = 4 + i * (TAB_W + 2)
    const ty = titleH
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    if (i === 0) {
      parts.push(`<rect x="${tx}" y="${ty}" width="${TAB_W}" height="${TAB_H}" rx="5" fill="${fill}"/>`)
      parts.push(`<text x="${(tx + TAB_W/2).toFixed(1)}" y="${(ty + TAB_H/2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 12))}</text>`)
    } else {
      parts.push(`<rect x="${tx}" y="${ty + 4}" width="${TAB_W}" height="${TAB_H - 4}" rx="4" fill="${fill}22" stroke="${fill}55" stroke-width="1"/>`)
      parts.push(`<text x="${(tx + TAB_W/2).toFixed(1)}" y="${(ty + TAB_H/2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 12))}</text>`)
    }
  })

  // Content panel
  const panelY = titleH + TAB_H
  parts.push(`<rect x="0" y="${panelY}" width="${W}" height="${CONTENT_H}" rx="0 6 6 6" fill="${activeFill}11" stroke="${activeFill}44" stroke-width="1.2"/>`)

  // Active tab content: title + children
  const cx = W / 2
  parts.push(`<text x="${cx}" y="${panelY + 26}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(active.label)}</text>`)
  if (active.value) {
    parts.push(`<text x="${cx}" y="${panelY + 44}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(active.value)}</text>`)
  }
  const childRow = active.children.map(c => c.label).join('  ·  ')
  if (childRow) {
    parts.push(`<text x="${cx}" y="${panelY + 62}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(childRow, 55))}</text>`)
  }
  const subRow = active.children.flatMap(c => c.children).map(c => c.label).join('  ·  ')
  if (subRow) {
    parts.push(`<text x="${cx}" y="${panelY + 78}" text-anchor="middle" font-size="9" fill="${theme.muted}" font-family="system-ui,sans-serif">${escapeXml(truncate(subRow, 60))}</text>`)
  }
  return svg(W, H, theme, parts)
}

// ── Circle list ───────────────────────────────────────────────────────────────
// Numbered circles connected by a vertical dashed line

function renderCircleList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500, ROW_H = 44, R = 16, LEFT = 28
  const titleH = spec.title ? 30 : 8
  const H = titleH + items.length * ROW_H + 8
  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)
  // Connecting line
  parts.push(`<line x1="${LEFT}" y1="${titleH + ROW_H/2}" x2="${LEFT}" y2="${titleH + (items.length-1)*ROW_H + ROW_H/2}" stroke="${theme.border}" stroke-width="2" stroke-dasharray="4,4"/>`)
  items.forEach((item, i) => {
    const cy = titleH + i * ROW_H + ROW_H / 2
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    parts.push(`<circle cx="${LEFT}" cy="${cy}" r="${R}" fill="${fill}"/>`)
    parts.push(`<text x="${LEFT}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${i + 1}</text>`)
    parts.push(`<text x="${LEFT + R + 10}" y="${(cy - 4).toFixed(1)}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 36))}</text>`)
    if (item.value) parts.push(`<text x="${LEFT + R + 10}" y="${(cy + 12).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 44))}</text>`)
  })
  return svg(W, H, theme, parts)
}

// ── Icon list ─────────────────────────────────────────────────────────────────
// Rows with colored circle badge + label + value description
// Attrs: first attr treated as emoji/icon displayed in the badge

function renderIconList(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 500, ROW_H = 44, CIRCLE_R = 18, LEFT = 24
  const titleH = spec.title ? 30 : 8
  const H = titleH + items.length * ROW_H + 8
  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${W/2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`)
  items.forEach((item, i) => {
    const cy = titleH + i * ROW_H + ROW_H / 2
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    const icon = item.attrs[0] ?? ''
    parts.push(`<circle cx="${LEFT}" cy="${cy}" r="${CIRCLE_R}" fill="${fill}"/>`)
    if (icon) {
      parts.push(`<text x="${LEFT}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-family="system-ui,sans-serif">${escapeXml(icon)}</text>`)
    }
    parts.push(`<text x="${LEFT + CIRCLE_R + 10}" y="${(cy - 4).toFixed(1)}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 30))}</text>`)
    if (item.value) parts.push(`<text x="${LEFT + CIRCLE_R + 10}" y="${(cy + 12).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 44))}</text>`)
    if (i < items.length - 1) parts.push(`<line x1="${LEFT + CIRCLE_R + 10}" y1="${cy + ROW_H/2}" x2="${W - 16}" y2="${cy + ROW_H/2}" stroke="${theme.border}" stroke-width="0.5"/>`)
  })
  return svg(W, H, theme, parts)
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function svg(W: number, H: number, theme: MdArtTheme, parts: string[]): string {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join('\n    ')}
  </svg>`
}

function renderEmpty(theme: MdArtTheme): string {
  return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
    <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
  </svg>`
}
