import type { MdArtItem, MdArtSpec } from '../parser'
import type { MdArtTheme } from '../theme'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function countLeaves(item: MdArtItem): number {
  if (item.children.length === 0) return 1
  return item.children.reduce((s, c) => s + countLeaves(c), 0)
}

function maxDepth(items: MdArtItem[]): number {
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
  items: MdArtItem[],
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

export function renderHierarchy(spec: MdArtSpec, theme: MdArtTheme): string {
  switch (spec.type) {
    case 'mind-map':       return renderMindMap(spec, theme)
    case 'h-org-chart':    return renderHOrgChart(spec, theme)
    case 'hierarchy-list': return renderHierarchyList(spec, theme)
    case 'radial-tree':    return renderRadialTree(spec, theme)
    case 'decision-tree':  return renderDecisionTree(spec, theme)
    case 'sitemap':        return renderSitemap(spec, theme)
    case 'bracket':
    case 'bracket-tree':   return renderBracketTree(spec, theme)
    default:               return renderOrgChart(spec, theme)
  }
}

// ── Org-chart / tree ──────────────────────────────────────────────────────────

const BOX_W = 110
const BOX_H = 30

function renderOrgChart(spec: MdArtSpec, theme: MdArtTheme): string {
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

function renderMindMap(spec: MdArtSpec, theme: MdArtTheme): string {
  const W = 640, H = 480
  const cx = W / 2, cy = H / 2

  // Determine center label and branches
  let centerLabel: string
  let branches: MdArtItem[]

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

// ── H-org-chart (left-to-right) ───────────────────────────────────────────────

function renderHOrgChart(spec: MdArtSpec, theme: MdArtTheme): string {
  if (spec.items.length === 0) return renderEmpty(theme)
  const depth = maxDepth(spec.items)
  const totalLeaves = spec.items.reduce((s, i) => s + countLeaves(i), 0) || 1
  const ROW_H = 40, COL_W = 140, NODE_W = 110, NODE_H = 28
  const TITLE_H = spec.title ? 28 : 8
  const W = depth * COL_W + NODE_W + 20
  const H = Math.max(100, totalLeaves * ROW_H + TITLE_H + 20)

  interface HNode { label: string; x: number; y: number; parentX?: number; parentY?: number }
  const hnodes: HNode[] = []

  function layoutH(items: MdArtItem[], level: number, leafStart: number, totalH: number, px?: number, py?: number) {
    const tot = items.reduce((s, i) => s + countLeaves(i), 0) || 1
    let leafY = leafStart
    for (const item of items) {
      const leaves = countLeaves(item)
      const span = (leaves / tot) * totalH
      const ny = leafY + span / 2
      const nx = 10 + level * COL_W + NODE_W / 2
      hnodes.push({ label: item.label, x: nx, y: ny, parentX: px, parentY: py })
      layoutH(item.children, level + 1, leafY, span, nx + NODE_W / 2, ny)
      leafY += span
    }
  }
  layoutH(spec.items, 0, TITLE_H + 10, H - TITLE_H - 20)

  const lines: string[] = [], boxes: string[] = []
  for (const n of hnodes) {
    if (n.parentX !== undefined && n.parentY !== undefined) {
      const mid = (n.parentX + n.x - NODE_W / 2) / 2
      lines.push(`<path d="M${n.parentX.toFixed(1)},${n.parentY.toFixed(1)} H${mid.toFixed(1)} V${n.y.toFixed(1)} H${(n.x - NODE_W / 2).toFixed(1)}" fill="none" stroke="${theme.border}" stroke-width="1.5"/>`)
    }
    const bx = n.x - NODE_W / 2, by = n.y - NODE_H / 2
    boxes.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${NODE_W}" height="${NODE_H}" rx="5" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1.2"/>`)
    boxes.push(`<text x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(n.label, 14))}</text>`)
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${(W/2).toFixed(1)}" y="18" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ''}
  ${lines.join('\n  ')}
  ${boxes.join('\n  ')}
</svg>`
}

// ── Hierarchy-list (file-explorer tree) ───────────────────────────────────────

function renderHierarchyList(spec: MdArtSpec, theme: MdArtTheme): string {
  interface Row { label: string; depth: number; isLast: boolean; parentHasSibling: boolean[] }
  const rows: Row[] = []
  function flatten(items: MdArtItem[], depth: number, phs: boolean[]) {
    items.forEach((item, i) => {
      const isLast = i === items.length - 1
      rows.push({ label: item.label, depth, isLast, parentHasSibling: [...phs] })
      flatten(item.children, depth + 1, [...phs, !isLast])
    })
  }
  flatten(spec.items, 0, [])

  const W = 560, ROW_H = 23, INDENT = 18, PAD = 14
  const TITLE_H = spec.title ? 28 : 8
  const H = TITLE_H + rows.length * ROW_H + 12

  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${PAD}" y="20" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`)

  rows.forEach((row) => {
    const y = TITLE_H + rows.indexOf(row) * ROW_H + ROW_H / 2
    const bulletX = PAD + row.depth * INDENT

    if (row.depth > 0) {
      // Ancestor trunk lines (depths 0..depth-2)
      for (let d = 0; d < row.depth - 1; d++) {
        if (row.parentHasSibling[d]) {
          const lx = PAD + d * INDENT + INDENT - 4
          parts.push(`<line x1="${lx}" y1="${(y - ROW_H / 2).toFixed(1)}" x2="${lx}" y2="${(y + ROW_H / 2).toFixed(1)}" stroke="${theme.border}35" stroke-width="1"/>`)
        }
      }
      // Parent L-connector
      const px = PAD + (row.depth - 1) * INDENT + INDENT - 4
      parts.push(`<line x1="${px}" y1="${(y - ROW_H / 2).toFixed(1)}" x2="${px}" y2="${y.toFixed(1)}" stroke="${theme.border}35" stroke-width="1"/>`)
      if (!row.isLast) parts.push(`<line x1="${px}" y1="${y.toFixed(1)}" x2="${px}" y2="${(y + ROW_H / 2).toFixed(1)}" stroke="${theme.border}35" stroke-width="1"/>`)
      parts.push(`<line x1="${px}" y1="${y.toFixed(1)}" x2="${(bulletX - 2).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${theme.border}35" stroke-width="1"/>`)
    }

    const bR = row.depth === 0 ? 5 : row.depth === 1 ? 3.5 : 2.5
    const bFill = row.depth === 0 ? theme.accent : row.depth === 1 ? theme.primary : theme.secondary
    parts.push(`<circle cx="${(bulletX + bR).toFixed(1)}" cy="${y.toFixed(1)}" r="${bR}" fill="${bFill}"/>`)

    const textX = bulletX + bR * 2 + 4
    const fs = row.depth === 0 ? 12 : row.depth === 1 ? 11 : 10
    const fw = row.depth === 0 ? '700' : '400'
    const tf = row.depth === 0 ? theme.text : row.depth === 1 ? theme.text : theme.textMuted
    parts.push(`<text x="${textX.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="${fs}" fill="${tf}" font-family="system-ui,sans-serif" font-weight="${fw}">${escapeXml(truncate(row.label, 40))}</text>`)
  })

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join('\n  ')}
</svg>`
}

// ── Radial-tree (hub and spoke) ────────────────────────────────────────────────

function renderRadialTree(spec: MdArtSpec, theme: MdArtTheme): string {
  const W = 600, H = 500
  const cx = W / 2, cy = H / 2
  let centerLabel: string, branches: MdArtItem[]
  if (spec.title) {
    centerLabel = spec.title; branches = spec.items
  } else if (spec.items.length === 1) {
    centerLabel = spec.items[0].label; branches = spec.items[0].children
  } else {
    centerLabel = 'Root'; branches = spec.items
  }

  const n = branches.length || 1
  const R1 = 150, R2 = 72
  const parts: string[] = []

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2
    const bx = cx + R1 * Math.cos(angle), by = cy + R1 * Math.sin(angle)
    const branch = branches[i]
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${theme.accent}50" stroke-width="2.5"/>`)

    const subs = branch.children, ns = subs.length
    for (let j = 0; j < ns; j++) {
      const spread = Math.min(Math.PI * 0.5, Math.max(0.4, (ns - 1) * 0.38))
      const sa = ns <= 1 ? angle : angle + (j - (ns - 1) / 2) * (spread / Math.max(ns - 1, 1))
      const sx = bx + R2 * Math.cos(sa), sy = by + R2 * Math.sin(sa)
      parts.push(`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${theme.border}88" stroke-width="1.5"/>`)
      parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="14" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`)
      parts.push(`<text x="${sx.toFixed(1)}" y="${(sy + 3.5).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(subs[j].label, 9))}</text>`)
    }
    parts.push(`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="22" fill="${theme.primary}" stroke="${theme.bg}" stroke-width="2"/>`)
    const ws = branch.label.split(' ')
    if (ws.length === 1) {
      parts.push(`<text x="${bx.toFixed(1)}" y="${(by + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${escapeXml(truncate(branch.label, 9))}</text>`)
    } else {
      const m = Math.ceil(ws.length / 2)
      parts.push(`<text x="${bx.toFixed(1)}" y="${(by - 1).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${escapeXml(truncate(ws.slice(0,m).join(' '), 9))}</text>`)
      parts.push(`<text x="${bx.toFixed(1)}" y="${(by + 9).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${escapeXml(truncate(ws.slice(m).join(' '), 9))}</text>`)
    }
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="32" fill="${theme.accent}" stroke="${theme.bg}" stroke-width="2"/>`)
  const cw = centerLabel.split(' ')
  if (cw.length === 1) {
    parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${escapeXml(truncate(centerLabel, 12))}</text>`)
  } else {
    const m = Math.ceil(cw.length / 2)
    parts.push(`<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="10" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${escapeXml(truncate(cw.slice(0,m).join(' '), 12))}</text>`)
    parts.push(`<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="10" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${escapeXml(truncate(cw.slice(m).join(' '), 12))}</text>`)
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join('\n  ')}
</svg>`
}

// ── Decision-tree (diamonds + leaves) ─────────────────────────────────────────

function renderDecisionTree(spec: MdArtSpec, theme: MdArtTheme): string {
  if (spec.items.length === 0) return renderEmpty(theme)
  const W = 640
  const depth = maxDepth(spec.items)
  const levelH = 80
  const TITLE_H = spec.title ? 28 : 10
  const H = Math.max(160, depth * levelH + TITLE_H + 40)
  const DW = 54, DH = 18         // diamond half-dimensions
  const LW = 90, LH = 26         // leaf box dimensions
  const startY = TITLE_H + DH

  const nodes = layoutNodes(spec.items, 0, startY, W, levelH)
  const flat = flatNodes(nodes)

  const lines: string[] = [], shapes: string[] = []

  for (const n of flat) {
    if (n.parentX !== undefined && n.parentY !== undefined) {
      const isLeaf = n.children.length === 0
      const x1 = n.parentX, y1 = n.parentY + DH
      const x2 = n.x,       y2 = isLeaf ? n.y - LH / 2 : n.y - DH
      const mid = (y1 + y2) / 2
      lines.push(`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${theme.border}88" stroke-width="1.5"/>`)
      // Yes/No edge label when parent has exactly 2 children
      const siblings = n.parentX !== undefined ? flat.filter(s => s.parentX === n.parentX && s.parentY === n.parentY) : []
      if (siblings.length === 2) {
        const isFirst = siblings[0] === n
        const lx = (x1 + x2) / 2 + (isFirst ? -18 : 12)
        const ly = (y1 + y2) / 2
        const lbl = isFirst ? 'Yes' : 'No'
        const lcolor = isFirst ? theme.primary : theme.secondary
        lines.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" fill="${lcolor}" font-family="system-ui,sans-serif" font-weight="700">${lbl}</text>`)
      }
    }
    const { x, y } = n
    if (n.children.length > 0) {
      shapes.push(`<polygon points="${x},${(y-DH).toFixed(1)} ${(x+DW).toFixed(1)},${y} ${x},${(y+DH).toFixed(1)} ${(x-DW).toFixed(1)},${y}" fill="${theme.surface}" stroke="${theme.primary}aa" stroke-width="1.5"/>`)
      shapes.push(`<text x="${x}" y="${(y+4).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(n.label, 10))}</text>`)
    } else {
      const bx = x - LW / 2, by = y - LH / 2
      shapes.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${LW}" height="${LH}" rx="5" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1.2"/>`)
      shapes.push(`<text x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${escapeXml(truncate(n.label, 13))}</text>`)
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${W/2}" y="18" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ''}
  ${lines.join('\n  ')}
  ${shapes.join('\n  ')}
</svg>`
}

