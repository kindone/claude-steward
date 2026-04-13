import type { MdArtSpec } from '../parser'
import type { MdArtTheme } from '../theme'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function tt(s: string, max: number): string {
  const tr = truncate(s, max)
  if (tr === s) return escapeXml(s)
  return `<title>${escapeXml(s)}</title>${escapeXml(tr)}`
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderPlanning(spec: MdArtSpec, theme: MdArtTheme): string {
  switch (spec.type) {
    case 'gantt':
    case 'gantt-lite':   return renderGantt(spec, theme)
    case 'sprint-board': return renderSprintBoard(spec, theme)
    case 'timeline':     return renderTimeline(spec, theme)
    case 'milestone':    return renderMilestone(spec, theme)
    case 'wbs':          return renderWbs(spec, theme)
    default:             return renderKanban(spec, theme)
  }
}

// ── Kanban ────────────────────────────────────────────────────────────────────
// Top-level items = columns; children = cards
// Syntax: `- Column\n  - Card [done]`

function renderKanban(spec: MdArtSpec, theme: MdArtTheme): string {
  const columns = spec.items
  if (columns.length === 0) return renderEmpty(theme)

  const W = 600
  const TITLE_H = spec.title ? 30 : 8
  const n = columns.length
  const GAP = 10
  const COL_W = (W - (n + 1) * GAP) / n
  const HEADER_H = 34
  const CARD_H = 28
  const CARD_GAP = 6
  const PAD = 8

  const maxCards = Math.max(...columns.map(c => c.children.length), 0)
  const colBodyH = maxCards * (CARD_H + CARD_GAP) + PAD
  const COL_H = HEADER_H + colBodyH + PAD
  const H = TITLE_H + 8 + COL_H + 12

  const parts: string[] = []

  columns.forEach((col, ci) => {
    const colX = GAP + ci * (COL_W + GAP)
    const colY = TITLE_H + 8

    // Column background
    parts.push(`<rect x="${colX.toFixed(1)}" y="${colY.toFixed(1)}" width="${COL_W.toFixed(1)}" height="${COL_H}" rx="8" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`)

    // Header — rounded top, flat bottom via path
    parts.push(`<path d="M${(colX + 8).toFixed(1)},${colY.toFixed(1)} Q${colX.toFixed(1)},${colY.toFixed(1)} ${colX.toFixed(1)},${(colY + 8).toFixed(1)} L${colX.toFixed(1)},${(colY + HEADER_H).toFixed(1)} L${(colX + COL_W).toFixed(1)},${(colY + HEADER_H).toFixed(1)} L${(colX + COL_W).toFixed(1)},${(colY + 8).toFixed(1)} Q${(colX + COL_W).toFixed(1)},${colY.toFixed(1)} ${(colX + COL_W - 8).toFixed(1)},${colY.toFixed(1)} Z" fill="${theme.accent}22"/>`)

    // Column title
    parts.push(`<text x="${(colX + COL_W / 2).toFixed(1)}" y="${(colY + 21).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${tt(col.label, 14)}</text>`)

    // Card count badge
    if (col.children.length > 0) {
      const bx = colX + COL_W - 18
      parts.push(
        `<circle cx="${bx.toFixed(1)}" cy="${(colY + 17).toFixed(1)}" r="9" fill="${theme.accent}44"/>`,
        `<text x="${bx.toFixed(1)}" y="${(colY + 21).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif">${col.children.length}</text>`,
      )
    }

    // Divider
    parts.push(`<line x1="${colX}" y1="${(colY + HEADER_H).toFixed(1)}" x2="${(colX + COL_W).toFixed(1)}" y2="${(colY + HEADER_H).toFixed(1)}" stroke="${theme.border}" stroke-width="1"/>`)

    // Cards
    col.children.forEach((card, idx) => {
      const cardX = colX + PAD
      const cardY = colY + HEADER_H + PAD + idx * (CARD_H + CARD_GAP)
      const cardW = COL_W - PAD * 2
      const isDone = card.attrs.includes('done')

      parts.push(
        `<rect x="${cardX.toFixed(1)}" y="${cardY.toFixed(1)}" width="${cardW.toFixed(1)}" height="${CARD_H}" rx="5" fill="${theme.bg}" stroke="${theme.border}" stroke-width="1"/>`,
        `<text x="${(cardX + 10).toFixed(1)}" y="${(cardY + 17).toFixed(1)}" font-size="11" fill="${isDone ? theme.muted : theme.text}" font-family="system-ui,sans-serif" ${isDone ? 'text-decoration="line-through"' : ''}>${tt(card.label, Math.floor(cardW / 7))}</text>`,
      )
    })
  })

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── Gantt / Gantt-lite ────────────────────────────────────────────────────────
// Syntax: `- Task [wk1-wk4]` or `- Task: 1-4`
// Time unit labels auto-generated as integers

function renderGantt(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  interface GanttRow { label: string; start: number; end: number }

  let maxEnd = 0
  const rows: GanttRow[] = items.map(item => {
    const rangeStr = item.attrs.find(a => /\d/.test(a)) ?? item.value ?? ''
    const match = rangeStr.match(/(\d+)[^\d]+(\d+)/)
    let start = 0, end = 1
    if (match) {
      start = parseInt(match[1]) - 1
      end = parseInt(match[2])
    } else if (/^\d+$/.test(rangeStr)) {
      start = parseInt(rangeStr) - 1
      end = parseInt(rangeStr)
    }
    maxEnd = Math.max(maxEnd, end)
    return { label: item.label, start, end }
  })
  if (maxEnd === 0) maxEnd = 8

  const W = 600
  const LABEL_W = 138
  const BAR_AREA = W - LABEL_W - 16
  const ROW_H = 34
  const TITLE_H = spec.title ? 30 : 8
  const HEADER_H = 22
  const H = TITLE_H + HEADER_H + rows.length * ROW_H + 12

  const parts: string[] = []

  // Tick marks & header numbers
  for (let t = 0; t <= maxEnd; t++) {
    const x = LABEL_W + (t / maxEnd) * BAR_AREA
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${TITLE_H + HEADER_H - 2}" x2="${x.toFixed(1)}" y2="${H - 8}" stroke="${theme.border}" stroke-width="0.5"/>`,
      `<text x="${x.toFixed(1)}" y="${TITLE_H + 14}" text-anchor="middle" font-size="10" fill="${theme.muted}" font-family="system-ui,sans-serif">${t + 1}</text>`,
    )
  }

  // Row data
  rows.forEach((row, i) => {
    const y = TITLE_H + HEADER_H + i * ROW_H

    // Alternating row background
    if (i % 2 === 0) {
      parts.push(`<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${ROW_H}" fill="${theme.surface}" opacity="0.5"/>`)
    }

    // Label
    parts.push(`<text x="${(LABEL_W - 8).toFixed(1)}" y="${(y + 21).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(row.label, 18)}</text>`)

    // Bar
    const barX = LABEL_W + (row.start / maxEnd) * BAR_AREA
    const barW = Math.max(6, ((row.end - row.start) / maxEnd) * BAR_AREA)
    parts.push(`<rect x="${barX.toFixed(1)}" y="${(y + 8).toFixed(1)}" width="${barW.toFixed(1)}" height="18" rx="4" fill="${theme.accent}88" stroke="${theme.accent}" stroke-width="1"/>`)
  })

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── Sprint Board ──────────────────────────────────────────────────────────────
// Like kanban but cards carry story-point badges + velocity bar at bottom
// Syntax: `- Column\n  - Card: points [active|done]`

function renderSprintBoard(spec: MdArtSpec, theme: MdArtTheme): string {
  const columns = spec.items
  if (columns.length === 0) return renderEmpty(theme)

  const W = 640
  const TITLE_H = spec.title ? 32 : 8
  const n = columns.length
  const GAP = 10
  const COL_W = (W - (n + 1) * GAP) / n
  const HEADER_H = 44
  const CARD_H = 30, CARD_GAP = 6, PAD = 8
  const FOOTER_H = 30

  const maxCards = Math.max(...columns.map(c => c.children.length), 0)
  const COL_H = HEADER_H + maxCards * (CARD_H + CARD_GAP) + PAD * 2
  const H = TITLE_H + 8 + COL_H + FOOTER_H + 12

  let totalPts = 0, donePts = 0
  const parts: string[] = []

  columns.forEach((col, ci) => {
    const colX = GAP + ci * (COL_W + GAP), colY = TITLE_H + 8
    const isDoneCol = /done|complete/i.test(col.label)

    parts.push(`<rect x="${colX.toFixed(1)}" y="${colY}" width="${COL_W.toFixed(1)}" height="${COL_H}" rx="8" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`)
    parts.push(`<path d="M${(colX+8).toFixed(1)},${colY} Q${colX},${colY} ${colX},${colY+8} L${colX},${colY+HEADER_H} L${(colX+COL_W).toFixed(1)},${colY+HEADER_H} L${(colX+COL_W).toFixed(1)},${colY+8} Q${(colX+COL_W).toFixed(1)},${colY} ${(colX+COL_W-8).toFixed(1)},${colY} Z" fill="${theme.accent}22"/>`)
    parts.push(`<text x="${(colX+COL_W/2).toFixed(1)}" y="${colY+19}" text-anchor="middle" font-size="12" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${tt(col.label, 14)}</text>`)

    let colPts = 0
    col.children.forEach(c => {
      const p = parseInt(c.value ?? c.attrs.find(a => /^\d+$/.test(a)) ?? '0') || 0
      colPts += p; totalPts += p
      if (isDoneCol || c.attrs.includes('done')) donePts += p
    })
    parts.push(`<text x="${(colX+COL_W/2).toFixed(1)}" y="${colY+34}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${colPts} pts</text>`)
    parts.push(`<line x1="${colX}" y1="${colY+HEADER_H}" x2="${(colX+COL_W).toFixed(1)}" y2="${colY+HEADER_H}" stroke="${theme.border}" stroke-width="1"/>`)

    col.children.forEach((card, idx) => {
      const cx = colX + PAD, cy = colY + HEADER_H + PAD + idx * (CARD_H + CARD_GAP)
      const cw = COL_W - PAD * 2
      const pts = parseInt(card.value ?? card.attrs.find(a => /^\d+$/.test(a)) ?? '0') || 0
      const done = isDoneCol || card.attrs.includes('done')
      const active = card.attrs.includes('active') || card.attrs.includes('doing') || card.attrs.includes('wip')
      const border = active ? theme.accent : theme.border

      parts.push(`<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${CARD_H}" rx="5" fill="${theme.bg}" stroke="${border}" stroke-width="${active ? 1.5 : 1}"/>`)
      if (active) parts.push(`<rect x="${cx.toFixed(1)}" y="${(cy+4).toFixed(1)}" width="3" height="${CARD_H-8}" rx="1.5" fill="${theme.accent}"/>`)

      const maxChars = Math.floor((cw - (pts > 0 ? 30 : 12)) / 6.5)
      const tx = cx + (active ? 10 : 6)
      parts.push(`<text x="${(tx+2).toFixed(1)}" y="${(cy+19).toFixed(1)}" font-size="11" fill="${done ? theme.textMuted : theme.text}" font-family="system-ui,sans-serif" ${done ? 'text-decoration="line-through"' : ''}>${tt(card.label, maxChars)}</text>`)
      if (pts > 0) {
        const bx = cx + cw - 13
        parts.push(`<circle cx="${bx.toFixed(1)}" cy="${(cy+15).toFixed(1)}" r="9" fill="${theme.accent}30"/>`)
        parts.push(`<text x="${bx.toFixed(1)}" y="${(cy+19).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${pts}</text>`)
      }
    })
  })

  // Velocity bar
  const barY = TITLE_H + 8 + COL_H + 8
  const barX = GAP, barW = W - GAP * 2
  parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`)
  if (totalPts > 0) {
    const fw = Math.max(0, (donePts / totalPts) * barW)
    parts.push(`<rect x="${barX}" y="${barY}" width="${fw.toFixed(1)}" height="10" rx="5" fill="${theme.accent}cc"/>`)
    parts.push(`<text x="${barX + barW / 2}" y="${(barY+22).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">Velocity: ${donePts}/${totalPts} pts · ${Math.round(donePts/totalPts*100)}% complete</text>`)
  }

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── Timeline ──────────────────────────────────────────────────────────────────
// Horizontal event timeline with alternating above/below labels
// Syntax: `- Event label [active|done]`  or  `- Date: Event`

function renderTimeline(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 600, PAD = 40
  const TITLE_H = spec.title ? 30 : 10
  const BAND = 62  // height of above / below band
  const LINE_Y = TITLE_H + BAND
  const H = TITLE_H + BAND * 2 + 20

  const n = items.length
  const spacing = n > 1 ? (W - PAD * 2) / (n - 1) : 0
  const parts: string[] = []

  // Main axis line
  parts.push(`<line x1="${PAD}" y1="${LINE_Y}" x2="${W-PAD}" y2="${LINE_Y}" stroke="${theme.accent}66" stroke-width="2.5"/>`)

  items.forEach((item, i) => {
    const x = n === 1 ? W / 2 : PAD + i * spacing
    const above = i % 2 === 0
    const active = item.attrs.includes('active') || item.attrs.includes('current') || item.attrs.includes('now')
    const done = item.attrs.includes('done') || item.attrs.includes('past')

    const r = active ? 8 : 6
    const dotFill = active ? theme.accent : done ? `${theme.accent}77` : theme.surface
    const dotStroke = active || done ? theme.accent : theme.border
    const stemH = 16
    const stemY1 = above ? LINE_Y - r : LINE_Y + r
    const stemY2 = above ? LINE_Y - r - stemH : LINE_Y + r + stemH

    parts.push(`<line x1="${x.toFixed(1)}" y1="${stemY1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${stemY2.toFixed(1)}" stroke="${theme.border}" stroke-width="1"/>`)
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${LINE_Y}" r="${r}" fill="${dotFill}" stroke="${dotStroke}" stroke-width="${active ? 2 : 1.5}"/>`)
    if (done && !active) {
      parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y+4).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.accent}" font-family="system-ui,sans-serif">✓</text>`)
    }

    // Label: use "date: event" if value present
    const mainLabel = item.value ? item.label : item.label
    const subLabel = item.value ?? ''
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
    const col = active ? theme.accent : done ? theme.textMuted : theme.text

    if (above) {
      if (subLabel) {
        parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y - r - stemH - 18).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(mainLabel, 14)}</text>`)
        parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y - r - stemH - 5).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${col}" font-family="system-ui,sans-serif" font-weight="${active ? '600' : '400'}">${tt(subLabel, 14)}</text>`)
      } else {
        parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y - r - stemH - 5).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${col}" font-family="system-ui,sans-serif" font-weight="${active ? '600' : '400'}">${tt(mainLabel, 14)}</text>`)
      }
    } else {
      parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y + r + stemH + 14).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${col}" font-family="system-ui,sans-serif" font-weight="${active ? '600' : '400'}">${tt(item.value ? subLabel : mainLabel, 14)}</text>`)
      if (item.value) {
        parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y + r + stemH + 27).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(mainLabel, 14)}</text>`)
      }
    }
  })

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── Milestone ─────────────────────────────────────────────────────────────────
// Vertical tracker with diamond markers and status badges
// Syntax: `- Phase name [done|active]`  optional value = status text

function renderMilestone(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 460, ROW_H = 44
  const TITLE_H = spec.title ? 30 : 8
  const LINE_X = 36
  const H = TITLE_H + 12 + items.length * ROW_H + 8

  const parts: string[] = []

  // Vertical spine
  const spineY1 = TITLE_H + 12 + ROW_H / 2
  const spineY2 = TITLE_H + 12 + (items.length - 0.5) * ROW_H
  parts.push(`<line x1="${LINE_X}" y1="${spineY1.toFixed(1)}" x2="${LINE_X}" y2="${spineY2.toFixed(1)}" stroke="${theme.border}" stroke-width="2"/>`)

  items.forEach((item, i) => {
    const cy = TITLE_H + 12 + i * ROW_H + ROW_H / 2
    const done = item.attrs.includes('done') || item.attrs.includes('complete')
    const active = item.attrs.includes('active') || item.attrs.includes('current') || item.attrs.includes('now')
    const upcoming = !done && !active

    const s = active ? 10 : 8
    const fill = done ? theme.accent : active ? theme.accent : theme.surface
    const stroke = done || active ? theme.accent : theme.border
    const sw = active ? 2.5 : 1.5

    // Diamond (rotated rect)
    parts.push(`<rect x="${(LINE_X - s).toFixed(1)}" y="${(cy - s).toFixed(1)}" width="${(s*2).toFixed(1)}" height="${(s*2).toFixed(1)}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="rotate(45 ${LINE_X} ${cy})"/>`)
    if (done) parts.push(`<text x="${LINE_X}" y="${(cy+4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.bg}" font-family="system-ui,sans-serif" font-weight="700">✓</text>`)

    // Label
    const labelColor = upcoming ? theme.textMuted : theme.text
    const fw = active ? '600' : '400'
    parts.push(`<text x="${(LINE_X + 22).toFixed(1)}" y="${(cy+5).toFixed(1)}" font-size="12" fill="${labelColor}" font-family="system-ui,sans-serif" font-weight="${fw}">${tt(item.label, 28)}</text>`)

    // Status tag (right side)
    const tag = done ? 'Done' : active ? 'In Progress' : (item.value ?? 'Upcoming')
    const tagCol = done ? theme.accent : active ? '#fbbf24' : theme.textMuted
    parts.push(`<text x="${W - 10}" y="${(cy+5).toFixed(1)}" text-anchor="end" font-size="9" fill="${tagCol}" font-family="system-ui,sans-serif">${tt(tag, 12)}</text>`)
  })

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── WBS (Work Breakdown Structure) ────────────────────────────────────────────
// Left-to-right tree: root → L1 phases → L2 tasks
// Syntax: `- Phase\n  - Task [done]`  (title used as root label)

