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

export function renderStatistical(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'scorecard':      return renderScorecard(spec, theme)
    case 'treemap':        return renderTreemap(spec, theme)
    case 'bullet-chart':   return renderBulletChart(spec, theme)
    case 'sankey':         return renderSankey(spec, theme)
    case 'waffle':         return renderWaffle(spec, theme)
    case 'gauge':          return renderGauge(spec, theme)
    case 'radar':          return renderRadar(spec, theme)
    case 'heatmap':        return renderHeatmap(spec, theme)
    default:               return renderProgressList(spec, theme)
  }
}

// ── Progress list ─────────────────────────────────────────────────────────────
// Syntax: `- Label: 92` or `- Label: 92%`

function renderProgressList(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 520
  const ROW_H = 40
  const LABEL_W = 155
  const BAR_X = LABEL_W + 20
  const BAR_W = W - BAR_X - 52
  const TITLE_H = spec.title ? 30 : 10
  const H = TITLE_H + items.length * ROW_H + 12

  const rows: string[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const y = TITLE_H + i * ROW_H + 4
    const barY = y + 11

    // Parse value: "92", "92%", "0.92"
    const raw = (item.value ?? item.attrs[0] ?? '0').replace('%', '')
    const num = parseFloat(raw)
    const pct = isNaN(num) ? 0 : num > 1 ? Math.min(num, 100) : num * 100
    const fillW = Math.max(0, BAR_W * pct / 100)

    // Color by value threshold
    const barColor = pct >= 70 ? theme.accent : pct >= 40 ? '#fbbf24' : '#f87171'

    rows.push(
      // Track
      `<rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="16" rx="8" fill="${theme.muted}33"/>`,
      // Fill
      `<rect x="${BAR_X}" y="${barY}" width="${fillW.toFixed(1)}" height="16" rx="8" fill="${barColor}"/>`,
      // Label
      `<text x="${LABEL_W}" y="${barY + 11}" text-anchor="end" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 20))}</text>`,
      // Value
      `<text x="${BAR_X + BAR_W + 8}" y="${barY + 11}" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${pct % 1 === 0 ? pct : pct.toFixed(1)}%</text>`,
    )
  }

  return svg(W, H, theme, spec.title, rows)
}

// ── Scorecard ─────────────────────────────────────────────────────────────────
// Syntax: `- Label: VALUE [+change]`

function renderScorecard(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const cols = items.length <= 2 ? items.length : items.length <= 4 ? 2 : Math.min(4, items.length)
  const rows = Math.ceil(items.length / cols)
  const W = 600
  const TITLE_H = spec.title ? 30 : 8
  const GAP = 12
  const CARD_W = (W - (cols + 1) * GAP) / cols
  const CARD_H = 76
  const H = TITLE_H + rows * (CARD_H + GAP) + GAP

  const cards: string[] = []

  items.forEach((item, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = GAP + col * (CARD_W + GAP)
    const y = TITLE_H + GAP + row * (CARD_H + GAP)
    const value = item.value ?? item.attrs[0] ?? '—'
    const change = item.attrs.find(a => /^[+\-]/.test(a))
    const changeColor = change?.startsWith('+') ? '#34d399' : '#f87171'

    cards.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CARD_W.toFixed(1)}" height="${CARD_H}" rx="8" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`,
      `<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(y + 32).toFixed(1)}" text-anchor="middle" font-size="22" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(value)}</text>`,
      `<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(y + 50).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 20))}</text>`,
    )
    if (change) {
      cards.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(y + 65).toFixed(1)}" text-anchor="middle" font-size="10" fill="${changeColor}" font-family="system-ui,sans-serif">${escapeXml(change)}</text>`)
    }
  })

  return svg(W, H, theme, spec.title, cards)
}

// ── Treemap ───────────────────────────────────────────────────────────────────
// Syntax: `- Label: value` (value proportional to area)

function renderTreemap(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 600
  const TITLE_H = spec.title ? 30 : 8
  const H = 320
  const CONTENT_H = H - TITLE_H - 8

  // Simple row-based treemap: fill rows left-to-right
  const colors = [theme.primary, theme.secondary, theme.accent, theme.muted,
    '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6']

  const cells: string[] = []

  // Lay out in a single pass: each item gets a rect proportional to its weight
  // Simple strip layout (not optimal but clean)
  const cols = Math.ceil(Math.sqrt(items.length))
  const rows = Math.ceil(items.length / cols)
  const cellW = W / cols
  const cellH = CONTENT_H / rows

  items.forEach((item, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * cellW
    const y = TITLE_H + 4 + row * cellH
    const fill = colors[i % colors.length]

    cells.push(
      `<rect x="${(x + 2).toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${(cellW - 4).toFixed(1)}" height="${(cellH - 4).toFixed(1)}" rx="6" fill="${fill}55" stroke="${fill}99" stroke-width="1"/>`,
      `<text x="${(x + cellW / 2).toFixed(1)}" y="${(y + cellH / 2).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, Math.floor(cellW / 8)))}</text>`,
    )
    if (item.value) {
      cells.push(`<text x="${(x + cellW / 2).toFixed(1)}" y="${(y + cellH / 2 + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`)
    }
  })

  return svg(W, H, theme, spec.title, cells)
}

