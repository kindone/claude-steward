import type { MdArtSpec } from '../parser'
import type { MdArtTheme } from '../theme'

// ── Color helpers ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Wrap text into lines ──────────────────────────────────────────────────────

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) { cur = w; continue }
    if (cur.length + 1 + w.length <= maxChars) { cur += ' ' + w }
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : [text]
}

// ── Process (default horizontal) ─────────────────────────────────────────────

export function renderProcess(spec: MdArtSpec, theme: MdArtTheme): string {
  switch (spec.type) {
    case 'funnel':          return renderFunnel(spec, theme)
    case 'roadmap':         return renderRoadmap(spec, theme)
    case 'step-down':       return renderStepDown(spec, theme)
    case 'step-up':         return renderStepUp(spec, theme)
    case 'circle-process':  return renderCircleProcess(spec, theme)
    case 'equation':        return renderEquation(spec, theme)
    case 'bending-process': return renderBendingProcess(spec, theme)
    case 'segmented-bar':   return renderSegmentedBar(spec, theme)
    case 'phase-process':   return renderPhaseProcess(spec, theme)
    case 'timeline-h':      return renderTimelineH(spec, theme)
    case 'timeline-v':      return renderTimelineV(spec, theme)
    case 'swimlane':        return renderSwimlane(spec, theme)
    default:                return renderHorizontalProcess(spec, theme)
  }
}

