import type { SmartArtSpec } from '../parser'
import type { SmartArtTheme } from '../theme'

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

export function renderTechnical(spec: SmartArtSpec, theme: SmartArtTheme): string {
  switch (spec.type) {
    case 'entity':       return renderEntity(spec, theme)
    case 'network':      return renderNetwork(spec, theme)
    case 'pipeline':     return renderPipeline(spec, theme)
    default:             return renderLayeredArch(spec, theme) // layered-arch
  }
}

// ── Layered architecture ──────────────────────────────────────────────────────
// Top-level items = layers (top to bottom); children = components in that layer
// Syntax: `- Layer Name\n  - Component A\n  - Component B`

function renderLayeredArch(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const layers = spec.items
  if (layers.length === 0) return renderEmpty(theme)

  const W = 600
  const TITLE_H = spec.title ? 30 : 8
  const LAYER_H = 62
  const GAP = 6
  const H = TITLE_H + layers.length * (LAYER_H + GAP) + 16

  const parts: string[] = []

  // Arrow marker for connectors
  parts.push(`<defs><marker id="la-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${theme.muted}"/></marker></defs>`)

  layers.forEach((layer, i) => {
    const y = TITLE_H + 8 + i * (LAYER_H + GAP)
    const t = i / Math.max(layers.length - 1, 1)
    const fill = lerpColor(theme.primary, theme.secondary, t)

    // Layer band
    parts.push(`<rect x="8" y="${y.toFixed(1)}" width="${W - 16}" height="${LAYER_H}" rx="8" fill="${fill}22" stroke="${fill}66" stroke-width="1.2"/>`)

    // Layer name (left column)
    parts.push(`<text x="24" y="${(y + LAYER_H / 2 + 4).toFixed(1)}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(layer.label, 15))}</text>`)

    // Vertical separator
    parts.push(`<line x1="128" y1="${(y + 10).toFixed(1)}" x2="128" y2="${(y + LAYER_H - 10).toFixed(1)}" stroke="${fill}55" stroke-width="1"/>`)

    // Component chips
    let chipX = 140
    const chipY = y + (LAYER_H - 26) / 2
    layer.children.slice(0, 7).forEach(child => {
      const label = truncate(child.label, 13)
      const chipW = label.length * 7 + 18
      if (chipX + chipW > W - 16) return
      parts.push(
        `<rect x="${chipX.toFixed(1)}" y="${chipY.toFixed(1)}" width="${chipW}" height="26" rx="5" fill="${theme.surface}" stroke="${fill}66" stroke-width="1"/>`,
        `<text x="${(chipX + chipW / 2).toFixed(1)}" y="${(chipY + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(label)}</text>`,
      )
      chipX += chipW + 8
    })

    // Connector arrow to next layer
    if (i < layers.length - 1) {
      const ax = W / 2
      const ay1 = y + LAYER_H
      const ay2 = ay1 + GAP
      parts.push(`<line x1="${ax}" y1="${ay1.toFixed(1)}" x2="${ax}" y2="${ay2.toFixed(1)}" stroke="${theme.muted}" stroke-width="1.5" marker-end="url(#la-arr)"/>`)
    }
  })

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── Entity / ER diagram ───────────────────────────────────────────────────────
// Top-level items = entity tables; children = fields with [PK] / [FK] attrs
// Syntax: `- User\n  - id [PK]\n  - email\n  - role_id [FK]`

function renderEntity(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const entities = spec.items
  if (entities.length === 0) return renderEmpty(theme)

  const W = 600
  const TITLE_H = spec.title ? 30 : 8
  const n = entities.length
  const GAP = 14
  const ENT_W = Math.min(170, (W - (n + 1) * GAP) / n)
  const HEADER_H = 30
  const FIELD_H = 22
  const ENT_H = HEADER_H + Math.max(...entities.map(e => e.children.length), 1) * FIELD_H + 8
  const totalW = n * ENT_W + (n - 1) * GAP
  const startX = (W - totalW) / 2
  const H = TITLE_H + ENT_H + 32

  const parts: string[] = []

  entities.forEach((entity, i) => {
    const x = startX + i * (ENT_W + GAP)
    const y = TITLE_H + 12

    // Entity box
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${ENT_W}" height="${ENT_H}" rx="6" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1.5"/>`)

    // Header — rounded top via path
    parts.push(
      `<path d="M${(x + 6).toFixed(1)},${y.toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${(y + 6).toFixed(1)} L${x.toFixed(1)},${(y + HEADER_H).toFixed(1)} L${(x + ENT_W).toFixed(1)},${(y + HEADER_H).toFixed(1)} L${(x + ENT_W).toFixed(1)},${(y + 6).toFixed(1)} Q${(x + ENT_W).toFixed(1)},${y.toFixed(1)} ${(x + ENT_W - 6).toFixed(1)},${y.toFixed(1)} Z" fill="${theme.accent}33"/>`,
      `<text x="${(x + ENT_W / 2).toFixed(1)}" y="${(y + 19).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(truncate(entity.label, 14))}</text>`,
    )

    // Divider
    parts.push(`<line x1="${x.toFixed(1)}" y1="${(y + HEADER_H).toFixed(1)}" x2="${(x + ENT_W).toFixed(1)}" y2="${(y + HEADER_H).toFixed(1)}" stroke="${theme.accent}44" stroke-width="1"/>`)

    // Fields
    entity.children.forEach((field, fi) => {
      const fy = y + HEADER_H + fi * FIELD_H + 14
      const isPK = field.attrs.includes('PK')
      const isFK = field.attrs.includes('FK')
      const textColor = isPK ? theme.accent : isFK ? '#c4b5fd' : theme.textMuted

      parts.push(`<text x="${(x + 10).toFixed(1)}" y="${fy.toFixed(1)}" font-size="10" fill="${textColor}" font-family="ui-monospace,monospace">${escapeXml(truncate(field.label, 16))}</text>`)

      if (isPK || isFK) {
        const badge = isPK ? 'PK' : 'FK'
        const badgeColor = isPK ? theme.accent : '#a78bfa'
        const bx = x + ENT_W - 28
        parts.push(
          `<rect x="${bx.toFixed(1)}" y="${(fy - 11).toFixed(1)}" width="24" height="13" rx="3" fill="${badgeColor}22" stroke="${badgeColor}66" stroke-width="0.5"/>`,
          `<text x="${(bx + 12).toFixed(1)}" y="${(fy - 1).toFixed(1)}" text-anchor="middle" font-size="8" fill="${badgeColor}" font-family="system-ui,sans-serif" font-weight="600">${badge}</text>`,
        )
      }
    })
  })

  return svgWrap(W, H, theme, spec.title, parts)
}

