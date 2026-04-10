import type { SmartArtItem, SmartArtSpec } from '../parser'
import type { SmartArtTheme } from '../theme'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function countLeaves(item: SmartArtItem): number {
  if (item.children.length === 0) return 1
  return item.children.reduce((s, c) => s + countLeaves(c), 0)
}

function maxDepth(items: SmartArtItem[]): number {
  if (items.length === 0) return 0
  return 1 + Math.max(...items.map(i => maxDepth(i.children)))
}

// ── Tree node layout ──────────────────────────────────────────────────────────

interface RenderedNode {
  label: string
  x: number
  y: number
  parentX?: number
  parentY?: number
  children: RenderedNode[]
}

function layoutNodes(
  items: SmartArtItem[],
  startX: number,
  y: number,
  totalW: number,
  levelH: number,
  parentCx?: number,
  parentCy?: number,
): RenderedNode[] {
  const totalLeaves = items.reduce((s, i) => s + countLeaves(i), 0) || 1
  let cx = startX
  return items.map(item => {
    const myLeaves = countLeaves(item)
    const myW = (myLeaves / totalLeaves) * totalW
    const nx = cx + myW / 2
    const node: RenderedNode = {
      label: item.label,
      x: nx,
      y,
      parentX: parentCx,
      parentY: parentCy,
      children: layoutNodes(item.children, cx, y + levelH, myW, levelH, nx, y),
    }
    cx += myW
    return node
  })
}

function flatNodes(nodes: RenderedNode[]): RenderedNode[] {
  return nodes.flatMap(n => [n, ...flatNodes(n.children)])
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function renderHierarchy(spec: SmartArtSpec, theme: SmartArtTheme): string {
  if (spec.type === 'mind-map') return renderMindMap(spec, theme)
  return renderOrgChart(spec, theme)
}

// ── Org-chart / tree ──────────────────────────────────────────────────────────

const BOX_W = 110
const BOX_H = 30

function renderOrgChart(spec: SmartArtSpec, theme: SmartArtTheme): string {
  if (spec.items.length === 0) return renderEmpty(theme)

  const W = 640
  const depth = maxDepth(spec.items)
  const levelH = spec.type === 'tree' ? 68 : 86
  const TITLE_H = spec.title ? 28 : 10
  const H = Math.max(160, depth * levelH + TITLE_H + 30)
  const startY = TITLE_H + BOX_H / 2

  const nodes = layoutNodes(spec.items, 0, startY, W, levelH)
  const flat = flatNodes(nodes)

  const lines: string[] = []
  const boxes: string[] = []

  for (const n of flat) {
    if (n.parentX !== undefined && n.parentY !== undefined) {
      const x1 = n.parentX, y1 = n.parentY + BOX_H / 2
      const x2 = n.x,       y2 = n.y - BOX_H / 2
      const mid = (y1 + y2) / 2
      lines.push(
        `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${theme.border}" stroke-width="1.5"/>`
      )
    }
    const bx = n.x - BOX_W / 2
    const by = n.y - BOX_H / 2
    boxes.push(
      `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1.2"/>`,
      `<text x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(n.label, 15))}</text>`,
    )
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${(W / 2).toFixed(1)}" y="18" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ''}
  ${lines.join('\n  ')}
  ${boxes.join('\n  ')}
</svg>`
}

// ── Mind-map (radial) ─────────────────────────────────────────────────────────

function renderMindMap(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const W = 640, H = 480
  const cx = W / 2, cy = H / 2

  // Determine center label and branches
  let centerLabel: string
  let branches: SmartArtItem[]

  if (spec.title) {
    centerLabel = spec.title
    branches = spec.items
  } else if (spec.items.length === 1) {
    centerLabel = spec.items[0].label
    branches = spec.items[0].children
  } else {
    centerLabel = 'Topic'
    branches = spec.items
  }

  const n = branches.length
  const R1 = 155   // center → branch
  const R2 = 82    // branch → sub-branch

  const parts: string[] = []

  // Center node
  parts.push(
    `<ellipse cx="${cx}" cy="${cy}" rx="64" ry="24" fill="${theme.accent}44" stroke="${theme.accent}" stroke-width="1.5"/>`,
    `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(centerLabel, 14))}</text>`,
  )

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2
    const bx = cx + R1 * Math.cos(angle)
    const by = cy + R1 * Math.sin(angle)
    const branch = branches[i]

    // Connector from center to branch
    parts.push(
      `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${theme.accent}55" stroke-width="2"/>`
    )

    // Branch node (ellipse)
    parts.push(
      `<ellipse cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" rx="50" ry="20" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1"/>`,
      `<text x="${bx.toFixed(1)}" y="${(by + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(branch.label, 13))}</text>`,
    )

    // Sub-branches
    const subs = branch.children
    const ns = subs.length
    for (let j = 0; j < ns; j++) {
      const spread = Math.min(Math.PI * 0.55, Math.max(0.3, (ns - 1) * 0.35))
      const subAngle = ns <= 1
        ? angle
        : angle + (j - (ns - 1) / 2) * (spread / Math.max(ns - 1, 1))
      const sx = bx + R2 * Math.cos(subAngle)
      const sy = by + R2 * Math.sin(subAngle)

      parts.push(
        `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${theme.muted}" stroke-width="1" opacity="0.8"/>`,
        `<text x="${sx.toFixed(1)}" y="${(sy + 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(truncate(subs[j].label, 11))}</text>`,
      )
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join('\n  ')}
</svg>`
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function renderEmpty(theme: SmartArtTheme): string {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`
}