function renderHorizontalProcess(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) {
    return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
      <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
    </svg>`
  }

  const n = items.length
  const W = 700
  const PAD = 20
  const ARROW_W = 18
  const nodeW = Math.min(130, Math.floor((W - PAD * 2 - ARROW_W * (n - 1)) / n))
  const nodeH = 60
  const H = nodeH + PAD * 2

  // Vertical layout if n > 5
  if (n > 5) return renderVerticalProcess(spec, theme)

  const totalContentW = n * nodeW + (n - 1) * ARROW_W
  const startX = (W - totalContentW) / 2
  const cy = H / 2

  let svgContent = ''

  for (let i = 0; i < n; i++) {
    const item = items[i]
    const x = startX + i * (nodeW + ARROW_W)
    const y = cy - nodeH / 2
    const t = n > 1 ? i / (n - 1) : 0.5
    const fill = lerpColor(theme.secondary, theme.primary, t)
    const label = escapeXml(item.label)
    const lines = wrapText(item.label, Math.floor(nodeW / 7))

    svgContent += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="6" fill="${fill}" />`

    // Value sub-label
    const hasValue = !!item.value
    const textY = cy + (hasValue ? -8 : 0)
    if (lines.length === 1) {
      svgContent += `<text x="${x + nodeW / 2}" y="${textY}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${label}</text>`
    } else {
      lines.forEach((line, li) => {
        const ly = textY + (li - (lines.length - 1) / 2) * 14
        svgContent += `<text x="${x + nodeW / 2}" y="${ly}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`
      })
    }
    if (hasValue) {
      svgContent += `<text x="${x + nodeW / 2}" y="${cy + 10}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value!)}</text>`
    }

    // Arrow
    if (i < n - 1) {
      const ax = x + nodeW + 2
      const ay = cy
      svgContent += `<polygon points="${ax},${ay - 7} ${ax + ARROW_W - 2},${ay} ${ax},${ay + 7}" fill="${fill}" />`
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${spec.title ? `<text x="${W / 2}" y="16" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(spec.title)}</text>` : ''}
    ${svgContent}
  </svg>`
}

function renderVerticalProcess(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  const n = items.length
  const W = 400
  const ROW_H = 54
  const PAD = 16
  const NODE_W = 280
  const ARROW_H = 16
  const H = PAD + n * ROW_H + (n - 1) * ARROW_H + PAD
  const nodeX = (W - NODE_W) / 2

  let svgContent = ''

  for (let i = 0; i < n; i++) {
    const item = items[i]
    const t = n > 1 ? i / (n - 1) : 0.5
    const fill = lerpColor(theme.secondary, theme.primary, t)
    const y = PAD + i * (ROW_H + ARROW_H)
    const label = escapeXml(item.label)
    const cy = y + ROW_H / 2

    svgContent += `<rect x="${nodeX}" y="${y}" width="${NODE_W}" height="${ROW_H}" rx="6" fill="${fill}" />`
    svgContent += `<text x="${W / 2}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${label}</text>`

    if (i < n - 1) {
      const ay = y + ROW_H + 2
      svgContent += `<polygon points="${W / 2 - 8},${ay} ${W / 2 + 8},${ay} ${W / 2},${ay + ARROW_H - 2}" fill="${fill}" />`
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Funnel ────────────────────────────────────────────────────────────────────

function renderFunnel(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 420
  const STEP_H = 48
  const PAD = 20
  const H = PAD + n * STEP_H + PAD
  const maxW = 380
  const minW = 80

  let svgContent = ''

  for (let i = 0; i < n; i++) {
    const item = items[i]
    const t = i / (n - 1 || 1)
    const w = maxW - (maxW - minW) * t
    const x = (W - w) / 2
    const y = PAD + i * STEP_H
    const fill = lerpColor(theme.primary, theme.secondary, t)

    // Trapezoid: top edge wider than bottom (or same at last)
    const nextW = i < n - 1 ? maxW - (maxW - minW) * ((i + 1) / (n - 1 || 1)) : w
    const nextX = (W - nextW) / 2
    const points = `${x},${y} ${x + w},${y} ${nextX + nextW},${y + STEP_H} ${nextX},${y + STEP_H}`

    svgContent += `<polygon points="${points}" fill="${fill}" />`
    svgContent += `<text x="${W / 2}" y="${y + STEP_H / 2 + 5}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(item.label)}</text>`
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${spec.title ? `<text x="${W / 2}" y="15" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(spec.title)}</text>` : ''}
    ${svgContent}
  </svg>`
}

// ── Roadmap ───────────────────────────────────────────────────────────────────

function renderRoadmap(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = Math.max(500, n * 100 + 80)
  const H = 140
  const LINE_Y = 80
  const DOT_R = 8
  const PAD = 50
  const spacing = (W - PAD * 2) / (n - 1 || 1)

  let svgContent = ''

  // Road line
  svgContent += `<line x1="${PAD}" y1="${LINE_Y}" x2="${W - PAD}" y2="${LINE_Y}" stroke="${theme.border}" stroke-width="3" />`

  for (let i = 0; i < n; i++) {
    const item = items[i]
    const x = PAD + i * spacing
    const t = n > 1 ? i / (n - 1) : 0.5
    const fill = lerpColor(theme.secondary, theme.primary, t)
    const above = i % 2 === 0
    const labelY = above ? LINE_Y - 22 : LINE_Y + 36

    // Dot
    svgContent += `<circle cx="${x}" cy="${LINE_Y}" r="${DOT_R}" fill="${fill}" />`
    svgContent += `<circle cx="${x}" cy="${LINE_Y}" r="${DOT_R - 3}" fill="${theme.bg}" />`

    // Connector line
    const lineEndY = above ? LINE_Y - 14 : LINE_Y + 14
    svgContent += `<line x1="${x}" y1="${LINE_Y}" x2="${x}" y2="${lineEndY}" stroke="${fill}" stroke-width="1.5" stroke-dasharray="3,2" />`

    // Label
    const lines = wrapText(item.label, 12)
    lines.forEach((line, li) => {
      const ly = labelY + li * 13
      svgContent += `<text x="${x}" y="${ly}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`
    })

    if (item.value) {
      svgContent += `<text x="${x}" y="${labelY + lines.length * 13}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${spec.title ? `<text x="${W / 2}" y="16" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(spec.title)}</text>` : ''}
    ${svgContent}
  </svg>`
}

// ── Step-down / Step-up ───────────────────────────────────────────────────────
// Same-height boxes stacked diagonally; tiny L-shaped corner connectors.
// step-down: each box shifts right + down (top-left → bottom-right)
// step-up:   each box shifts right + up  (bottom-left → top-right)

function renderStepDown(spec: MdArtSpec, theme: MdArtTheme): string {
  return renderStaircase(spec, theme, false)
}
function renderStepUp(spec: MdArtSpec, theme: MdArtTheme): string {
  return renderStaircase(spec, theme, true)
}
function renderStaircase(spec: MdArtSpec, theme: MdArtTheme, ascending: boolean): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const W = 560
  const GAP_X = 6, GAP_Y = 6          // gap between boxes horizontally and vertically
  const BOX_W = Math.min(110, Math.floor((W - 16 - (n - 1) * GAP_X) / n))
  const BOX_H = 36
  const titleH = spec.title ? 28 : 8
  const totalDiagH = (n - 1) * (BOX_H + GAP_Y) + BOX_H
  const H = titleH + totalDiagH + 16
  const startX = 8

  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  items.forEach((item, i) => {
    const x = startX + i * (BOX_W + GAP_X)
    // step-down: y increases left→right; step-up: y decreases left→right
    const y = ascending
      ? titleH + 4 + (n - 1 - i) * (BOX_H + GAP_Y)
      : titleH + 4 + i * (BOX_H + GAP_Y)
    const t = n > 1 ? i / (n - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)

    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BOX_W}" height="${BOX_H}" rx="5" fill="${fill}33" stroke="${fill}" stroke-width="1.2"/>`)
    parts.push(`<text x="${(x + BOX_W / 2).toFixed(1)}" y="${(y + BOX_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, Math.floor(BOX_W / 6)))}</text>`)
    if (item.value) parts.push(`<text x="${(x + BOX_W / 2).toFixed(1)}" y="${(y + BOX_H / 2 + 16).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, Math.floor(BOX_W / 5)))}</text>`)

    // Tiny L-shaped connector to next box
    if (i < n - 1) {
      const nextY = ascending
        ? titleH + 4 + (n - 2 - i) * (BOX_H + GAP_Y)
        : titleH + 4 + (i + 1) * (BOX_H + GAP_Y)
      // For step-down: corner at (box.right, box.bottom) → right → nextBox.top-left
      // For step-up:   corner at (box.right, box.top)    → right → nextBox.bottom-left
      const cornerY = ascending ? y : y + BOX_H
      const nextCornerY = ascending ? nextY + BOX_H : nextY
      const nextX = x + BOX_W + GAP_X
      parts.push(`<polyline points="${(x + BOX_W).toFixed(1)},${cornerY} ${nextX},${cornerY} ${nextX},${nextCornerY}" fill="none" stroke="${theme.muted}" stroke-width="1.5"/>`)
    }
  })
  return svgWrap(W, H, theme, parts)
}