// ── Network / graph ───────────────────────────────────────────────────────────
// All top-level items + all flow-child targets become nodes.
// `→ Target` children under an item draw directed edges.
// Syntax: `- Service A\n  → Service B\n  → Service C`

function renderNetwork(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  // Collect all unique node labels: top-level items first, then any flow-child
  // targets that aren't already listed as top-level items.
  const allLabels: string[] = items.map(it => it.label)
  items.forEach(it => {
    it.flowChildren.forEach(fc => {
      if (!allLabels.includes(fc.label)) allLabels.push(fc.label)
    })
  })

  const n = allLabels.length
  const W = 580, H = 420
  const cx = W / 2, cy = H / 2
  // Scale radius to fit more nodes; clamp between 100–200
  const R = Math.min(200, Math.max(100, 80 + n * 18))
  const NODE_W = 104, NODE_H = 30

  // Position all nodes in a circle
  const positions = allLabels.map((_, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2
    return { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) }
  })

  // Label → index map covers ALL nodes
  const labelIndex = new Map(allLabels.map((lbl, i) => [lbl, i]))

  const edges: string[] = []
  const nodes: string[] = []

  // Arrow marker
  edges.push(`<defs><marker id="net-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${theme.muted}99"/></marker></defs>`)

  // Edges from flow children
  items.forEach(item => {
    const si = labelIndex.get(item.label) ?? -1
    if (si < 0) return
    const src = positions[si]
    item.flowChildren.forEach(fc => {
      const ti = labelIndex.get(fc.label) ?? -1
      if (ti < 0) return
      const dst = positions[ti]
      const dx = dst.x - src.x, dy = dst.y - src.y
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const x1 = src.x + (dx / len) * (NODE_W / 2 + 2)
      const y1 = src.y + (dy / len) * (NODE_H / 2 + 2)
      const x2 = dst.x - (dx / len) * (NODE_W / 2 + 10)
      const y2 = dst.y - (dy / len) * (NODE_H / 2 + 6)
      edges.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${theme.muted}88" stroke-width="1.5" marker-end="url(#net-arr)"/>`)
    })
  })

  // Nodes — top-level items get accent border; implied nodes get muted border
  const topLevelSet = new Set(items.map(it => it.label))
  allLabels.forEach((label, i) => {
    const { x, y } = positions[i]
    const isTop = topLevelSet.has(label)
    const stroke = isTop ? `${theme.accent}88` : `${theme.muted}66`
    const fill = isTop ? theme.surface : `${theme.surface}cc`
    nodes.push(
      `<rect x="${(x - NODE_W / 2).toFixed(1)}" y="${(y - NODE_H / 2).toFixed(1)}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
      `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(label, 13))}</text>`,
    )
  })

  return svgWrap(W, H, theme, spec.title, [...edges, ...nodes])
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
// Horizontal stages with chevron arrows — like process but technical look
// Syntax: `- Stage A → Stage B → Stage C` or bullet list

function renderPipeline(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const items = spec.items
  if (items.length === 0) return renderEmpty(theme)

  const W = 600
  const TITLE_H = spec.title ? 30 : 8
  const H = 100 + TITLE_H
  const n = items.length
  const ARROW_W = 18
  const STAGE_W = (W - 24 - (n - 1) * ARROW_W) / n
  const STAGE_H = 50
  const stageY = TITLE_H + (H - TITLE_H - STAGE_H) / 2

  const parts: string[] = []

  items.forEach((item, i) => {
    const x = 12 + i * (STAGE_W + ARROW_W)
    const t = i / Math.max(n - 1, 1)
    const fill = lerpColor(theme.primary, theme.secondary, t)

    parts.push(
      `<rect x="${x.toFixed(1)}" y="${stageY.toFixed(1)}" width="${STAGE_W.toFixed(1)}" height="${STAGE_H}" rx="6" fill="${fill}33" stroke="${fill}99" stroke-width="1.5"/>`,
      `<text x="${(x + STAGE_W / 2).toFixed(1)}" y="${(stageY + STAGE_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(item.label, Math.floor(STAGE_W / 7)))}</text>`,
    )

    // Chevron arrow
    if (i < n - 1) {
      const ax = x + STAGE_W + 4
      const ay = stageY + STAGE_H / 2
      parts.push(`<path d="M${ax.toFixed(1)},${(ay - 6).toFixed(1)} L${(ax + ARROW_W - 4).toFixed(1)},${ay.toFixed(1)} L${ax.toFixed(1)},${(ay + 6).toFixed(1)}" fill="${theme.muted}99" stroke="none"/>`)
    }
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
