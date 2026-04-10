import { parseSmartArt } from './parser'
import { getTheme } from './theme'
import type { SmartArtSpec } from './parser'
import type { SmartArtTheme } from './theme'
import { renderProcess } from './layouts/process'
import { renderList } from './layouts/list'
import { renderCycle } from './layouts/cycle'
import { renderMatrix } from './layouts/matrix'
import { renderHierarchy } from './layouts/hierarchy'
import { renderPyramid } from './layouts/pyramid'
import { renderRelationship } from './layouts/relationship'
import { renderStatistical } from './layouts/statistical'
import { renderPlanning } from './layouts/planning'
import { renderTechnical } from './layouts/technical'

type LayoutRenderer = (spec: SmartArtSpec, theme: SmartArtTheme) => string

const LAYOUT_RENDERERS: Record<string, LayoutRenderer> = {
  // process family
  process: renderProcess,
  'chevron-process': renderProcess,
  'arrow-process': renderProcess,
  'circular-process': renderProcess,
  funnel: renderProcess,
  roadmap: renderProcess,
  waterfall: renderProcess,
  'snake-process': renderProcess,
  'step-down': renderProcess,
  'step-up': renderProcess,
  'circle-process': renderProcess,
  equation: renderProcess,
  'bending-process': renderProcess,
  'segmented-bar': renderProcess,
  'phase-process': renderProcess,
  'timeline-h': renderProcess,
  'timeline-v': renderProcess,
  swimlane: renderProcess,

  // list family
  'bullet-list': renderList,
  'numbered-list': renderList,
  checklist: renderList,
  'two-column-list': renderList,
  'timeline-list': renderList,
  'block-list': renderList,
  'chevron-list': renderList,
  'card-list': renderList,
  'zigzag-list': renderList,
  'ribbon-list': renderList,
  'hexagon-list': renderList,
  'trapezoid-list': renderList,
  'tab-list': renderList,
  'circle-list': renderList,
  'icon-list': renderList,

  // cycle family
  cycle: renderCycle,
  'donut-cycle': renderCycle,
  'gear-cycle': renderCycle,
  spiral: renderCycle,
  'block-cycle': renderCycle,
  'segmented-cycle': renderCycle,
  'nondirectional-cycle': renderCycle,
  'multidirectional-cycle': renderCycle,
  loop: renderCycle,

  // matrix family
  swot: renderMatrix,
  'pros-cons': renderMatrix,
  comparison: renderMatrix,
  'matrix-2x2': renderMatrix,

  // hierarchy family
  'org-chart': renderHierarchy,
  tree: renderHierarchy,
  'h-org-chart': renderHierarchy,
  'hierarchy-list': renderHierarchy,
  'radial-tree': renderHierarchy,
  'decision-tree': renderHierarchy,
  sitemap: renderHierarchy,
  bracket: renderHierarchy,
  'bracket-tree': renderHierarchy,
  'mind-map': renderHierarchy,

  // pyramid family
  pyramid: renderPyramid,
  'inverted-pyramid': renderPyramid,
  'pyramid-list': renderPyramid,
  'segmented-pyramid': renderPyramid,
  'diamond-pyramid': renderPyramid,

  // relationship family
  venn: renderRelationship,
  'venn-3': renderRelationship,
  concentric: renderRelationship,
  balance: renderRelationship,
  'opposing-arrows': renderRelationship,
  web: renderRelationship,

  // statistical family
  'progress-list': renderStatistical,
  'bullet-chart': renderStatistical,
  scorecard: renderStatistical,
  treemap: renderStatistical,
  sankey: renderStatistical,

  // planning family
  kanban: renderPlanning,
  gantt: renderPlanning,
  'gantt-lite': renderPlanning,
  'sprint-board': renderPlanning,

  // technical family
  'layered-arch': renderTechnical,
  entity: renderTechnical,
  network: renderTechnical,
  pipeline: renderTechnical,
}

export function renderSmartArt(raw: string, hintType?: string): string {
  try {
    const spec = parseSmartArt(raw, hintType)
    const theme = getTheme(spec.type, spec.theme)
    const renderer = LAYOUT_RENDERERS[spec.type]
    if (!renderer) return renderFallback(spec, theme)
    return renderer(spec, theme)
  } catch (e) {
    return renderError(String(e))
  }
}

function renderFallback(spec: SmartArtSpec, theme: SmartArtTheme): string {
  const W = 360
  const H = 80
  const label = spec.type ? `${spec.type} (${spec.items.length} items)` : `SmartArt (${spec.items.length} items)`
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8" stroke="${theme.border}" stroke-width="1"/>
    <text x="${W / 2}" y="34" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${label}</text>
    <text x="${W / 2}" y="52" text-anchor="middle" font-size="10" fill="${theme.muted}" font-family="system-ui,sans-serif">layout not yet implemented</text>
  </svg>`
}

function renderError(msg: string): string {
  return `<svg viewBox="0 0 300 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="300" height="60" fill="#1a0a0a" rx="4"/>
    <text x="150" y="28" text-anchor="middle" font-size="11" fill="#f87171" font-family="system-ui,sans-serif">SmartArt error</text>
    <text x="150" y="44" text-anchor="middle" font-size="9" fill="#7f1d1d" font-family="system-ui,sans-serif">${msg.slice(0, 60).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>
  </svg>`
}