// ── Circle process ────────────────────────────────────────────────────────────
// Horizontal row of circles with arrows; label + value as subtitle in each

function renderCircleProcess(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const W = 560
  const R = Math.min(40, (W - 16) / n / 2 - 10)
  const titleH = spec.title ? 28 : 8
  const H = titleH + R * 2 + 20
  const spacing = (W - 16) / n
  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))
  parts.push(`<defs><marker id="cp-arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><polygon points="0,0 7,3.5 0,7" fill="${theme.muted}"/></marker></defs>`)

  items.forEach((item, i) => {
    const cx = 16 + i * spacing + spacing / 2
    const cy = titleH + R + 6
    const t = n > 1 ? i / (n - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${fill}33" stroke="${fill}" stroke-width="1.5"/>`)
    parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - (item.value ? 5 : 0)).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, Math.floor(R / 4)))}</text>`)
    if (item.value) parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 10).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, Math.floor(R / 3.5)))}</text>`)
    if (i < n - 1) {
      const x1 = cx + R + 2, x2 = cx + spacing - R - 6
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${theme.muted}" stroke-width="1.5" marker-end="url(#cp-arr)"/>`)
    }
  })
  return svgWrap(W, H, theme, parts)
}

// ── Equation ──────────────────────────────────────────────────────────────────
// A + B + … = Result. First N-1 items are operands; last item is the result.
// Children of each item displayed as sub-text.

