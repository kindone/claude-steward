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

export function renderCycle(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'donut-cycle': return renderDonutCycle(spec, theme)
    default:            return renderCircleCycle(spec, theme)
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

  let svgContent = ''

  // Draw curved arrows first (below nodes)
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    const nextAngle = (2 * Math.PI * ((i + 1) % n)) / n - Math.PI / 2

    const x1 = cx + R * Math.cos(angle)
    const y1 = cy + R * Math.sin(angle)
    const x2 = cx + R * Math.cos(nextAngle)
    const y2 = cy + R * Math.sin(nextAngle)

    // Mid-angle control point (curved outward)
    const midAngle = (angle + nextAngle) / 2
    const controlR = R * 1.3
    const qx = cx + controlR * Math.cos(midAngle)
    const qy = cy + controlR * Math.sin(midAngle)

    const t = i / (n - 1 || 1)
    const arrowColor = lerpColor(theme.secondary, theme.primary, t)

    // Simple curved path
    svgContent += `<path d="M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}" fill="none" stroke="${arrowColor}" stroke-width="1.5" stroke-dasharray="4,2" />`
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

function renderEmpty(theme: SmartArtTheme): string {
  return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
    <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
  </svg>`
}