// ── Bullet chart ─────────────────────────────────────────────────────────────
// Syntax: `- Label: value [target]`  e.g. `- Revenue: 72 [85]`

function renderBulletChart(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 520, ROW_H = 46, LABEL_W = 150, BAR_X = LABEL_W + 16
  const BAR_W = W - BAR_X - 48, BAR_H = 18
  const TITLE_H = spec.title ? 30 : 10
  const H = TITLE_H + items.length * ROW_H + 12
  const parts: string[] = []

  items.forEach((item, i) => {
    const y = TITLE_H + i * ROW_H
    const midY = y + ROW_H / 2
    const barY = midY - BAR_H / 2

    const raw = (item.value ?? item.attrs[0] ?? '0').replace('%', '')
    const val = Math.min(parseFloat(raw) || 0, 100) / 100
    // Target: second attr e.g. [85]
    const targetRaw = item.attrs[1] ?? item.attrs.find(a => a !== item.attrs[0] && /^\d/.test(a))
    const target = targetRaw ? Math.min(parseFloat(targetRaw.replace('%', '')) || 0, 100) / 100 : null

    // Three background bands (danger/warning/good)
    parts.push(`<rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="${BAR_H}" rx="3" fill="${theme.muted}40"/>`)
    parts.push(`<rect x="${BAR_X}" y="${barY}" width="${(BAR_W * 0.7).toFixed(1)}" height="${BAR_H}" rx="3" fill="${theme.muted}5a"/>`)
    parts.push(`<rect x="${BAR_X}" y="${barY}" width="${(BAR_W * 0.4).toFixed(1)}" height="${BAR_H}" rx="3" fill="${theme.muted}80"/>`)

    // Actual value bar (60% height, centered)
    const actH = BAR_H * 0.6, actY = barY + (BAR_H - actH) / 2
    const barColor = val >= 0.7 ? theme.accent : val >= 0.4 ? '#fbbf24' : '#f87171'
    parts.push(`<rect x="${BAR_X}" y="${actY.toFixed(1)}" width="${(BAR_W * val).toFixed(1)}" height="${actH.toFixed(1)}" rx="2" fill="${barColor}"/>`)

    // Target marker
    if (target !== null) {
      const tx = BAR_X + BAR_W * target
      parts.push(`<rect x="${(tx - 1.5).toFixed(1)}" y="${barY}" width="3" height="${BAR_H}" rx="1" fill="${theme.text}cc"/>`)
    }

    parts.push(`<text x="${LABEL_W}" y="${(midY + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 20))}</text>`)
    parts.push(`<text x="${BAR_X + BAR_W + 8}" y="${(midY + 4).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${Math.round(val * 100)}%</text>`)
  })

  return svg(W, H, theme, spec.title, parts)
}

// ── Sankey (simplified flow diagram) ─────────────────────────────────────────
// Syntax: top-level items = sources (value = weight); children = destination names

