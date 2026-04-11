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

## Layout types

**Process** (\`process\`, \`funnel\`, \`roadmap\`): sequential steps
- Arrow chain: \`A → B → C\`
- Or bullet list: \`- Step 1\` / \`- Step 2\`

**List** (\`bullet-list\`, \`numbered-list\`, \`checklist\`, \`two-column-list\`, \`timeline-list\`):
- \`- Item [done]\` — checklist with done attr
- \`- Item: value\` — label with value

**Cycle** (\`cycle\`, \`donut-cycle\`): circular / recurring flows

**Matrix** (\`swot\`, \`pros-cons\`, \`comparison\`):
- SWOT: prefix chars +/-/?/! for S/W/O/T quadrants
- pros-cons: \`- Pros\` / \`  - item\`, \`- Cons\` / \`  - item\`
- comparison: top-level items are columns; children are rows with key: value

**Hierarchy** (\`org-chart\`, \`tree\`, \`mind-map\`): indented lists

## Semantic conventions

- \`- Child\` under \`- Parent\` → containment (child belongs to parent)
- \`→ Target\` under \`- Source\` → directed edge / flow child
- \`- A ∩ B\` → intersection peer (for venn diagrams)
- \`key: value\` → typed field
- \`[attr]\` inline → tag or modifier (e.g. \`[done]\`, \`[PK]\`, \`[wk1–wk3]\`)

## Global options (front-matter)

| Key | Example |
|---|---|
| \`type\` | \`type: cycle\` |
| \`theme\` | \`theme: mono-light\` |
| \`title\` | \`title: Q3 Roadmap\` |
| \`direction\` | \`direction: LR\` |

Use MdArt for structured concepts (processes, lists, comparisons, cycles). Prefer mermaid for flow charts with complex conditional logic.
---`
}
