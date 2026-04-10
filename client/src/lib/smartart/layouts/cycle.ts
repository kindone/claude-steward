import type { SmartArtSpec } from '../parser'
import type { SmartArtTheme } from '../theme'

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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function titleEl(W: number, title: string, theme: SmartArtTheme): string {
  return `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>`
}

function svgWrap(W: number, H: number, theme: SmartArtTheme, parts: string[]): string {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join('\n    ')}
  </svg>`
}

export function renderCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'donut-cycle':           return renderDonutCycle(spec, theme)
    case 'block-cycle':           return renderBlockCycle(spec, theme)
    case 'segmented-cycle':       return renderSegmentedCycle(spec, theme)
    case 'nondirectional-cycle':  return renderNondirectionalCycle(spec, theme)
    case 'multidirectional-cycle':return renderMultidirectionalCycle(spec, theme)
    case 'spiral':                return renderSpiral(spec, theme)
    case 'loop':                  return renderLoop(spec, theme)
    case 'gear-cycle':            return renderGearCycle(spec, theme)
    default:                      return renderCircleCycle(spec, theme)
  }
}

// ── Circle cycle ──────────────────────────────────────────────────────────────

function renderCircleCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 500
  const H = 400
  const cx = W / 2
  const cy = H / 2
  const R = 140     // orbit radius
  const NODE_W = 100
  const NODE_H = 44

  // Arrowhead marker (recolor per-arrow via CSS filter is complex; use a neutral muted colour)
  let svgContent = `<defs>
    <marker id="cycle-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="${theme.muted}"/>
    </marker>
  </defs>`

  // Draw curved arrows first (below nodes)
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    const nextAngle = (2 * Math.PI * ((i + 1) % n)) / n - Math.PI / 2

    const x1 = cx + R * Math.cos(angle)
    const y1 = cy + R * Math.sin(angle)
    const x2 = cx + R * Math.cos(nextAngle)
    const y2 = cy + R * Math.sin(nextAngle)

    // Mid-angle control point (curved outward).
    // Unwrap nextAngle when the arc wraps past 2π (last → first node), so the
    // average always falls on the outer arc, not through the centre.
    const unwrappedNext = nextAngle < angle ? nextAngle + 2 * Math.PI : nextAngle
    const midAngle = (angle + unwrappedNext) / 2
    const controlR = R * 1.3
    const qx = cx + controlR * Math.cos(midAngle)
    const qy = cy + controlR * Math.sin(midAngle)

    // Shorten path endpoints so they start/end at node edges, not centres.
    // For a rectangle of half-size (hw, hh), the edge distance in direction (dx,dy)
    // is min(hw/|dx|, hh/|dy|) — i.e. whichever face is hit first.
    const rectEdge = (dx: number, dy: number) => {
      const adx = Math.abs(dx), ady = Math.abs(dy)
      const hw = NODE_W / 2, hh = NODE_H / 2
      if (adx < 1e-9) return hh
      if (ady < 1e-9) return hw
      return Math.min(hw / adx, hh / ady)
    }
    const s2c = Math.hypot(qx - x1, qy - y1) || 1
    const sdx = (qx - x1) / s2c, sdy = (qy - y1) / s2c
    const sEdge = rectEdge(sdx, sdy) + 3
    const sx = x1 + sdx * sEdge
    const sy = y1 + sdy * sEdge
    const c2e = Math.hypot(x2 - qx, y2 - qy) || 1
    const edx = (x2 - qx) / c2e, edy = (y2 - qy) / c2e
    const eEdge = rectEdge(edx, edy) + 6  // +6 so marker clears the node border
    const ex = x2 - edx * eEdge
    const ey = y2 - edy * eEdge

    const t = i / (n - 1 || 1)
    const arrowColor = lerpColor(theme.secondary, theme.primary, t)

    // Curved path with arrowhead at destination edge
    svgContent += `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${arrowColor}" stroke-width="1.5" stroke-dasharray="4,2" marker-end="url(#cycle-arr)"/>`
  }

  // Draw nodes
  for (let i = 0; i < n; i++) {
    const item = items[i]
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    const nx = cx + R * Math.cos(angle)
    const ny = cy + R * Math.sin(angle)
    const t = i / (n - 1 || 1)
    const fill = lerpColor(theme.secondary, theme.primary, t)

    svgContent += `<rect x="${nx - NODE_W / 2}" y="${ny - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fill}" />`

    const lines = item.label.length > 14 ? [item.label.slice(0, 12) + '…'] : [item.label]
    lines.forEach((line, li) => {
      const ly = ny + (li - (lines.length - 1) / 2) * 14 + 5
      svgContent += `<text x="${nx}" y="${ly}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`
    })
  }

  // Title in center
  if (spec.title) {
    svgContent += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(spec.title)}</text>`
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Donut cycle ───────────────────────────────────────────────────────────────

function renderDonutCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 400
  const H = 360
  const cx = W / 2
  const cy = H / 2
  const outerR = 140
  const innerR = 70
  const GAP_ANGLE = 0.03  // radians gap between wedges

  let svgContent = ''

  for (let i = 0; i < n; i++) {
    const item = items[i]
    const startAngle = (2 * Math.PI * i) / n - Math.PI / 2 + GAP_ANGLE / 2
    const endAngle = (2 * Math.PI * (i + 1)) / n - Math.PI / 2 - GAP_ANGLE / 2
    const t = i / (n - 1 || 1)
    const fill = lerpColor(theme.secondary, theme.primary, t)

    const x1 = cx + innerR * Math.cos(startAngle)
    const y1 = cy + innerR * Math.sin(startAngle)
    const x2 = cx + outerR * Math.cos(startAngle)
    const y2 = cy + outerR * Math.sin(startAngle)
    const x3 = cx + outerR * Math.cos(endAngle)
    const y3 = cy + outerR * Math.sin(endAngle)
    const x4 = cx + innerR * Math.cos(endAngle)
    const y4 = cy + innerR * Math.sin(endAngle)

    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

    const path = `M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1} ${y1} Z`
    svgContent += `<path d="${path}" fill="${fill}" />`

    // Label at wedge midpoint
    const midAngle = (startAngle + endAngle) / 2
    const labelR = (outerR + innerR) / 2
    const lx = cx + labelR * Math.cos(midAngle)
    const ly = cy + labelR * Math.sin(midAngle)
    const truncated = item.label.length > 10 ? item.label.slice(0, 9) + '…' : item.label
    svgContent += `<text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncated)}</text>`
  }

  // Center label
  if (spec.title) {
    svgContent += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Gear cycle ────────────────────────────────────────────────────────────────

function gearPath(cx: number, cy: number, outerR: number, innerR: number, teeth: number, phase: number): string {
  const points: string[] = []
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = phase + (Math.PI / teeth) * i
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return 'M ' + points.join(' L ') + ' Z'
}

function renderGearCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 500
  const H = 380
  const cx = W / 2
  const cy = H / 2
  const parts: string[] = []

  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  if (n === 1) {
    const item = items[0]
    const fill = theme.primary
    parts.push(`<path d="${gearPath(cx, cy, 90, 68, 12, 0)}" fill="${fill}" opacity="0.8"/>`)
    parts.push(`<circle cx="${cx}" cy="${cy}" r="52" fill="${theme.bg}"/>`)
    parts.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 12))}</text>`)
    if (item.value) {
      parts.push(`<text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 12))}</text>`)
    }
  } else if (n === 2) {
    const outerR = 90, innerR = 68, teeth = 12
    const gapX = outerR * 1.85
    const positions = [cx - gapX / 2, cx + gapX / 2]
    positions.forEach((gx, i) => {
      const item = items[i]
      const t = i / (n - 1 || 1)
      const fill = lerpColor(theme.primary, theme.secondary, t)
      const phase = i * (Math.PI / teeth) // alternate phase so teeth interlock visually
      parts.push(`<path d="${gearPath(gx, cy, outerR, innerR, teeth, phase)}" fill="${fill}" opacity="0.8"/>`)
      parts.push(`<circle cx="${gx}" cy="${cy}" r="52" fill="${theme.bg}"/>`)
      parts.push(`<text x="${gx}" y="${cy + (item.value ? -3 : 5)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 12))}</text>`)
      if (item.value) {
        parts.push(`<text x="${gx}" y="${cy + 13}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 12))}</text>`)
      }
    })
  } else if (n === 3) {
    // Large center gear + 2 smaller side gears at ±120°
    const centerFill = theme.primary
    parts.push(`<path d="${gearPath(cx, cy, 80, 60, 12, 0)}" fill="${centerFill}" opacity="0.8"/>`)
    parts.push(`<circle cx="${cx}" cy="${cy}" r="46" fill="${theme.bg}"/>`)
    parts.push(`<text x="${cx}" y="${cy + (items[0].value ? -3 : 5)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(items[0].label, 12))}</text>`)
    if (items[0].value) {
      parts.push(`<text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(items[0].value, 12))}</text>`)
    }
    const sideAngles = [-Math.PI / 3, Math.PI / 3] // 60° left and right
    // distance between center of large and small gear so they nearly touch
    const dist = 80 + 55 - 5
    ;[1, 2].forEach((idx, si) => {
      const item = items[idx]
      const t = idx / (n - 1)
      const fill = lerpColor(theme.primary, theme.secondary, t)
      const angle = sideAngles[si]
      const gx = cx + dist * Math.cos(angle)
      const gy = cy + dist * Math.sin(angle)
      const phase = Math.PI / 8 // offset phase
      parts.push(`<path d="${gearPath(gx, gy, 55, 40, 8, phase)}" fill="${fill}" opacity="0.8"/>`)
      parts.push(`<circle cx="${gx}" cy="${gy}" r="32" fill="${theme.bg}"/>`)
      parts.push(`<text x="${gx}" y="${gy + (item.value ? -3 : 5)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 10))}</text>`)
      if (item.value) {
        parts.push(`<text x="${gx}" y="${gy + 12}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 10))}</text>`)
      }
    })
  } else {
    // n>=4: arrange in circular orbit
    const R = 130
    const outerR = 44, innerR = 32, teeth = 8
    for (let i = 0; i < n; i++) {
      const item = items[i]
      const angle = (2 * Math.PI * i) / n - Math.PI / 2
      const gx = cx + R * Math.cos(angle)
      const gy = cy + R * Math.sin(angle)
      const t = i / (n - 1 || 1)
      const fill = lerpColor(theme.primary, theme.secondary, t)
      const phase = i * (Math.PI / (teeth * n))
      parts.push(`<path d="${gearPath(gx, gy, outerR, innerR, teeth, phase)}" fill="${fill}" opacity="0.8"/>`)
      parts.push(`<circle cx="${gx}" cy="${gy}" r="24" fill="${theme.bg}"/>`)
      parts.push(`<text x="${gx}" y="${gy + (item.value ? -3 : 5)}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 10))}</text>`)
      if (item.value) {
        parts.push(`<text x="${gx}" y="${gy + 11}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 10))}</text>`)
      }
    }
  }

  return svgWrap(W, H, theme, parts)
}

