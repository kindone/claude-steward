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
    case 'scorecard':    return renderScorecard(spec, theme)
    case 'treemap':      return renderTreemap(spec, theme)
    default:             return renderProgressList(spec, theme) // progress-list, bullet-chart
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
