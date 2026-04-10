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

export function renderPlanning(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'gantt':
    case 'gantt-lite': return renderGantt(spec, theme)
    default:           return renderKanban(spec, theme)  // kanban, sprint-board
  }
}

// ── Kanban ────────────────────────────────────────────────────────────────────
// Top-level items = columns; children = cards
// Syntax: `- Column\n  - Card [done]`

function renderKanban(spec: SmartArtSpec, theme: SmartArtTheme): string {
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
    parts.push(`<text x="${(colX + COL_W / 2).toFixed(1)}" y="${(colY + 21).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(col.label, 14))}</text>`)

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
        `<text x="${(cardX + 10).toFixed(1)}" y="${(cardY + 17).toFixed(1)}" font-size="11" fill="${isDone ? theme.muted : theme.text}" font-family="system-ui,sans-serif" ${isDone ? 'text-decoration="line-through"' : ''}>${escapeXml(truncate(card.label, Math.floor(cardW / 7)))}</text>`,
      )
    })
  })

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── Gantt / Gantt-lite ────────────────────────────────────────────────────────
// Syntax: `- Task [wk1-wk4]` or `- Task: 1-4`
// Time unit labels auto-generated as integers

function renderGantt(spec: SmartArtSpec, theme: SmartArtTheme): string {
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
    parts.push(`<text x="${(LABEL_W - 8).toFixed(1)}" y="${(y + 21).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(row.label, 18))}</text>`)

    // Bar
    const barX = LABEL_W + (row.start / maxEnd) * BAR_AREA
    const barW = Math.max(6, ((row.end - row.start) / maxEnd) * BAR_AREA)
    parts.push(`<rect x="${barX.toFixed(1)}" y="${(y + 8).toFixed(1)}" width="${barW.toFixed(1)}" height="18" rx="4" fill="${theme.accent}88" stroke="${theme.accent}" stroke-width="1"/>`)
  })

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── Shared ────────────────────────────────────────────────────────────────────

function svgWrap(W: number, H: number, theme: SmartArtTheme, title: string | undefined, parts: string[]): string {
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