function renderEquation(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const W = 560
  const CARD_H = 100, CARD_W = Math.min(110, (W - 16 - 24 * (n - 1)) / n)
  const titleH = spec.title ? 28 : 8
  const H = titleH + CARD_H + 16
  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  // Measure total width to center
  const opW = 24
  const total = n * CARD_W + (n - 1) * opW
  const startX = (W - total) / 2
  const cardY = titleH + 8

  items.forEach((item, i) => {
    const x = startX + i * (CARD_W + opW)
    const isResult = i === n - 1
    const t = n > 1 ? i / (n - 1) : 0
    const fill = isResult ? theme.accent : lerpColor(theme.primary, theme.secondary, t)
    // Card
    parts.push(`<rect x="${x.toFixed(1)}" y="${cardY.toFixed(1)}" width="${CARD_W.toFixed(1)}" height="${CARD_H}" rx="7" fill="${fill}22" stroke="${fill}88" stroke-width="1.5"/>`)
    // Colored header bar
    parts.push(`<rect x="${x.toFixed(1)}" y="${cardY.toFixed(1)}" width="${CARD_W.toFixed(1)}" height="22" rx="7 7 0 0" fill="${fill}"/>`)
    parts.push(`<rect x="${x.toFixed(1)}" y="${(cardY + 14).toFixed(1)}" width="${CARD_W.toFixed(1)}" height="8" fill="${fill}"/>`)
    parts.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(cardY + 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 14))}</text>`)
    // Children / value as sub-lines
    const subs = item.children.length ? item.children.map(c => c.label) : item.value ? [item.value] : []
    subs.slice(0, 3).forEach((s, si) => {
      parts.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(cardY + 40 + si * 16).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(s, 14))}</text>`)
    })
    // Operator between cards
    if (i < n - 1) {
      const op = i === n - 2 ? '=' : '+'
      const opX = x + CARD_W + opW / 2
      parts.push(`<text x="${opX.toFixed(1)}" y="${(cardY + CARD_H / 2 + 8).toFixed(1)}" text-anchor="middle" font-size="20" fill="${theme.muted}" font-family="system-ui,sans-serif" font-weight="300">${op}</text>`)
    }
  })
  return svgWrap(W, H, theme, parts)
}

// ── Bending process (snake) ───────────────────────────────────────────────────
// Multi-row snake: row 1 L→R, u-turn, row 2 R→L, etc.

function renderBendingProcess(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const COLS = Math.ceil(Math.sqrt(n * 1.5))
  const W = 560
  const BOX_W = (W - 16) / COLS - 6, BOX_H = 36, ROW_GAP = 24
  const rows = Math.ceil(n / COLS)
  const titleH = spec.title ? 28 : 8
  const H = titleH + rows * (BOX_H + ROW_GAP) + 8
  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))
  parts.push(`<defs>
    <marker id="bp-r" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="${theme.muted}"/></marker>
    <marker id="bp-l" markerWidth="6" markerHeight="6" refX="1" refY="3" orient="auto"><polygon points="6,0 0,3 6,6" fill="${theme.muted}"/></marker>
  </defs>`)

  const positions = items.map((_, i) => {
    const row = Math.floor(i / COLS)
    const col = row % 2 === 0 ? i % COLS : COLS - 1 - (i % COLS)
    const x = 8 + col * (BOX_W + 6)
    const y = titleH + 4 + row * (BOX_H + ROW_GAP)
    return { x, y }
  })

  items.forEach((item, i) => {
    const { x, y } = positions[i]
    const t = n > 1 ? i / (n - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    const isLast = i === n - 1
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BOX_W.toFixed(1)}" height="${BOX_H}" rx="5" fill="${isLast ? theme.accent + '33' : fill + '33'}" stroke="${isLast ? theme.accent : fill}" stroke-width="1.2"/>`)
    parts.push(`<text x="${(x + BOX_W / 2).toFixed(1)}" y="${(y + BOX_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, Math.floor(BOX_W / 6)))}</text>`)

    if (i < n - 1) {
      const next = positions[i + 1]
      const sameRow = Math.floor(i / COLS) === Math.floor((i + 1) / COLS)
      if (sameRow) {
        const row = Math.floor(i / COLS)
        const goRight = row % 2 === 0
        const marker = goRight ? 'url(#bp-r)' : 'url(#bp-l)'
        const x1 = goRight ? x + BOX_W + 2 : x - 2
        const x2 = goRight ? next.x - 4 : next.x + BOX_W + 4
        parts.push(`<line x1="${x1.toFixed(1)}" y1="${(y + BOX_H / 2).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y + BOX_H / 2).toFixed(1)}" stroke="${theme.muted}" stroke-width="1.2" marker-end="${marker}"/>`)
      } else {
        // U-turn: down from end of current row, across, up (or down) to next row
        const row = Math.floor(i / COLS)
        const goRight = row % 2 === 0
        const turnX = goRight ? x + BOX_W + 10 : x - 10
        const midY = y + BOX_H + ROW_GAP / 2
        parts.push(`<path d="M${(x + (goRight ? BOX_W : 0)).toFixed(1)},${(y + BOX_H / 2).toFixed(1)} Q${turnX.toFixed(1)},${(y + BOX_H / 2).toFixed(1)} ${turnX.toFixed(1)},${midY.toFixed(1)} Q${turnX.toFixed(1)},${(next.y + BOX_H / 2).toFixed(1)} ${(next.x + (goRight ? BOX_W : 0)).toFixed(1)},${(next.y + BOX_H / 2).toFixed(1)}" fill="none" stroke="${theme.muted}" stroke-width="1.2" marker-end="${goRight ? 'url(#bp-l)' : 'url(#bp-r)'}"/>`)
      }
    }
  })
  return svgWrap(W, H, theme, parts)
}