// ── Block cycle ───────────────────────────────────────────────────────────────

function renderBlockCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  // For odd n, fall back to circle cycle
  const n = items.length
  if (n % 2 !== 0) return renderCircleCycle(spec, theme)

  const W = 560
  const topN = n / 2
  const COLS = topN
  const BOX_W = Math.floor((W - 16 - (COLS - 1) * 10) / COLS)
  const BOX_H = 68
  const HEADER_H = 20
  const GAP_X = 10
  const GAP_Y = 28
  const titleH = spec.title ? 28 : 8
  const H = titleH + 2 * BOX_H + GAP_Y + 8

  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  // Arrowhead marker
  parts.push(`<defs>
    <marker id="bc-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="${theme.primary}"/>
    </marker>
  </defs>`)

  const rowY = [titleH, titleH + BOX_H + GAP_Y]

  // Calculate box positions
  const boxPos: Array<{ x: number; y: number; col: number; row: number }> = []

  // Top row: items 0..topN-1 left to right
  for (let col = 0; col < COLS; col++) {
    const x = 8 + col * (BOX_W + GAP_X)
    boxPos.push({ x, y: rowY[0], col, row: 0 })
  }
  // Bottom row: items topN..n-1 right to left
  for (let col = COLS - 1; col >= 0; col--) {
    const x = 8 + col * (BOX_W + GAP_X)
    boxPos.push({ x, y: rowY[1], col, row: 1 })
  }

  // Draw boxes
  for (let i = 0; i < n; i++) {
    const item = items[i]
    const { x, y } = boxPos[i]
    const t = i / (n - 1 || 1)
    const headerFill = lerpColor(theme.primary, theme.secondary, t)

    // Box bg
    parts.push(`<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="5" fill="${theme.surface}" stroke="${headerFill}" stroke-opacity="0.55" stroke-width="1"/>`)
    // Colored header (top corners rounded)
    parts.push(`<path d="M ${x + 5} ${y} L ${x + BOX_W - 5} ${y} Q ${x + BOX_W} ${y} ${x + BOX_W} ${y + 5} L ${x + BOX_W} ${y + HEADER_H} L ${x} ${y + HEADER_H} L ${x} ${y + 5} Q ${x} ${y} ${x + 5} ${y} Z" fill="${headerFill}"/>`)
    // Header text
    parts.push(`<text x="${x + BOX_W / 2}" y="${y + HEADER_H - 5}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 16))}</text>`)

    // Body content: children or value
    const bodyLines: string[] = item.children.length > 0
      ? item.children.slice(0, 2).map(c => truncate(c.label, 18))
      : (item.value ? [truncate(item.value, 18)] : [])

    bodyLines.forEach((line, li) => {
      parts.push(`<text x="${x + 6}" y="${y + HEADER_H + 14 + li * 13}" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(line)}</text>`)
    })
  }

  // Draw arrows between consecutive items (clockwise)
  for (let i = 0; i < n; i++) {
    const from = boxPos[i]
    const to = boxPos[(i + 1) % n]

    if (from.row === to.row) {
      // Same row: horizontal arrow
      let x1: number, x2: number, arrowY: number
      if (from.x < to.x) {
        // left to right
        x1 = from.x + BOX_W + 2
        x2 = to.x - 6
        arrowY = from.y + BOX_H / 2
      } else {
        // right to left
        x1 = from.x - 2
        x2 = to.x + BOX_W + 6
        arrowY = from.y + BOX_H / 2
      }
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${arrowY.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${arrowY.toFixed(1)}" stroke="${theme.primary}" stroke-width="1.5" marker-end="url(#bc-arr)"/>`)
    } else {
      // Different rows: vertical arrow (transition between rows)
      // For top row last item going to bottom row first item (which is rightmost col)
      // and bottom row last item going back to top row first item
      const colCenter = from.x + BOX_W / 2
      let y1: number, y2: number
      if (from.row === 0) {
        // going down
        y1 = from.y + BOX_H + 2
        y2 = to.y - 6
      } else {
        // going up
        y1 = from.y - 2
        y2 = to.y + BOX_H + 6
      }
      parts.push(`<line x1="${colCenter.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${colCenter.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${theme.primary}" stroke-width="1.5" marker-end="url(#bc-arr)"/>`)
    }
  }

  return svgWrap(W, H, theme, parts)
}

// ── Segmented cycle ───────────────────────────────────────────────────────────

function renderSegmentedCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 440
  const H = 380
  const cx = W / 2
  const cy = H / 2
  const outerR = 120
  const innerR = 60
  const labelR = outerR + 20
  const connectorR = outerR + 5
  const GAP_ANGLE = 0.03

  const parts: string[] = []
  if (spec.title) {
    parts.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`)
  }

  for (let i = 0; i < n; i++) {
    const item = items[i]
    const startAngle = (2 * Math.PI * i) / n - Math.PI / 2 + GAP_ANGLE / 2
    const endAngle = (2 * Math.PI * (i + 1)) / n - Math.PI / 2 - GAP_ANGLE / 2
    const t = i / (n - 1 || 1)
    const fill = lerpColor(theme.secondary, theme.primary, t)

    const x1 = cx + innerR * Math.cos(startAngle)
    const y1 = cy + innerR * Math.sin(startAngle)
    const x2 = cx + outerR * Math.cos(startAngle)
    const y2 = cy + outerR * Math.sin(startAngle)
    const x3 = cx + outerR * Math.cos(endAngle)
    const y3 = cy + outerR * Math.sin(endAngle)
    const x4 = cx + innerR * Math.cos(endAngle)
    const y4 = cy + innerR * Math.sin(endAngle)

    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

    const path = `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x3.toFixed(1)} ${y3.toFixed(1)} L ${x4.toFixed(1)} ${y4.toFixed(1)} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`
    parts.push(`<path d="${path}" fill="${fill}" />`)

    // Label OUTSIDE the wedge
    const midAngle = (startAngle + endAngle) / 2
    const lx = cx + labelR * Math.cos(midAngle)
    const ly = cy + labelR * Math.sin(midAngle)
    const cosA = Math.cos(midAngle)
    const anchor = cosA > 0.3 ? 'start' : cosA < -0.3 ? 'end' : 'middle'
    const labelText = truncate(item.label, 14)

    // Connector line from outer edge to label
    const cx1 = cx + connectorR * Math.cos(midAngle)
    const cy1 = cy + connectorR * Math.sin(midAngle)
    parts.push(`<line x1="${cx1.toFixed(1)}" y1="${cy1.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${fill}" stroke-width="1" opacity="0.7"/>`)
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(labelText)}</text>`)
  }

  return svgWrap(W, H, theme, parts)
}

