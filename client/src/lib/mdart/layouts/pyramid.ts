import type { MdArtSpec } from '../parser'
import type { MdArtTheme } from '../theme'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  const l = (a: number, b: number) => Math.round(a + (b - a) * t)
  return '#' + [l(r1, r2), l(g1, g2), l(b1, b2)].map(v => v.toString(16).padStart(2, '0')).join('')
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderPyramid(spec: MdArtSpec, theme: MdArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const inverted = spec.type === 'inverted-pyramid' || spec.type === 'inverted'
  const n = items.length
  const W = 600
  const MARGIN_TOP = spec.title ? 34 : 12
  const MARGIN_BOTTOM = 16
  const LAYER_H = Math.min(62, Math.max(28, (340 - MARGIN_TOP - MARGIN_BOTTOM) / n))
  const H = MARGIN_TOP + n * LAYER_H + MARGIN_BOTTOM
  const MAX_W = W - 40   // widest
  const MIN_W = 44       // apex

  const shapes: string[] = []
  const labels: string[] = []

  for (let i = 0; i < n; i++) {
    // In a normal pyramid: item[0] = apex (top/narrow), item[n-1] = base (bottom/wide)
    // In inverted pyramid:  item[0] = top (wide), item[n-1] = apex (bottom/narrow)
    const item = items[i]

    let topW: number, botW: number
    if (inverted) {
      topW = MIN_W + ((n - i) / n) * (MAX_W - MIN_W)
      botW = MIN_W + ((n - i - 1) / n) * (MAX_W - MIN_W)
    } else {
      topW = MIN_W + (i / n) * (MAX_W - MIN_W)
      botW = MIN_W + ((i + 1) / n) * (MAX_W - MIN_W)
    }

    const y = MARGIN_TOP + i * LAYER_H
    const cxPos = W / 2

    const topLeft  = cxPos - topW / 2
    const topRight = cxPos + topW / 2
    const botLeft  = cxPos - botW / 2
    const botRight = cxPos + botW / 2

    // Color gradient: primary at narrow end → muted at wide end
    const narrowT = inverted ? 1 - i / Math.max(n - 1, 1) : i / Math.max(n - 1, 1)
    const fill = lerpColor(theme.primary, theme.muted, narrowT * 0.7)

    shapes.push(
      `<polygon points="${topLeft.toFixed(1)},${y.toFixed(1)} ${topRight.toFixed(1)},${y.toFixed(1)} ${botRight.toFixed(1)},${(y + LAYER_H).toFixed(1)} ${botLeft.toFixed(1)},${(y + LAYER_H).toFixed(1)}" fill="${fill}" stroke="${theme.bg}" stroke-width="2"/>`,
    )

    // Label — shrink font when layer is narrow
    const midW = (topW + botW) / 2
    const fontSize = midW > 140 ? 12 : midW > 80 ? 11 : midW > 50 ? 9 : 8
    const textY = y + LAYER_H / 2 + fontSize / 3
    const maxChars = Math.max(4, Math.floor(midW / 7))
    labels.push(
      `<text x="${cxPos.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="middle" font-size="${fontSize}" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, maxChars))}</text>`,
    )

    // Optional side label when layer is too narrow to hold text
    if (midW < 60 && item.label) {
      const sideX = cxPos + Math.max(topW, botW) / 2 + 8
      labels.push(
        `<text x="${sideX.toFixed(1)}" y="${textY.toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, 20))}</text>`,
      )
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ''}
  ${shapes.join('\n  ')}
  ${labels.join('\n  ')}
</svg>`
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function renderEmpty(theme: MdArtTheme): string {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`
}