function renderSankey(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const colors = [theme.primary, theme.secondary, theme.accent, theme.muted, '#f59e0b', '#ec4899']

  // Parse source weights
  const srcW = items.map(it => Math.max(1, parseFloat((it.value ?? it.attrs[0] ?? '1').replace('%', '')) || 1))
  const totalSrc = srcW.reduce((a, b) => a + b, 0)

  // Build destination list and flow weights
  const dstMap = new Map<string, number>()
  type FlowDef = { si: number; dst: string; w: number }
  const flows: FlowDef[] = []
  items.forEach((it, si) => {
    const perChild = srcW[si] / Math.max(it.children.length, 1)
    it.children.forEach(ch => {
      const fw = Math.max(1, parseFloat((ch.value ?? ch.attrs[0] ?? '0').replace('%', '')) || perChild)
      flows.push({ si, dst: ch.label, w: fw })
      dstMap.set(ch.label, (dstMap.get(ch.label) ?? 0) + fw)
    })
  })

  const dstNames = [...dstMap.keys()]
  const totalDst = [...dstMap.values()].reduce((a, b) => a + b, 0) || totalSrc

  const W = 520, TITLE_H = spec.title ? 30 : 10
  const BOX_W = 112, GAP = 8, CONTENT_H = 280
  const H = TITLE_H + CONTENT_H + GAP * 2

  // Layout sources vertically
  const srcScale = (CONTENT_H - (items.length - 1) * GAP) / totalSrc
  type Node = { y: number; h: number }
  const srcNodes: Node[] = []
  let sy = TITLE_H + GAP
  items.forEach((_, i) => {
    const h = Math.max(18, srcW[i] * srcScale)
    srcNodes.push({ y: sy, h })
    sy += h + GAP
  })

  // Layout destinations vertically
  const dstScale = (CONTENT_H - (dstNames.length - 1) * GAP) / totalDst
  const dstNodes = new Map<string, Node>()
  let dy = TITLE_H + GAP
  dstNames.forEach(name => {
    const h = Math.max(18, (dstMap.get(name) ?? 1) * dstScale)
    dstNodes.set(name, { y: dy, h })
    dy += h + GAP
  })

  const parts: string[] = []
  const srcYCur = srcNodes.map(n => n.y)
  const dstYCur = new Map<string, number>(dstNames.map(n => [n, dstNodes.get(n)!.y]))

  const x0 = BOX_W, x1 = W - BOX_W, mx = (x0 + x1) / 2

  // Draw flows
  flows.forEach(f => {
    const src = srcNodes[f.si]
    const dst = dstNodes.get(f.dst)
    if (!src || !dst) return
    const fwSrc = (f.w / srcW[f.si]) * src.h
    const fwDst = (f.w / (dstMap.get(f.dst) ?? 1)) * dst.h
    const sy0 = srcYCur[f.si], sy1 = sy0 + fwSrc
    srcYCur[f.si] += fwSrc
    const dy0 = dstYCur.get(f.dst)!, dy1 = dy0 + fwDst
    dstYCur.set(f.dst, dy1)
    const col = colors[f.si % colors.length]
    parts.push(`<path d="M${x0},${sy0.toFixed(1)} C${mx},${sy0.toFixed(1)} ${mx},${dy0.toFixed(1)} ${x1},${dy0.toFixed(1)} L${x1},${dy1.toFixed(1)} C${mx},${dy1.toFixed(1)} ${mx},${sy1.toFixed(1)} ${x0},${sy1.toFixed(1)} Z" fill="${col}3a" stroke="${col}77" stroke-width="0.5"/>`)
  })

  // Source boxes
  srcNodes.forEach((n, i) => {
    const col = colors[i % colors.length]
    parts.push(`<rect x="0" y="${n.y.toFixed(1)}" width="${BOX_W - 8}" height="${n.h.toFixed(1)}" rx="4" fill="${col}44" stroke="${col}99" stroke-width="1"/>`)
    if (n.h >= 14) parts.push(`<text x="${(BOX_W - 8) / 2}" y="${(n.y + n.h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(items[i].label, 13))}</text>`)
  })

  // Destination boxes
  dstNames.forEach(name => {
    const n = dstNodes.get(name)!
    parts.push(`<rect x="${W - BOX_W + 8}" y="${n.y.toFixed(1)}" width="${BOX_W - 8}" height="${n.h.toFixed(1)}" rx="4" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`)
    if (n.h >= 14) parts.push(`<text x="${W - (BOX_W - 8) / 2}" y="${(n.y + n.h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(name, 13))}</text>`)
  })

  return svg(W, H, theme, spec.title, parts)
}

// ── Waffle chart ──────────────────────────────────────────────────────────────
// Syntax: `- Label: value%`  — items are segments; 100 squares total