// ── Nondirectional cycle ──────────────────────────────────────────────────────

function renderNondirectionalCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 440
  const H = 400
  const cx = W / 2
  const cy = H / 2
  const R = 145
  const nodeR = 22

  const parts: string[] = []

  // Track ring
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${theme.border}" stroke-width="14" opacity="0.4"/>`)

  // Center title
  if (spec.title) {
    parts.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(spec.title)}</text>`)
  }

  // Nodes on track
  for (let i = 0; i < n; i++) {
    const item = items[i]
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    const nx = cx + R * Math.cos(angle)
    const ny = cy + R * Math.sin(angle)
    const t = i / (n - 1 || 1)
    const fill = lerpColor(theme.primary, theme.secondary, t)

    parts.push(`<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${nodeR}" fill="${fill}"/>`)
    parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + (item.value ? -3 : 4)).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 10))}</text>`)
    if (item.value) {
      parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + 9).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.bg}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.value, 10))}</text>`)
    }
  }

  return svgWrap(W, H, theme, parts)
}

// ── Multidirectional cycle ────────────────────────────────────────────────────

function renderMultidirectionalCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 440
  const H = 400
  const cx = W / 2
  const cy = H / 2
  const R = 150
  const nodeR = 20

  const parts: string[] = []

  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  // Calculate node positions
  const positions: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    positions.push({ x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) })
  }

  // Draw all connections behind nodes
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = positions[i]
      const b = positions[j]
      parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${theme.muted}" stroke-width="1" opacity="0.6"/>`)
    }
  }

  // Draw nodes on top
  for (let i = 0; i < n; i++) {
    const item = items[i]
    const { x, y } = positions[i]
    const t = i / (n - 1 || 1)
    const fill = lerpColor(theme.primary, theme.secondary, t)

    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${nodeR}" fill="${fill}" stroke="${theme.bg}" stroke-width="2"/>`)
    parts.push(`<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 10))}</text>`)
  }

  return svgWrap(W, H, theme, parts)
}

