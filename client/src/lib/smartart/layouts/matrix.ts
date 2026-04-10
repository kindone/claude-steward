import type { SmartArtSpec, SmartArtItem } from '../parser'
import type { SmartArtTheme } from '../theme'

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderMatrix(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'pros-cons':  return renderProsCons(spec, theme)
    case 'comparison': return renderComparison(spec, theme)
    default:           return renderSwot(spec, theme)
  }
}

// ── SWOT ──────────────────────────────────────────────────────────────────────

interface SwotQuadrant {
  label: string
  items: string[]
  fill: string
  textColor: string
}

function renderSwot(spec: SmartArtSpec, theme: SmartArtTheme): string {
  // Collect items by prefix char or by group name
  const quadrantMap: Record<string, SwotQuadrant> = {
    S: { label: 'Strengths', items: [], fill: '#064e3b', textColor: '#6ee7b7' },
    W: { label: 'Weaknesses', items: [], fill: '#4c0519', textColor: '#fda4af' },
    O: { label: 'Opportunities', items: [], fill: '#1e3a8a', textColor: '#93c5fd' },
    T: { label: 'Threats', items: [], fill: '#451a03', textColor: '#fcd34d' },
  }

  // Prefix-based
  for (const item of spec.items) {
    if (item.prefix === '+') quadrantMap.S.items.push(item.label)
    else if (item.prefix === '-') quadrantMap.W.items.push(item.label)
    else if (item.prefix === '?') quadrantMap.O.items.push(item.label)
    else if (item.prefix === '!') quadrantMap.T.items.push(item.label)
    else {
      // Group heading — detect by name
      const lower = item.label.toLowerCase()
      let key: string | null = null
      if (lower.startsWith('strength')) key = 'S'
      else if (lower.startsWith('weakness')) key = 'W'
      else if (lower.startsWith('opportunit')) key = 'O'
      else if (lower.startsWith('threat')) key = 'T'
      if (key) {
        quadrantMap[key].items.push(...item.children.map(c => c.label))
      }
    }
  }

  const W = 500
  const H = 400
  const titleH = spec.title ? 26 : 0
  const CELL_W = W / 2
  const CELL_H = (H - titleH) / 2
  const PAD = 10

  let svgContent = ''

  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 14}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`
  }

  const quadrants = [
    { key: 'S', col: 0, row: 0 },
    { key: 'W', col: 1, row: 0 },
    { key: 'O', col: 0, row: 1 },
    { key: 'T', col: 1, row: 1 },
  ]

  for (const { key, col, row } of quadrants) {
    const q = quadrantMap[key]
    const x = col * CELL_W
    const y = titleH + row * CELL_H

    svgContent += `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${q.fill}" />`
    svgContent += `<text x="${x + CELL_W / 2}" y="${y + 22}" text-anchor="middle" font-size="12" fill="${q.textColor}" font-family="system-ui,sans-serif" font-weight="700">${q.label}</text>`

    const maxItems = Math.min(q.items.length, 5)
    for (let i = 0; i < maxItems; i++) {
      const itemY = y + 38 + i * 16
      const label = q.items[i].length > 28 ? q.items[i].slice(0, 26) + '…' : q.items[i]
      svgContent += `<text x="${x + 10}" y="${itemY}" font-size="10" fill="${q.textColor}" font-family="system-ui,sans-serif" opacity="0.85">• ${escapeXml(label)}</text>`
    }

    if (q.items.length > 5) {
      svgContent += `<text x="${x + 10}" y="${y + 38 + 5 * 16}" font-size="9" fill="${q.textColor}" font-family="system-ui,sans-serif" opacity="0.6">+${q.items.length - 5} more</text>`
    }
  }

  // Grid lines
  svgContent += `<line x1="${W / 2}" y1="${titleH}" x2="${W / 2}" y2="${H}" stroke="${theme.bg}" stroke-width="2" />`
  svgContent += `<line x1="0" y1="${titleH + CELL_H}" x2="${W}" y2="${titleH + CELL_H}" stroke="${theme.bg}" stroke-width="2" />`

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Pros / Cons ───────────────────────────────────────────────────────────────