// ── Segmented bar ─────────────────────────────────────────────────────────────
// Horizontal bar divided into segments; item.value as % (e.g. "30%")

function renderSegmentedBar(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 560, BAR_H = 32, LABEL_H = 22
  const titleH = spec.title ? 28 : 8
  const H = titleH + BAR_H + LABEL_H + 20
  const BAR_Y = titleH + 12, PAD = 8
  const BAR_W = W - PAD * 2
  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  // Parse weights
  const weights = items.map(it => parseFloat(it.value ?? '') || 1)
  const total = weights.reduce((s, w) => s + w, 0)

  let curX = PAD
  items.forEach((item, i) => {
    const segW = (weights[i] / total) * BAR_W
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    const isFirst = i === 0, isLast = i === items.length - 1
    const rx = isFirst ? '5 0 0 5' : isLast ? '0 5 5 0' : '0'
    parts.push(`<rect x="${curX.toFixed(1)}" y="${BAR_Y}" width="${segW.toFixed(1)}" height="${BAR_H}" rx="${rx}" fill="${fill}"/>`)
    const lx = curX + segW / 2
    parts.push(`<text x="${lx.toFixed(1)}" y="${(BAR_Y + BAR_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, Math.floor(segW / 7)))}</text>`)
    // Percentage below
    parts.push(`<text x="${lx.toFixed(1)}" y="${(BAR_Y + BAR_H + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${fill}" font-family="system-ui,sans-serif">${item.value ?? Math.round(weights[i] / total * 100) + '%'}</text>`)
    curX += segW
  })
  return svgWrap(W, H, theme, parts)
}

// ── Phase process ─────────────────────────────────────────────────────────────
// Columns: top-level items = phase headers; children = task rows inside each column