// ── Spiral ────────────────────────────────────────────────────────────────────

function renderSpiral(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 500
  const H = 420
  const cx = W / 2
  const cy = H / 2 + 10
  const innerR = 20
  const outerR = 170
  const turns = n <= 4 ? 2 : 2.5
  const SAMPLES = 200

  const parts: string[] = []

  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  // Generate spiral path
  const spiralPoints: string[] = []
  for (let s = 0; s <= SAMPLES; s++) {
    const theta = (s / SAMPLES) * turns * 2 * Math.PI
    const r = innerR + (outerR - innerR) * theta / (turns * 2 * Math.PI)
    const x = cx + r * Math.cos(theta)
    const y = cy + r * Math.sin(theta)
    spiralPoints.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  parts.push(`<polyline points="${spiralPoints.join(' ')}" fill="none" stroke="${theme.border}" stroke-width="2" opacity="0.5"/>`)

  // Place milestones evenly along spiral
  for (let k = 0; k < n; k++) {
    const theta = n > 1 ? k * (turns * 2 * Math.PI) / (n - 1) : 0
    const r = innerR + (outerR - innerR) * theta / (turns * 2 * Math.PI)
    const mx = cx + r * Math.cos(theta)
    const my = cy + r * Math.sin(theta)
    const t = k / (n - 1 || 1)
    const isLast = k === n - 1
    const dotR = isLast ? 9 : 7
    const fill = isLast ? theme.accent : lerpColor(theme.primary, theme.secondary, t)

    parts.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${dotR}" fill="${fill}"/>`)

    // Label on alternating sides
    const cosTheta = Math.cos(theta)
    const labelX = cosTheta >= 0 ? mx + dotR + 4 : mx - dotR - 4
    const anchor = cosTheta >= 0 ? 'start' : 'end'
    parts.push(`<text x="${labelX.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(items[k].label, 14))}</text>`)
  }

  return svgWrap(W, H, theme, parts)
}

// ── Loop (figure-8) ───────────────────────────────────────────────────────────

function renderLoop(spec: SmartArtSpec, theme: SmartArtTheme): string {
  // Figure-8 (loop): two overlapping circles. Left items on outer-left half (π/2→3π/2).
  // Right items on outer-right half (−π/2→π/2). Solid outer arcs show primary flow;
  // dashed inner arcs cross through the overlap zone for the figure-8 return path.
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const W = 520, H = 340
  const titleH = spec.title ? 30 : 10
  const cy = titleH + (H - titleH) / 2
  const loopR = 108
  // Circles overlap at center (~58 px overlap on each side)
  const leftCx  = W / 2 - loopR * 0.75
  const rightCx = W / 2 + loopR * 0.75
  const nodeR = 16
  const arcR     = loopR - 4
  const angClear = (nodeR + 6) / arcR

  const leftCount  = Math.ceil(n / 2)
  const rightCount = n - leftCount
  const leftItems  = items.slice(0, leftCount)
  const rightItems = items.slice(leftCount)

  // Left items: spread outer (left) half π/2 (bottom) → 3π/2 (top).
  // CW arc π/2→3π/2 passes through π (leftmost) = outer side ✓
  const leftAngles = leftItems.map((_, i) =>
    Math.PI / 2 + (Math.PI * i) / Math.max(leftCount - 1, 1))
  const leftAnglesFinal = leftCount === 1 ? [Math.PI] : leftAngles

  // Right items: spread outer (right) half −π/2 (top) → π/2 (bottom).
  // CW arc −π/2→π/2 passes through 0 (rightmost) = outer side ✓
  const rightAngles = rightItems.map((_, i) =>
    -Math.PI / 2 + (Math.PI * i) / Math.max(rightCount - 1, 1))
  const rightAnglesFinal = rightCount === 1 ? [0] : rightAngles

  // CW arc (sweep=1) with angular clearance; dashed=true for inner return arcs
  const cwArc = (cx: number, a1: number, a2: number, color: string, marker: string, dashed = false): string => {
    const sa = a1 + angClear
    const ea = a2 - angClear
    const span = ((ea - sa) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
    if (span < 0.1) return ''
    const sx = cx + arcR * Math.cos(sa), sy = cy + arcR * Math.sin(sa)
    const ex = cx + arcR * Math.cos(ea), ey = cy + arcR * Math.sin(ea)
    const large = span > Math.PI ? 1 : 0
    const dash  = dashed ? ' stroke-dasharray="5,4" opacity="0.55"' : ''
    return `<path d="M${sx.toFixed(1)},${sy.toFixed(1)} A${arcR},${arcR} 0 ${large} 1 ${ex.toFixed(1)},${ey.toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.8"${dash} marker-end="url(#${marker})"/>`
  }

  const parts: string[] = []
  if (spec.title) parts.push(titleEl(W, spec.title, theme))

  parts.push(`<defs>
    <marker id="lp-a" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L7,4 L0,8 Z" fill="${theme.primary}dd"/>
    </marker>
    <marker id="lp-b" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L7,4 L0,8 Z" fill="${theme.secondary}dd"/>
    </marker>
    <marker id="lp-ad" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L7,4 L0,8 Z" fill="${theme.primary}99"/>
    </marker>
    <marker id="lp-bd" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L7,4 L0,8 Z" fill="${theme.secondary}99"/>
    </marker>
  </defs>`)

  // Background circles (overlapping)
  parts.push(`<circle cx="${leftCx.toFixed(1)}"  cy="${cy}" r="${loopR}" fill="${theme.primary}08"   stroke="${theme.primary}35"   stroke-width="1.5"/>`)
  parts.push(`<circle cx="${rightCx.toFixed(1)}" cy="${cy}" r="${loopR}" fill="${theme.secondary}08" stroke="${theme.secondary}35" stroke-width="1.5"/>`)

  // Left loop: solid outer arcs, then dashed inner return through overlap zone
  if (leftAnglesFinal.length >= 2) {
    for (let i = 0; i + 1 < leftAnglesFinal.length; i++) {
      parts.push(cwArc(leftCx, leftAnglesFinal[i], leftAnglesFinal[i + 1], theme.primary, 'lp-a'))
    }
    // Return: CW from top (3π/2) → bottom (π/2 + 2π), passing through 0 (crossing zone)
    const topA = leftAnglesFinal[leftAnglesFinal.length - 1]
    const botA = leftAnglesFinal[0]
    parts.push(cwArc(leftCx, topA, botA + 2 * Math.PI, theme.primary, 'lp-ad', true))
  } else {
    // Single item: near-complete CW loop as hint
    const a = leftAnglesFinal[0]
    parts.push(cwArc(leftCx, a, a + 2 * Math.PI, theme.primary, 'lp-ad', true))
  }

  // Right loop: solid outer arcs, then dashed inner return through overlap zone
  if (rightAnglesFinal.length >= 2) {
    for (let i = 0; i + 1 < rightAnglesFinal.length; i++) {
      parts.push(cwArc(rightCx, rightAnglesFinal[i], rightAnglesFinal[i + 1], theme.secondary, 'lp-b'))
    }
    // Return: CW from bottom (π/2) → top (−π/2 + 2π = 3π/2), passing through π (crossing zone)
    const topA = rightAnglesFinal[0]
    const botA = rightAnglesFinal[rightAnglesFinal.length - 1]
    parts.push(cwArc(rightCx, botA, topA + 2 * Math.PI, theme.secondary, 'lp-bd', true))
  } else {
    // Single item: near-complete CW loop as hint
    const a = rightAnglesFinal[0]
    parts.push(cwArc(rightCx, a, a + 2 * Math.PI, theme.secondary, 'lp-bd', true))
  }

  // Center crossing dot
  parts.push(`<circle cx="${W / 2}" cy="${cy}" r="5" fill="${theme.accent}"/>`)

  // Draw nodes (on top of arcs)
  const drawNodes = (loop_items: typeof items, angles: number[], cx: number, idxOffset: number) => {
    loop_items.forEach((item, i) => {
      const angle = angles[i]
      const nx = cx + loopR * Math.cos(angle)
      const ny = cy + loopR * Math.sin(angle)
      const t = (idxOffset + i) / (n - 1 || 1)
      const fill = lerpColor(theme.primary, theme.secondary, t)
      parts.push(`<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${nodeR}" fill="${fill}" stroke="${theme.bg}" stroke-width="2"/>`)
      const words = item.label.split(' ')
      if (words.length <= 1) {
        parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.bg}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(item.label, 9))}</text>`)
      } else {
        const mid = Math.ceil(words.length / 2)
        const l1 = words.slice(0, mid).join(' '), l2 = words.slice(mid).join(' ')
        parts.push(`<text x="${nx.toFixed(1)}" y="${(ny - 1).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.bg}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(l1, 9))}</text>`)
        parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + 9).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.bg}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(l2, 9))}</text>`)
      }
    })
  }

  drawNodes(leftItems,  leftAnglesFinal,  leftCx,  0)
  drawNodes(rightItems, rightAnglesFinal, rightCx, leftCount)

  return svgWrap(W, H, theme, parts)
}

function renderEmpty(theme: SmartArtTheme): string {
  return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
    <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
  </svg>`
}