function renderProsCons(spec: SmartArtSpec, theme: SmartArtTheme): string {
  // Expect top-level items with children: "Pros" and "Cons"
  let pros: SmartArtItem[] = []
  let cons: SmartArtItem[] = []

  for (const item of spec.items) {
    const lower = item.label.toLowerCase()
    if (lower.includes('pro') || lower.includes('advantage') || lower.includes('benefit')) {
      pros = item.children.length ? item.children : pros
    } else if (lower.includes('con') || lower.includes('disadvantage') || lower.includes('risk')) {
      cons = item.children.length ? item.children : cons
    } else if (item.prefix === '+') {
      pros.push(item)
    } else if (item.prefix === '-') {
      cons.push(item)
    }
  }

  const maxRows = Math.max(pros.length, cons.length, 1)
  const W = 500
  const ROW_H = 36
  const HEADER_H = 40
  const PAD = 16
  const titleH = spec.title ? 28 : 0
  const H = PAD + titleH + HEADER_H + maxRows * ROW_H + PAD
  const HALF = W / 2

  let svgContent = ''

  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`
  }

  const baseY = PAD + titleH

  // Headers
  svgContent += `<rect x="0" y="${baseY}" width="${HALF}" height="${HEADER_H}" fill="#064e3b" />`
  svgContent += `<text x="${HALF / 2}" y="${baseY + 25}" text-anchor="middle" font-size="13" fill="#6ee7b7" font-family="system-ui,sans-serif" font-weight="700">Pros</text>`

  svgContent += `<rect x="${HALF}" y="${baseY}" width="${HALF}" height="${HEADER_H}" fill="#4c0519" />`
  svgContent += `<text x="${HALF + HALF / 2}" y="${baseY + 25}" text-anchor="middle" font-size="13" fill="#fda4af" font-family="system-ui,sans-serif" font-weight="700">Cons</text>`

  const itemsY = baseY + HEADER_H

  for (let i = 0; i < maxRows; i++) {
    const rowY = itemsY + i * ROW_H
    const rowBg = i % 2 === 0 ? theme.surface : theme.bg
    svgContent += `<rect x="0" y="${rowY}" width="${HALF}" height="${ROW_H}" fill="${rowBg}" />`
    svgContent += `<rect x="${HALF}" y="${rowY}" width="${HALF}" height="${ROW_H}" fill="${rowBg}" />`

    if (i < pros.length) {
      const label = pros[i].label.length > 26 ? pros[i].label.slice(0, 24) + '…' : pros[i].label
      svgContent += `<text x="${PAD}" y="${rowY + 23}" font-size="11" fill="#6ee7b7" font-family="system-ui,sans-serif">✓ ${escapeXml(label)}</text>`
    }
    if (i < cons.length) {
      const label = cons[i].label.length > 26 ? cons[i].label.slice(0, 24) + '…' : cons[i].label
      svgContent += `<text x="${HALF + PAD}" y="${rowY + 23}" font-size="11" fill="#fda4af" font-family="system-ui,sans-serif">✗ ${escapeXml(label)}</text>`
    }

    if (i < maxRows - 1) {
      svgContent += `<line x1="0" y1="${rowY + ROW_H}" x2="${W}" y2="${rowY + ROW_H}" stroke="${theme.border}" stroke-width="0.5" />`
    }
  }

  // Divider
  svgContent += `<line x1="${HALF}" y1="${baseY}" x2="${HALF}" y2="${H}" stroke="${theme.bg}" stroke-width="2" />`

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

// ── Comparison ────────────────────────────────────────────────────────────────

function renderComparison(spec: SmartArtSpec, theme: SmartArtTheme): string {
  // Top-level items are columns; their children are rows
  const cols = spec.items
  if (cols.length === 0) return renderEmpty(theme)

  const W = Math.max(400, cols.length * 140 + 120)
  const COL_W = Math.floor((W - 120) / cols.length)
  const LABEL_W = 120
  const ROW_H = 34
  const HEADER_H = 44
  const PAD = 12
  const titleH = spec.title ? 28 : 0

  // Gather all unique row labels from children
  const rowLabels = Array.from(new Set(cols.flatMap(c => c.children.map(ch => ch.label))))
  const H = PAD + titleH + HEADER_H + rowLabels.length * ROW_H + PAD

  let svgContent = ''

  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`
  }

  const baseY = PAD + titleH

  // Column headers
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci]
    const colX = LABEL_W + ci * COL_W
    const t = cols.length > 1 ? ci / (cols.length - 1) : 0.5
    const fill = lerpColorLocal('#1e3a8a', '#1d4ed8', t)
    svgContent += `<rect x="${colX}" y="${baseY}" width="${COL_W}" height="${HEADER_H}" fill="${fill}" />`
    svgContent += `<text x="${colX + COL_W / 2}" y="${baseY + 27}" text-anchor="middle" font-size="12" fill="#bfdbfe" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(col.label)}</text>`
  }

  // Row label column header
  svgContent += `<rect x="0" y="${baseY}" width="${LABEL_W}" height="${HEADER_H}" fill="${theme.surface}" />`
  svgContent += `<text x="${LABEL_W / 2}" y="${baseY + 27}" text-anchor="middle" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">Feature</text>`

  // Rows
  for (let ri = 0; ri < rowLabels.length; ri++) {
    const rowLabel = rowLabels[ri]
    const rowY = baseY + HEADER_H + ri * ROW_H
    const rowBg = ri % 2 === 0 ? theme.surface : theme.bg

    svgContent += `<rect x="0" y="${rowY}" width="${W}" height="${ROW_H}" fill="${rowBg}" />`
    const shortLabel = rowLabel.length > 16 ? rowLabel.slice(0, 14) + '…' : rowLabel
    svgContent += `<text x="${PAD}" y="${rowY + 22}" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(shortLabel)}</text>`

    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci]
      const colX = LABEL_W + ci * COL_W
      const child = col.children.find(ch => ch.label === rowLabel)
      const val = child?.value ?? (col.children.some(ch => ch.label === rowLabel) ? '✓' : '—')
      svgContent += `<text x="${colX + COL_W / 2}" y="${rowY + 22}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(val)}</text>`
    }

    svgContent += `<line x1="0" y1="${rowY + ROW_H}" x2="${W}" y2="${rowY + ROW_H}" stroke="${theme.border}" stroke-width="0.5" />`
  }

  // Column dividers
  for (let ci = 0; ci <= cols.length; ci++) {
    const lx = LABEL_W + ci * COL_W
    svgContent += `<line x1="${lx}" y1="${baseY}" x2="${lx}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="0.5" />`
  }
  svgContent += `<line x1="${LABEL_W}" y1="${baseY}" x2="${LABEL_W}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="1" />`

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`
}

function lerpColorLocal(c1: string, c2: string, t: number): string {
  const hexToRgb = (hex: string): [number, number, number] => {
    const n = parseInt(hex.replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
  return '#' + [lerp(r1, r2), lerp(g1, g2), lerp(b1, b2)].map(v => v.toString(16).padStart(2, '0')).join('')
}

function renderEmpty(theme: SmartArtTheme): string {
  return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
    <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
  </svg>`
}
