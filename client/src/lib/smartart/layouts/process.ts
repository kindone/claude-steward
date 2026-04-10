import type { SmartArtSpec } from '../parser'
import type { SmartArtTheme } from '../theme'

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

export function renderProcess(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'funnel': return renderFunnel(spec, theme)
    case 'roadmap': return renderRoadmap(spec, theme)
    default: return renderHorizontalProcess(spec, theme)
  }
}

function renderHorizontalProcess(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

function renderVerticalProcess(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

function renderFunnel(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

function renderRoadmap(spec: SmartArtSpec, theme: SmartArtTheme): string {
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

// ── Shared helpers ────────────────────────────────────────────────────────────

function renderEmpty(theme: SmartArtTheme): string {
  return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
    <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
  </svg>`
}