function renderPhaseProcess(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = Math.min(items.length, 4)
  const W = 560, GAP = 6, HEADER_H = 24, ROW_H = 20
  const maxChildren = Math.max(...items.slice(0, n).map(it => it.children.length), 2)
  const COL_H = HEADER_H + maxChildren * ROW_H + 12
  const COL_W = (W - (n - 1) * GAP) / n
  const titleH = spec.title ? 28 : 8
  const H = titleH + COL_H + 8
  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  items.slice(0, n).forEach((item, i) => {
    const x = i * (COL_W + GAP), y = titleH
    const t = n > 1 ? i / (n - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${COL_W.toFixed(1)}" height="${COL_H}" rx="6" fill="${theme.surface}" stroke="${fill}55" stroke-width="1"/>`)
    // Header
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${COL_W.toFixed(1)}" height="${HEADER_H}" rx="6 6 0 0" fill="${fill}"/>`)
    parts.push(`<rect x="${x.toFixed(1)}" y="${(y + HEADER_H - 6).toFixed(1)}" width="${COL_W.toFixed(1)}" height="6" fill="${fill}"/>`)
    parts.push(`<text x="${(x + COL_W / 2).toFixed(1)}" y="${(y + HEADER_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, Math.floor(COL_W / 6)))}</text>`)
    // Task rows
    item.children.slice(0, maxChildren).forEach((child, ci) => {
      const ry = y + HEADER_H + ci * ROW_H + 6
      parts.push(`<rect x="${(x + 4).toFixed(1)}" y="${ry.toFixed(1)}" width="${(COL_W - 8).toFixed(1)}" height="${ROW_H - 2}" rx="3" fill="${fill}22"/>`)
      parts.push(`<text x="${(x + COL_W / 2).toFixed(1)}" y="${(ry + ROW_H / 2 + 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(child.label, Math.floor(COL_W / 5.5)))}</text>`)
    })
  })
  return svgWrap(W, H, theme, parts)
}

// ── Timeline horizontal ───────────────────────────────────────────────────────
// Horizontal spine, alternating labels above/below; label as date, value as event name

function renderTimelineH(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const W = 560, SPINE_Y = 80
  const titleH = spec.title ? 28 : 0
  const H = titleH + 110
  const PAD = 30
  const spacing = (W - PAD * 2) / Math.max(n - 1, 1)
  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))
  const sy = SPINE_Y + titleH
  // Spine
  parts.push(`<line x1="${PAD}" y1="${sy}" x2="${W - PAD}" y2="${sy}" stroke="${theme.border}" stroke-width="2"/>`)
  parts.push(`<polygon points="${(W-PAD-2).toFixed(1)},${(sy-5).toFixed(1)} ${(W-PAD+6).toFixed(1)},${sy} ${(W-PAD-2).toFixed(1)},${(sy+5).toFixed(1)}" fill="${theme.border}"/>`)
  items.forEach((item, i) => {
    const x = n === 1 ? W / 2 : PAD + i * spacing
    const t = n > 1 ? i / (n - 1) : 0
    const fill = i === n - 1 ? theme.accent : lerpColor(theme.primary, theme.secondary, t)
    const above = i % 2 === 0
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${sy}" r="6" fill="${fill}"/>`)
    if (above) {
      parts.push(`<line x1="${x.toFixed(1)}" y1="${(sy - 6).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(sy - 18).toFixed(1)}" stroke="${fill}" stroke-width="1"/>`)
      parts.push(`<text x="${x.toFixed(1)}" y="${(sy - 22).toFixed(1)}" text-anchor="middle" font-size="9" fill="${fill}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 10))}</text>`)
      if (item.value) parts.push(`<text x="${x.toFixed(1)}" y="${(sy - 34).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 12))}</text>`)
    } else {
      parts.push(`<line x1="${x.toFixed(1)}" y1="${(sy + 6).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(sy + 18).toFixed(1)}" stroke="${fill}" stroke-width="1"/>`)
      parts.push(`<text x="${x.toFixed(1)}" y="${(sy + 30).toFixed(1)}" text-anchor="middle" font-size="9" fill="${fill}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 10))}</text>`)
      if (item.value) parts.push(`<text x="${x.toFixed(1)}" y="${(sy + 42).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 12))}</text>`)
    }
  })
  return svgWrap(W, H, theme, parts)
}

// ── Timeline vertical ─────────────────────────────────────────────────────────
// Vertical spine on left; dots with date (value) on left + title + children on right

function renderTimelineV(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const n = items.length
  const W = 560, ROW_H = 48, SPINE_X = 72, DOT_R = 7
  const titleH = spec.title ? 28 : 8
  const H = titleH + n * ROW_H + 8
  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))
  // Spine
  parts.push(`<line x1="${SPINE_X}" y1="${titleH + DOT_R}" x2="${SPINE_X}" y2="${titleH + (n - 1) * ROW_H + ROW_H / 2}" stroke="${theme.border}" stroke-width="2"/>`)
  parts.push(`<polygon points="${(SPINE_X - 5).toFixed(1)},${(titleH + (n-1)*ROW_H + ROW_H/2 - 2).toFixed(1)} ${(SPINE_X + 5).toFixed(1)},${(titleH + (n-1)*ROW_H + ROW_H/2 - 2).toFixed(1)} ${SPINE_X},${(titleH + (n-1)*ROW_H + ROW_H/2 + 6).toFixed(1)}" fill="${theme.border}"/>`)
  items.forEach((item, i) => {
    const cy = titleH + i * ROW_H + ROW_H / 2
    const t = n > 1 ? i / (n - 1) : 0
    const fill = i === n - 1 ? theme.accent : lerpColor(theme.primary, theme.secondary, t)
    parts.push(`<circle cx="${SPINE_X}" cy="${cy.toFixed(1)}" r="${DOT_R}" fill="${fill}"/>`)
    // Date label (value) on left
    if (item.value) parts.push(`<text x="${(SPINE_X - DOT_R - 4).toFixed(1)}" y="${(cy + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`)
    // Title on right
    parts.push(`<text x="${(SPINE_X + DOT_R + 8).toFixed(1)}" y="${(cy - 4).toFixed(1)}" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 36))}</text>`)
    // Children as detail lines
    const detail = item.children.map(c => c.label).join(' · ')
    if (detail) parts.push(`<text x="${(SPINE_X + DOT_R + 8).toFixed(1)}" y="${(cy + 11).toFixed(1)}" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(detail, 48))}</text>`)
  })
  return svgWrap(W, H, theme, parts)
}