function renderWbs(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const hasL2 = items.some(it => it.children.length > 0)
  const NW = 118, NH = 30, HGAP = 40, VGAP = 10, PAD_TOP = 8
  const cols = hasL2 ? 3 : 2
  const colX = Array.from({ length: cols }, (_, c) => 16 + c * (NW + HGAP))

  // Count total leaf rows
  const totalLeaves = hasL2
    ? items.reduce((a, it) => a + Math.max(it.children.length, 1), 0)
    : items.length

  const TITLE_H = 8  // root node acts as title; suppress header
  const H = TITLE_H + PAD_TOP + totalLeaves * (NH + VGAP) - VGAP + PAD_TOP + 10
  const W = colX[cols - 1] + NW + 16

  const parts: string[] = []
  const rootLabel = spec.title ?? items[0].label

  // Draw tree
  let leafRow = 0
  const l1Mids: number[] = []

  items.forEach((l1) => {
    const leaves = hasL2 ? Math.max(l1.children.length, 1) : 1
    const l1SpanTop = TITLE_H + PAD_TOP + leafRow * (NH + VGAP)
    const l1SpanH = leaves * (NH + VGAP) - VGAP
    const l1Mid = l1SpanTop + l1SpanH / 2
    l1Mids.push(l1Mid)

    // L1 box
    const l1x = colX[hasL2 ? 1 : 0]
    const l1y = l1Mid - NH / 2
    parts.push(`<rect x="${l1x}" y="${l1y.toFixed(1)}" width="${NW}" height="${NH}" rx="5" fill="${theme.primary}2e" stroke="${theme.primary}88" stroke-width="1.5"/>`)
    parts.push(`<text x="${(l1x+NW/2).toFixed(1)}" y="${(l1y+20).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(l1.label, 15)}</text>`)

    if (hasL2) {
      const midX = colX[1] + NW
      const childX = colX[2]
      const elbowX = midX + HGAP / 2

      l1.children.forEach((l2, j) => {
        const l2y = TITLE_H + PAD_TOP + (leafRow + j) * (NH + VGAP)
        const l2Mid = l2y + NH / 2
        const done = l2.attrs.includes('done')
        const active = l2.attrs.includes('active') || l2.attrs.includes('wip')

        // Elbow connector
        parts.push(`<path d="M${midX},${l1Mid.toFixed(1)} H${elbowX} V${l2Mid.toFixed(1)} H${childX}" fill="none" stroke="${theme.border}" stroke-width="1.2"/>`)

        // L2 box
        const l2Fill = done ? `${theme.accent}22` : theme.surface
        const l2Stroke = done ? theme.accent : active ? `${theme.accent}88` : theme.border
        parts.push(`<rect x="${childX}" y="${l2y.toFixed(1)}" width="${NW}" height="${NH}" rx="4" fill="${l2Fill}" stroke="${l2Stroke}" stroke-width="${active ? 1.5 : 1}"/>`)
        const l2Col = done ? theme.accent : active ? theme.text : theme.textMuted
        parts.push(`<text x="${(childX+NW/2).toFixed(1)}" y="${(l2y+20).toFixed(1)}" text-anchor="middle" font-size="10" fill="${l2Col}" font-family="system-ui,sans-serif" ${done ? 'text-decoration="line-through"' : ''}>${tt(l2.label, 15)}</text>`)
      })
    }

    leafRow += leaves
  })

  // Vertical spine and root
  if (hasL2 && l1Mids.length > 0) {
    const spineX = colX[1] - HGAP / 2
    parts.push(`<line x1="${spineX}" y1="${l1Mids[0].toFixed(1)}" x2="${spineX}" y2="${l1Mids[l1Mids.length-1].toFixed(1)}" stroke="${theme.border}" stroke-width="1.5"/>`)
    l1Mids.forEach(mid => parts.push(`<line x1="${spineX}" y1="${mid.toFixed(1)}" x2="${colX[1]}" y2="${mid.toFixed(1)}" stroke="${theme.border}" stroke-width="1.2"/>`))

    const rootMid = (l1Mids[0] + l1Mids[l1Mids.length - 1]) / 2
    const rootX = colX[0]
    parts.push(`<rect x="${rootX}" y="${(rootMid-NH/2).toFixed(1)}" width="${NW}" height="${NH}" rx="6" fill="${theme.accent}33" stroke="${theme.accent}99" stroke-width="2"/>`)
    parts.push(`<text x="${(rootX+NW/2).toFixed(1)}" y="${(rootMid+5).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="700">${tt(rootLabel, 15)}</text>`)
    parts.push(`<line x1="${rootX+NW}" y1="${rootMid.toFixed(1)}" x2="${spineX}" y2="${rootMid.toFixed(1)}" stroke="${theme.border}" stroke-width="1.5"/>`)
  }

  return svgWrap(W, H, theme, undefined, parts)  // title rendered as root node inline
}

// ── Shared ────────────────────────────────────────────────────────────────────

function svgWrap(W: number, H: number, theme: MdArtTheme, title: string | undefined, parts: string[]): string {
  const titleEl = title
    ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>`
    : ''
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl}
  ${parts.join('\n  ')}
</svg>`
}

function renderEmpty(theme: MdArtTheme): string {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`
}
