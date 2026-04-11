export interface MdArtTheme {
  primary: string
  secondary: string
  accent: string
  muted: string
  bg: string
  surface: string
  border: string
  text: string
  textMuted: string
}

export const CATEGORY_THEMES: Record<string, MdArtTheme> = {
  list:         { primary:'#06b6d4', secondary:'#0891b2', accent:'#22d3ee', muted:'#164e63', bg:'#080f18', surface:'#0a1a20', border:'#0e3040', text:'#e2e8f0', textMuted:'#67e8f9' },
  process:      { primary:'#10b981', secondary:'#059669', accent:'#34d399', muted:'#064e3b', bg:'#080f10', surface:'#0a1a14', border:'#0e3020', text:'#e2e8f0', textMuted:'#6ee7b7' },
  cycle:        { primary:'#8b5cf6', secondary:'#7c3aed', accent:'#a78bfa', muted:'#4c1d95', bg:'#0e0a1a', surface:'#130f20', border:'#2d1f50', text:'#e2e8f0', textMuted:'#c4b5fd' },
  hierarchy:    { primary:'#f59e0b', secondary:'#d97706', accent:'#fbbf24', muted:'#78350f', bg:'#14100a', surface:'#1a1408', border:'#3a2800', text:'#e2e8f0', textMuted:'#fde68a' },
  relationship: { primary:'#f43f5e', secondary:'#e11d48', accent:'#fb7185', muted:'#9f1239', bg:'#180a0e', surface:'#1a0d12', border:'#3a1020', text:'#e2e8f0', textMuted:'#fda4af' },
  matrix:       { primary:'#3b82f6', secondary:'#2563eb', accent:'#60a5fa', muted:'#1e3a8a', bg:'#080f18', surface:'#0d1828', border:'#1e3050', text:'#e2e8f0', textMuted:'#93c5fd' },
  pyramid:      { primary:'#d97706', secondary:'#b45309', accent:'#fbbf24', muted:'#78350f', bg:'#100a04', surface:'#161008', border:'#3a2000', text:'#e2e8f0', textMuted:'#fcd34d' },
  statistical:  { primary:'#10b981', secondary:'#059669', accent:'#34d399', muted:'#064e3b', bg:'#080f10', surface:'#0a1a14', border:'#0e3020', text:'#e2e8f0', textMuted:'#6ee7b7' },
  planning:     { primary:'#a78bfa', secondary:'#8b5cf6', accent:'#c4b5fd', muted:'#4c1d95', bg:'#0e0a1a', surface:'#13101e', border:'#2d1f50', text:'#e2e8f0', textMuted:'#ddd6fe' },
  technical:    { primary:'#0ea5e9', secondary:'#0284c7', accent:'#38bdf8', muted:'#0c4a6e', bg:'#080f18', surface:'#091520', border:'#0e3050', text:'#e2e8f0', textMuted:'#7dd3fc' },
}

// Named overrides
export const NAMED_THEMES: Record<string, MdArtTheme> = {
  'mono-light': { primary:'#374151', secondary:'#1f2937', accent:'#6b7280', muted:'#d1d5db', bg:'#ffffff', surface:'#f9fafb', border:'#e5e7eb', text:'#111827', textMuted:'#6b7280' },
  'mono-dark':  { primary:'#9ca3af', secondary:'#6b7280', accent:'#d1d5db', muted:'#374151', bg:'#111827', surface:'#1f2937', border:'#374151', text:'#f9fafb', textMuted:'#9ca3af' },
}

// Which theme category each layout type belongs to
export const LAYOUT_CATEGORY: Record<string, string> = {
  // list
  'bullet-list':'list','numbered-list':'list','icon-list':'list','two-column-list':'list','checklist':'list','timeline-list':'list',
  // process
  'process':'process','chevron-process':'process','arrow-process':'process','circular-process':'process','funnel':'process','roadmap':'process','swimlane':'process','waterfall':'process','snake-process':'process',
  // cycle
  'cycle':'cycle','gear-cycle':'cycle','donut-cycle':'cycle','figure-eight':'cycle','spiral':'cycle',
  'block-cycle':'cycle','segmented-cycle':'cycle','nondirectional-cycle':'cycle','multidirectional-cycle':'cycle','loop':'cycle',
  // hierarchy
  'org-chart':'hierarchy','mind-map':'hierarchy','tree':'hierarchy','bracket':'hierarchy','decision-tree':'hierarchy',
  'h-org-chart':'hierarchy','hierarchy-list':'hierarchy','radial-tree':'hierarchy','sitemap':'hierarchy','bracket-tree':'hierarchy',
  // relationship
  'venn':'relationship','venn-3':'relationship','venn-4':'relationship','concentric':'relationship',
  'balance':'relationship','counterbalance':'relationship','opposing-arrows':'relationship','web':'relationship',
  'cluster':'relationship','target':'relationship','radial':'relationship','converging':'relationship','diverging':'relationship','plus':'relationship',
  // matrix
  'matrix-2x2':'matrix','matrix-nxm':'matrix','swot':'matrix','bcg':'matrix','ansoff':'matrix','comparison':'matrix','pros-cons':'matrix',
  // pyramid
  'pyramid':'pyramid','inverted-pyramid':'pyramid','pyramid-list':'pyramid','segmented-pyramid':'pyramid','diamond-pyramid':'pyramid',
  // statistical
  'treemap':'statistical','sankey':'statistical','bullet-chart':'statistical','progress-list':'statistical','scorecard':'statistical',
  'waffle':'statistical','gauge':'statistical','radar':'statistical','heatmap':'statistical',
  // planning
  'kanban':'planning','gantt':'planning','gantt-lite':'planning','sprint-board':'planning','timeline':'planning','milestone':'planning','wbs':'planning',
  // technical
  'network':'technical','layered-arch':'technical','pipeline':'technical','entity':'technical',
  'sequence':'technical','state-machine':'technical','class':'technical',
}

export function getTheme(type: string, override?: string): MdArtTheme {
  if (override && NAMED_THEMES[override]) return NAMED_THEMES[override]
  if (override && CATEGORY_THEMES[override]) return CATEGORY_THEMES[override]
  const category = LAYOUT_CATEGORY[type] ?? 'process'
  return CATEGORY_THEMES[category]
}
