/**
 * System prompt fragment that teaches Claude the MdArt fence syntax.
 * Injected into every session so Claude can author diagrams on request.
 */

export function buildMdArtFragment(): string {
  return `
---
You can create MdArt diagrams using \`\`\`mdart fences. These render as SVG diagrams in the chat and can be saved as artifacts.

## Syntax

Inline type (simplest):
\`\`\`mdart process
Discovery → Design → Build → Test → Deploy
\`\`\`

Block with front-matter:
\`\`\`mdart
type: swot
title: Product Launch

+ Strong brand recognition
+ Existing distribution
- High CAC
- No mobile app
? Asia-Pacific expansion
! New low-cost competitor
\`\`\`

## All layout types (10 families, 99 types)

**Process** — sequential steps, pipelines, flows
\`process\`, \`chevron-process\`, \`arrow-process\`, \`circular-process\`, \`funnel\`, \`roadmap\`, \`waterfall\`, \`snake-process\`, \`step-up\`, \`step-down\`, \`circle-process\`, \`equation\`, \`bending-process\`, \`segmented-bar\`, \`phase-process\`, \`timeline-h\`, \`timeline-v\`, \`swimlane\`
- Arrow chain: \`A → B → C\` or bullet list: \`- Step\`
- \`swimlane\`: top-level items = lanes; children = tasks in that lane

**List** — items with distinct visual treatments
\`bullet-list\`, \`numbered-list\`, \`checklist\`, \`two-column-list\`, \`timeline-list\`, \`block-list\`, \`chevron-list\`, \`card-list\`, \`zigzag-list\`, \`ribbon-list\`, \`hexagon-list\`, \`trapezoid-list\`, \`tab-list\`, \`circle-list\`, \`icon-list\`
- \`- Item [done]\` for checklist; \`- Label: value\` for key-value pairs

**Cycle** — circular / recurring flows
\`cycle\`, \`donut-cycle\`, \`gear-cycle\`, \`spiral\`, \`block-cycle\`, \`segmented-cycle\`, \`nondirectional-cycle\`, \`multidirectional-cycle\`, \`loop\`

**Matrix** — 2-axis comparisons and quadrant views
\`swot\`, \`pros-cons\`, \`comparison\`, \`matrix-2x2\`, \`bcg\`, \`ansoff\`, \`matrix-nxm\`
- SWOT prefix chars: \`+\` strength, \`-\` weakness, \`?\` opportunity, \`!\` threat
- \`comparison\`: top-level items are columns; children are \`key: value\` rows
- \`matrix-nxm\`: first item = header row, remaining = data rows (flat list)

**Hierarchy** — org charts, trees, mind maps
\`org-chart\`, \`tree\`, \`h-org-chart\`, \`hierarchy-list\`, \`radial-tree\`, \`decision-tree\`, \`sitemap\`, \`bracket\`, \`bracket-tree\`, \`mind-map\`
- Indented bullet lists define parent → child relationships

**Pyramid** — stacked/tiered shapes
\`pyramid\`, \`inverted-pyramid\`, \`pyramid-list\`, \`segmented-pyramid\`, \`diamond-pyramid\`
- List items from top to bottom; widest band is last for \`pyramid\`, first for \`inverted-pyramid\`

**Relationship** — connections, overlaps, and flows between sets
\`venn\`, \`venn-3\`, \`venn-4\`, \`concentric\`, \`balance\`, \`counterbalance\`, \`opposing-arrows\`, \`web\`, \`cluster\`, \`target\`, \`radial\`, \`converging\`, \`diverging\`, \`plus\`
- Venn: use \`- A ∩ B\` as an intersection peer item
- \`converging\`/\`diverging\`: top-level = central concept; items = inputs or outputs

**Statistical** — data visualization
\`progress-list\`, \`bullet-chart\`, \`scorecard\`, \`treemap\`, \`sankey\`, \`waffle\`, \`gauge\`, \`radar\`, \`heatmap\`
- Values via \`- Label: 75\` or \`key: value\` pairs
- \`sankey\`: use \`→ Target (value)\` flow children
- \`heatmap\`: top-level items = rows; children = cells with \`key: value\`

**Planning** — project timelines and task boards
\`kanban\`, \`gantt\`, \`gantt-lite\`, \`sprint-board\`, \`timeline\`, \`milestone\`, \`wbs\`
- \`kanban\`/\`sprint-board\`: top-level items = columns; children = cards
- \`gantt-lite\`: \`- Task [wk1–wk3]\`, use \`* Milestone [wk6]\` for milestones
- \`wbs\`: work breakdown structure — deeply indented hierarchy

**Technical** — architecture and system diagrams
\`layered-arch\`, \`entity\`, \`network\`, \`pipeline\`, \`sequence\`, \`state-machine\`, \`class\`
- \`entity\`: items = tables; children = \`name: type [PK]\` / \`[FK→table]\` fields
- \`network\`: \`→ Child\` for tree topology, or \`nodes:\`/\`edges:\` sections for mesh
- \`sequence\`: top-level items = actors; children = \`→ Target: message\`
- \`state-machine\`: items = states; children = \`→ NextState: event\`
- \`class\`: items = classes; children = members with \`[+]\` public / \`[-]\` private / \`[#]\` protected

## Semantic conventions

- \`- Child\` under \`- Parent\` → containment (child belongs to parent)
- \`→ Target\` under \`- Source\` → directed edge / flow
- \`- A ∩ B\` → intersection peer (venn diagrams)
- \`key: value\` → typed field
- \`[attr]\` inline → tag or modifier (e.g. \`[done]\`, \`[PK]\`, \`[wk1–wk3]\`)

## Global options (front-matter)

| Key | Example |
|---|---|
| \`type\` | \`type: kanban\` |
| \`theme\` | \`theme: mono-light\` |
| \`title\` | \`title: Q3 Roadmap\` |
| \`direction\` | \`direction: LR\` |

Use MdArt for structured concepts (processes, lists, comparisons, cycles, architecture diagrams). Prefer mermaid for flow charts with complex conditional branching logic.
---`
}