function renderWaffle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const colors = [theme.primary, theme.secondary, theme.accent, theme.muted, '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6']
  const rawVals = items.map(it => Math.max(0, parseFloat((it.value ?? it.attrs[0] ?? '0').replace('%', '')) || 0))
  const total = rawVals.reduce((a, b) => a + b, 0) || 100
  // Convert to square counts (round, force sum = 100)
  let squares = rawVals.map(v => Math.round(v / total * 100))
  const diff = 100 - squares.reduce((a, b) => a + b, 0)
  if (diff !== 0) squares[0] = Math.max(0, squares[0] + diff)

  const GRID = 10, SQ = 18, GAP = 3, PAD = 16
  const GRID_W = GRID * (SQ + GAP) - GAP           // 207
  const LEGEND_H = items.length * 22 + 10
  const W = Math.max(GRID_W + PAD * 2, 280)        // 280 gives ~240px of text space
  const gridOffX = (W - GRID_W) / 2               // center grid
  const TITLE_H = spec.title ? 30 : 10
  const H = TITLE_H + PAD + GRID * (SQ + GAP) - GAP + PAD + LEGEND_H

  // Build color array for each of 100 squares
  const sqColor: string[] = []
  items.forEach((_, gi) => { for (let s = 0; s < squares[gi]; s++) sqColor.push(colors[gi % colors.length]) })

  const parts: string[] = []
  for (let sq = 0; sq < 100; sq++) {
    const col = sq % GRID, row = Math.floor(sq / GRID)
    const x = gridOffX + col * (SQ + GAP), y = TITLE_H + PAD + row * (SQ + GAP)
    const fill = sqColor[sq] ? sqColor[sq] : `${theme.muted}22`
    parts.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${SQ}" height="${SQ}" rx="2" fill="${fill}"/>`)
  }

  // Legend — single column, no overlap risk
  const legY = TITLE_H + PAD + GRID * (SQ + GAP) + 6
  items.forEach((item, i) => {
    const ly = legY + i * 22
    parts.push(`<rect x="${PAD}" y="${ly}" width="12" height="12" rx="2" fill="${colors[i % colors.length]}"/>`)
    parts.push(`<text x="${PAD + 16}" y="${ly + 10}" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 22))} (${squares[i]}%)</text>`)
  })

  return svg(W, H, theme, spec.title, parts)
}

// ── Gauge / Speedometer ───────────────────────────────────────────────────────
// Syntax: `- Label: 72%`  — multiple items render side-by-side gauges

function renderGauge(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const n = items.length
  const GW = n <= 1 ? 240 : n <= 2 ? 220 : n <= 3 ? 180 : 150
  const W = n * GW, TITLE_H = spec.title ? 30 : 10
  const GH = GW * 0.62, H = TITLE_H + GH + 36
  const parts: string[] = []

  items.forEach((item, i) => {
    const cx = GW * i + GW / 2, cy = TITLE_H + GH * 0.88
    const R = GW * 0.37, SW = R * 0.17

    const raw = (item.value ?? item.attrs[0] ?? '0').replace('%', '')
    const val = Math.min(Math.max(parseFloat(raw) || 0, 0), 100) / 100

    // Background arc: 180° half-circle (left to right)
    const lx = cx - R, rx = cx + R
    parts.push(`<path d="M${lx},${cy} A${R},${R} 0 0,1 ${rx},${cy}" fill="none" stroke="${theme.muted}44" stroke-width="${SW}" stroke-linecap="round"/>`)

    // Colored value arc
    if (val > 0) {
      const angle = Math.PI * (1 - val)  // π=left, 0=right
      const ex = cx + R * Math.cos(angle), ey = cy - R * Math.sin(angle)
      const largeArc = 0  // arc is always ≤180° (half-circle), so never a large arc
      const col = val >= 0.7 ? theme.accent : val >= 0.4 ? '#fbbf24' : '#f87171'
      parts.push(`<path d="M${lx},${cy} A${R},${R} 0 ${largeArc},1 ${ex.toFixed(1)},${ey.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${SW}" stroke-linecap="round"/>`)
      // Tip dot
      parts.push(`<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="${(SW / 2).toFixed(1)}" fill="${col}"/>`)
    }

    // Value label
    const fs = Math.max(16, Math.round(GW * 0.15))
    parts.push(`<text x="${cx}" y="${(cy - 6).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${Math.round(val * 100)}%</text>`)
    parts.push(`<text x="${cx}" y="${(cy + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 16))}</text>`)
  })

  return svg(W, H, theme, spec.title, parts)
}

// ── Radar / Spider chart ──────────────────────────────────────────────────────
// Syntax: `- Axis: value`  (3+ items)