// ── Sitemap (wide shallow tree, solid-color boxes) ─────────────────────────────

function renderSitemap(spec: MdArtSpec, theme: MdArtTheme): string {
  if (spec.items.length === 0) return renderEmpty(theme)
  interface SNode { label: string; level: number; x: number; y: number; parentX?: number; parentY?: number }
  const snodes: SNode[] = []
  const W = 640, levelH = 52, TITLE_H = spec.title ? 28 : 10
  const depth = maxDepth(spec.items)
  const H = Math.max(120, depth * levelH + TITLE_H + 30)

  const BW = [90, 76, 64], BH = [26, 22, 18]
  function bw(l: number) { return BW[Math.min(l, 2)] }
  function bh(l: number) { return BH[Math.min(l, 2)] }

  function layout(items: MdArtItem[], level: number, x0: number, x1: number, px?: number, py?: number) {
    const tot = items.reduce((s, i) => s + countLeaves(i), 0) || 1
    let cx2 = x0
    for (const item of items) {
      const leaves = countLeaves(item)
      const myW = (leaves / tot) * (x1 - x0)
      const nx = cx2 + myW / 2
      const ny = TITLE_H + level * levelH + bh(level) / 2
      snodes.push({ label: item.label, level, x: nx, y: ny, parentX: px, parentY: py })
      layout(item.children, level + 1, cx2, cx2 + myW, nx, ny)
      cx2 += myW
    }
  }
  layout(spec.items, 0, 0, W)

  const lines: string[] = [], boxes: string[] = []
  for (const n of snodes) {
    if (n.parentX !== undefined && n.parentY !== undefined) {
      const py = n.parentY + bh(n.level - 1) / 2
      const cy = n.y - bh(n.level) / 2
      lines.push(`<line x1="${n.parentX.toFixed(1)}" y1="${py.toFixed(1)}" x2="${n.x.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${theme.border}55" stroke-width="1.2"/>`)
    }
    const fill = n.level === 0 ? theme.accent : n.level === 1 ? theme.primary : theme.secondary
    boxes.push(`<rect x="${(n.x - bw(n.level)/2).toFixed(1)}" y="${(n.y - bh(n.level)/2).toFixed(1)}" width="${bw(n.level)}" height="${bh(n.level)}" rx="4" fill="${fill}" stroke="${theme.bg}" stroke-width="1.5"/>`)
    const fs = n.level === 0 ? 10 : n.level === 1 ? 9 : 8
    boxes.push(`<text x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${theme.bg}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(truncate(n.label, 12))}</text>`)
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${W/2}" y="18" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ''}
  ${lines.join('\n  ')}
  ${boxes.join('\n  ')}
</svg>`
}

// ── Bracket-tree (tournament bracket) ─────────────────────────────────────────

function renderBracketTree(spec: MdArtSpec, theme: MdArtTheme): string {
  const contestants = spec.items.map(i => i.label)
  if (contestants.length === 0) contestants.push('TBD')
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(contestants.length, 2))))
  const slots = Math.pow(2, rounds)
  const leaves: (string | null)[] = [...contestants]
  while (leaves.length < slots) leaves.push(null)

  const allRounds: (string | null)[][] = [leaves]
  for (let r = 1; r <= rounds; r++) {
    const prev = allRounds[r - 1], curr: (string | null)[] = []
    for (let i = 0; i < prev.length; i += 2) curr.push(prev[i] !== null ? prev[i] : prev[i + 1])
    allRounds.push(curr)
  }

  const TITLE_H = spec.title ? 28 : 8
  const ROW_H = Math.max(20, Math.min(34, 240 / slots))
  const BOX_W = 98, BOX_H = Math.max(16, ROW_H - 8)
  const GAP = 10, COL_W = BOX_W + GAP + 30
  const W = allRounds.length * COL_W + 20
  const leafH = slots * ROW_H
  const H = TITLE_H + leafH + 22

  const parts: string[] = []
  if (spec.title) parts.push(`<text x="${(W/2).toFixed(1)}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`)

  for (let r = 0; r < allRounds.length; r++) {
    const round = allRounds[r], x = 10 + r * COL_W
    const slotH = leafH / round.length
    const isWinner = r === allRounds.length - 1

    for (let s = 0; s < round.length; s++) {
      const label = round[s], nodeY = TITLE_H + s * slotH + slotH / 2, boxY = nodeY - BOX_H / 2
      if (label !== null) {
        const fill = isWinner ? theme.accent : theme.surface
        const stroke = isWinner ? theme.accent : theme.border
        const fw = isWinner ? '700' : r === 0 ? '400' : '600'
        parts.push(`<rect x="${x}" y="${boxY.toFixed(1)}" width="${BOX_W}" height="${BOX_H}" rx="3" fill="${fill}" stroke="${stroke}88" stroke-width="1.2"/>`)
        parts.push(`<text x="${(x + BOX_W/2).toFixed(1)}" y="${(nodeY + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${isWinner ? theme.bg : theme.text}" font-family="system-ui,sans-serif" font-weight="${fw}">${escapeXml(truncate(label, 13))}</text>`)
      } else {
        parts.push(`<rect x="${x}" y="${boxY.toFixed(1)}" width="${BOX_W}" height="${BOX_H}" rx="3" fill="none" stroke="${theme.border}28" stroke-width="1" stroke-dasharray="3,2"/>`)
        parts.push(`<text x="${(x + BOX_W/2).toFixed(1)}" y="${(nodeY + 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.border}44" font-family="system-ui,sans-serif">bye</text>`)
      }
      // Bracket connector (draw for even-indexed pairs)
      if (!isWinner && s % 2 === 0 && s + 1 < round.length) {
        const yA = nodeY, yB = TITLE_H + (s + 1) * slotH + slotH / 2, yMid = (yA + yB) / 2
        const armX = x + BOX_W + GAP, nextX = x + COL_W
        parts.push(`<polyline points="${x+BOX_W},${yA.toFixed(1)} ${armX},${yA.toFixed(1)} ${armX},${yMid.toFixed(1)}" fill="none" stroke="${theme.border}55" stroke-width="1.5"/>`)
        parts.push(`<polyline points="${x+BOX_W},${yB.toFixed(1)} ${armX},${yB.toFixed(1)} ${armX},${yMid.toFixed(1)}" fill="none" stroke="${theme.border}55" stroke-width="1.5"/>`)
        parts.push(`<line x1="${armX}" y1="${yMid.toFixed(1)}" x2="${nextX}" y2="${yMid.toFixed(1)}" stroke="${theme.border}55" stroke-width="1.5"/>`)
      }
    }
    const tot = allRounds.length - 1
    const lbl = isWinner ? '🏆 Champion' : r === tot - 1 ? 'Final' : r === tot - 2 && tot >= 3 ? 'Semi' : `Round ${r + 1}`
    parts.push(`<text x="${(x + BOX_W/2).toFixed(1)}" y="${(TITLE_H + leafH + 16).toFixed(1)}" text-anchor="middle" font-size="8" fill="${isWinner ? theme.accent : theme.border + '88'}" font-family="system-ui,sans-serif">${lbl}</text>`)
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join('\n  ')}
</svg>`
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function renderEmpty(theme: MdArtTheme): string {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`
}
