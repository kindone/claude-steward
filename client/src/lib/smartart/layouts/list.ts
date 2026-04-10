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

export function renderList(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'numbered-list': return renderNumberedList(spec, theme)
    case 'checklist':     return renderChecklist(spec, theme)
    case 'two-column-list': return renderTwoColumnList(spec, theme)
    case 'timeline-list': return renderTimelineList(spec, theme)
    default:              return renderBulletList(spec, theme)
  }
}

// ── Bullet list ───────────────────────────────────────────────────────────────

function renderBulletList(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

function renderNumberedList(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

function renderChecklist(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

function renderTwoColumnList(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

function renderTimelineList(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

function renderEmpty(theme: SmartArtTheme): string {
  return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
    <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
  </svg>`
}