// ── Swimlane ──────────────────────────────────────────────────────────────────
// Horizontal lanes; top-level items = lanes, children = steps within each lane

function renderSwimlane(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)
  const W = 560
  const LABEL_W = 56, LANE_H = 44, GAP = 1
  const titleH = spec.title ? 28 : 8
  const H = titleH + items.length * (LANE_H + GAP) + 8
  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))
  parts.push(`<defs><marker id="sl-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="${theme.muted}"/></marker></defs>`)

  items.forEach((item, i) => {
    const y = titleH + i * (LANE_H + GAP)
    const t = items.length > 1 ? i / (items.length - 1) : 0
    const fill = lerpColor(theme.primary, theme.secondary, t)
    // Lane background
    parts.push(`<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${LANE_H}" fill="${fill}0a"/>`)
    if (i > 0) parts.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="${theme.border}" stroke-width="0.5"/>`)
    // Lane label
    parts.push(`<rect x="2" y="${(y + 2).toFixed(1)}" width="${LABEL_W - 4}" height="${LANE_H - 4}" rx="4" fill="${fill}33" stroke="${fill}66" stroke-width="1"/>`)
    parts.push(`<text x="${(LABEL_W / 2).toFixed(1)}" y="${(y + LANE_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 9))}</text>`)
    // Steps (children)
    const steps = item.children
    const stepW = steps.length > 0 ? Math.min(90, (W - LABEL_W - 8) / steps.length - 6) : 0
    const stepGap = steps.length > 1 ? ((W - LABEL_W - 8) - steps.length * stepW) / (steps.length - 1) : 0
    steps.forEach((step, si) => {
      const sx = LABEL_W + 4 + si * (stepW + stepGap)
      const sy = y + (LANE_H - 28) / 2
      const isDone = step.attrs.includes('done')
      const stepFill = isDone ? theme.accent : fill
      parts.push(`<rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${stepW.toFixed(1)}" height="28" rx="4" fill="${stepFill}${isDone ? '44' : '22'}" stroke="${stepFill}${isDone ? '99' : '66'}" stroke-width="1"/>`)
      parts.push(`<text x="${(sx + stepW / 2).toFixed(1)}" y="${(sy + 17).toFixed(1)}" text-anchor="middle" font-size="9" fill="${isDone ? theme.text : theme.textMuted}" font-family="system-ui,sans-serif" font-weight="${isDone ? '600' : '400'}">${escapeXml(truncate(step.label, Math.floor(stepW / 5)))}</text>`)
      if (si < steps.length - 1) {
        const ax1 = sx + stepW + 2, ax2 = sx + stepW + stepGap - 4
        parts.push(`<line x1="${ax1.toFixed(1)}" y1="${(sy + 14).toFixed(1)}" x2="${ax2.toFixed(1)}" y2="${(sy + 14).toFixed(1)}" stroke="${theme.muted}" stroke-width="1" marker-end="url(#sl-arr)"/>`)
      }
    })
  })
  return svgWrap(W, H, theme, parts)
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function titleEl(W: number, title: string, theme: MdArtTheme): string {
  return `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>`
}

function svgWrap(W: number, H: number, theme: MdArtTheme, parts: string[]): string {
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