function renderRadar(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length < 3) return renderEmpty(theme)

  const n = items.length
  const W = 480, TITLE_H = spec.title ? 30 : 10, H = 380 + TITLE_H
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2
  const R = Math.min(cx - 80, (H - TITLE_H) / 2 - 44)
  const parts: string[] = []

  const vals = items.map(it => {
    const raw = (it.value ?? it.attrs[0] ?? '0').replace('%', '')
    return Math.min(Math.max(parseFloat(raw) || 0, 0), 100) / 100
  })

  // Grid rings
  for (let ring = 1; ring <= 4; ring++) {
    const r = R * ring / 4
    const pts = items.map((_, i) => {
      const a = 2 * Math.PI * i / n - Math.PI / 2
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
    })
    parts.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="${theme.border}99" stroke-width="0.8"/>`)
    parts.push(`<text x="${cx}" y="${(cy - r + 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif" opacity="0.7">${ring * 25}%</text>`)
  }

  // Axes
  items.forEach((_, i) => {
    const a = 2 * Math.PI * i / n - Math.PI / 2
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${(cx + R * Math.cos(a)).toFixed(1)}" y2="${(cy + R * Math.sin(a)).toFixed(1)}" stroke="${theme.border}66" stroke-width="1"/>`)
  })

  // Value polygon
  const vpts = items.map((_, i) => {
    const a = 2 * Math.PI * i / n - Math.PI / 2
    const r = R * vals[i]
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
  })
  parts.push(`<polygon points="${vpts.join(' ')}" fill="${theme.primary}2e" stroke="${theme.primary}" stroke-width="1.8"/>`)

  // Dots + labels
  items.forEach((item, i) => {
    const a = 2 * Math.PI * i / n - Math.PI / 2
    const vr = R * vals[i]
    parts.push(`<circle cx="${(cx + vr * Math.cos(a)).toFixed(1)}" cy="${(cy + vr * Math.sin(a)).toFixed(1)}" r="4" fill="${theme.accent}"/>`)
    const la = R + 26
    const lx = cx + la * Math.cos(a), ly = cy + la * Math.sin(a)
    const anchor = Math.cos(a) > 0.15 ? 'start' : Math.cos(a) < -0.15 ? 'end' : 'middle'
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(item.label, 12))}</text>`)
  })

  return svg(W, H, theme, spec.title, parts)
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
// Syntax: top-level = rows; children = cells with numeric label or `value`

function renderHeatmap(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const rows = spec.items
  if (rows.length === 0) return renderEmpty(theme)

  const numCols = Math.max(...rows.map(r => r.children.length), 1)
  const CELL_W = Math.min(88, Math.max(46, 520 / numCols))
  const LABEL_W = 100, CELL_H = 40, HEADER_H = 28
  const TITLE_H = spec.title ? 30 : 8
  const W = LABEL_W + numCols * CELL_W
  const H = TITLE_H + HEADER_H + rows.length * CELL_H + 8

  // Collect all values for normalization
  const allVals: number[] = []
  rows.forEach(r => r.children.forEach(c => {
    const raw = (c.value ?? c.attrs[0] ?? c.label.match(/[\d.]+/)?.[0] ?? '0').replace('%', '')
    allVals.push(parseFloat(raw) || 0)
  }))
  const maxVal = Math.max(...allVals, 1)

  const parts: string[] = []

  // Header row
  parts.push(`<rect x="0" y="${TITLE_H}" width="${LABEL_W}" height="${HEADER_H}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="0.5"/>`)
  for (let c = 0; c < numCols; c++) {
    const colX = LABEL_W + c * CELL_W
    parts.push(`<rect x="${colX}" y="${TITLE_H}" width="${CELL_W}" height="${HEADER_H}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="0.5"/>`)
    parts.push(`<text x="${(colX + CELL_W / 2).toFixed(1)}" y="${(TITLE_H + 19).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${String.fromCharCode(65 + c)}</text>`)
  }

  // Data rows
  rows.forEach((row, r) => {
    const rowY = TITLE_H + HEADER_H + r * CELL_H
    parts.push(`<rect x="0" y="${rowY}" width="${LABEL_W}" height="${CELL_H}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="0.5"/>`)
    parts.push(`<text x="8" y="${(rowY + 25).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(row.label, 12))}</text>`)
    row.children.slice(0, numCols).forEach((cell, c) => {
      const colX = LABEL_W + c * CELL_W
      const raw = (cell.value ?? cell.attrs[0] ?? cell.label.match(/[\d.]+/)?.[0] ?? '0').replace('%', '')
      const v = Math.min((parseFloat(raw) || 0) / maxVal, 1)
      const alpha = Math.round(18 + v * 210).toString(16).padStart(2, '0')
      parts.push(`<rect x="${colX}" y="${rowY}" width="${CELL_W}" height="${CELL_H}" fill="${theme.primary}${alpha}" stroke="${theme.border}55" stroke-width="0.5"/>`)
      const textFill = v > 0.55 ? theme.bg : theme.text
      parts.push(`<text x="${(colX + CELL_W / 2).toFixed(1)}" y="${(rowY + 25).toFixed(1)}" text-anchor="middle" font-size="10" fill="${textFill}" font-family="system-ui,sans-serif">${escapeXml(truncate(cell.label, 9))}</text>`)
    })
  })

  return svg(W, H, theme, spec.title, parts)
}

// ── Shared ────────────────────────────────────────────────────────────────────

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
