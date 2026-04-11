# MdArt — Implementation Plan

Markdown code-fence syntax that renders structured text into SVG diagrams, similar to PowerPoint MdArt. Triggered by ` ```mdart ` fences in chat and supported as a dedicated artifact type.

---

## Visual Reference

10-category SVG reference catalog has been built as HTML artifacts in the Art panel:

| Artifact | Category | Layouts |
|---|---|---|
| MdArt · LIST Layouts | LIST | 12 |
| MdArt · PROCESS Layouts | PROCESS | 15 |
| MdArt · CYCLE Layouts | CYCLE | 8 |
| MdArt · HIERARCHY Layouts | HIERARCHY | 8 |
| MdArt · RELATIONSHIP Layouts | RELATIONSHIP | 12 |
| MdArt · MATRIX Layouts | MATRIX | 7 |
| MdArt · PYRAMID Layouts | PYRAMID | 5 |
| MdArt · STATISTICAL Layouts | STATISTICAL | 5 |
| MdArt · PLANNING Layouts | PLANNING | 3 |
| MdArt · TECHNICAL Layouts | TECHNICAL | 4 |

**~79 distinct layout types** across all 10 categories.

---

## Syntax Design

### Simple (inline)

```
```mdart process
Discovery → Design → Build → Test → Deploy
```
```

### Rich (block with YAML front-matter)

```
```mdart
type: swot
title: Product Launch

+ Strong brand recognition
+ Existing distribution network
- High customer acquisition cost
- No mobile app yet
? Asia-Pacific expansion
? API partner ecosystem
! New low-cost competitor
! Regulatory changes in EU
```
```

### Syntax decision: universal hierarchical list

The core insight: **a hierarchical markdown list is the structural primitive for almost every layout type.** The `type` in the fence header is the "rendering intent"; the list is the "data". Same source, different renders.

Five syntax tiers, ordered by how much structure they add beyond plain lists:

| Tier | Types | Syntax | Extra beyond plain list |
|---|---|---|---|
| **1 — Pure list** | `list`, `process`, `cycle`, `pyramid`, `layered-arch` | `- Item` flat or indented | none |
| **2 — Inline annotations** | `swot`, `comparison`, `kanban`, `entity`, `treemap`, `gantt` | `- Task [wk1–wk3]`, `- id: uuid [PK]` | `key: value` · `[attr]` |
| **3 — Prefixed bullets** | `swot` shorthand | `+ strength`, `- weakness`, `? opportunity`, `! threat` | prefix char encodes quadrant |
| **4 — Flow children** | `sankey`, `pipeline`, `network` (tree-shaped) | `→ Destination (value)` as child | `→` prefix = "flows to / connects to" (not "contained in") |
| **5 — Intersection peers** | `venn`, `relationship` | `- A ∩ B` as top-level item | `∩` in item name → renderer places children in overlap zone |

One additional form for **true graphs** (multiple parents, mesh topology) that can't be folded into a single-root tree:

```
```mdart network
nodes:
  - App Server 1
  - App Server 2
  - Database      # two inbound edges — impossible as tree
  - Cache         # two inbound edges
edges:
  - App Server 1 → Database
  - App Server 2 → Database
  - App Server 1 → Cache
  - App Server 2 → Cache
```
```

Still all list syntax — just two named sections. Used only when the graph truly can't be expressed as a hierarchy.

### Semantic rules (parser contract)

- `- Child` under a `- Parent` → **containment** (child belongs to parent)
- `→ Target` under a `- Source` → **directed edge** (source flows to / connects to target)
- `- A ∩ B` as top-level peer → **intersection** (renderer matches `A` and `B` against other top-level names)
- `key: value` on an item → **typed field** (ER fields, gantt dates, numeric values)
- `[attr]` inline → **tag/modifier** (PK, FK, done, wk1–wk3)
- Prefix chars (`+`, `-`, `?`, `!`) on SWOT items → **quadrant assignment**

### Per-type syntax reference

| Type(s) | Syntax form | Example |
|---|---|---|
| `list`, `process`, `cycle` | Flat or arrow-chain | `- Step 1` or `A → B → C` |
| `pyramid`, `layered-arch` | Indented levels | `- Top` / `  - Sub` |
| `org-chart`, `mind-map`, `hierarchy` | Deep indented tree | Recursive `- / - ` |
| `swot` | Prefix chars or 4-group headings | `+ Strong brand` / `- High costs` |
| `pros-cons` | Two-group headings | `- Pros` / `  - item`, `- Cons` / `  - item` |
| `comparison` | Two+ groups, `key: val` children | `- Plan A` / `  - Storage: 100 GB` |
| `kanban`, `sprint-board` | Column headings + card items | `- To Do` / `  - Task [5 pts]` |
| `gantt-lite` | Items with range annotation | `- Design [wk1–wk3]`, `* Launch [wk6]` for milestone |
| `entity` | Items with typed fields | `- users` / `  - id: uuid [PK]` / `  - user_id: uuid [FK→orders]` |
| `sankey` | Items with `→` flow children | `- Product A (40%)` / `  → N. America (25%)` |
| `pipeline` | Items with `→` children | `- Source` / `  → Transform` / `    → Load` |
| `network` (tree) | Indented `→` children | `- Internet` / `  → Firewall` / `    → LB` |
| `network` (graph) | `nodes:` / `edges:` sections | (see above) |
| `venn` | Groups + `∩` intersection peer | `- Engineering` / `- Product` / `- Engineering ∩ Product` |
| `matrix-2x2`, `bcg`, `ansoff` | 4-group headings (fixed semantics per named type) | `- Stars` / `  - Product A (large)` |
| `treemap` | Flat items with values | `- Revenue: $4.2M` |

### Global options (YAML front-matter)

| Key | Values | Default |
|---|---|---|
| `type` | any layout name (required if not inline) | — |
| `theme` | category default, or named override (`amber`, `rose`, `mono-light`) | category default |
| `title` | string | none |
| `width` | px or `auto` | fills container |
| `direction` | `LR` \| `TB` | layout-dependent |

---

## Architecture

### File layout

```
client/src/lib/mdart/
  parser.ts              ← raw fence text → MdArtSpec
  renderer.ts            ← MdArtSpec → SVG string (orchestrator)
  theme.ts               ← color palettes keyed by layout type
  layouts/
    list.ts              → 12 types
    process.ts           → 15 types
    cycle.ts             → 8 types
    hierarchy.ts         → 8 types
    relationship.ts      → 12 types
    matrix.ts            → 7 types
    pyramid.ts           → 5 types
    statistical.ts       → 5 types
    planning.ts          → 3 types
    technical.ts         → 4 types

client/src/components/
  MdArtView.tsx       ← artifact viewer component (edit + live re-render)
```

### Data flow

```
raw fence text
      ↓
  parseFrontMatter()     → { type, theme, title, options }
      ↓
  parseBody(type, text)  → MdArtData  (typed union per layout family)
      ↓
  MdArtSpec = { layout, data, options }
      ↓
  layouts/<family>.ts    → SVGSpec  (plain JS object: elements + attrs)
      ↓
  renderer.ts            → SVG string
```

**Key separation:** geometry (node positions, arc paths, sizes) is computed in layout engines and returned as a plain `SVGSpec` object. `renderer.ts` serializes it. This lets us swap to canvas or React SVG later without touching layout logic.

### Theme system

Each category has a default palette matching the reference artifacts:

```ts
const themes = {
  list:         { primary: '#06b6d4', accent: '#22d3ee', bg: '#0a1a20', ... },
  process:      { primary: '#10b981', ... },
  cycle:        { primary: '#8b5cf6', ... },
  hierarchy:    { primary: '#f59e0b', ... },
  relationship: { primary: '#f43f5e', ... },
  matrix:       { primary: '#3b82f6', ... },
  pyramid:      { primary: '#d97706', ... },
  statistical:  { primary: '#34d399', ... },
  planning:     { primary: '#a78bfa', ... },
  technical:    { primary: '#0ea5e9', ... },
}
```

Named overrides: `theme: amber`, `theme: rose`, `theme: mono-light` (print-friendly).

### Responsive sizing

- Default `viewBox` auto-sized to content (not fixed — reference tiles used 260×130 for compactness only)
- `width` option clamps; default fills container width
- Long labels: auto line-wrap with configurable max chars; ellipsis + tooltip fallback
- `direction: LR | TB` for process, hierarchy, pipeline, layered-arch

---

## Integration Points

### Chat messages (like pikchr)

1. `markdownRenderer.ts` — detect ` ```mdart ` fences, emit:
   ```html
   <div class="mdart-placeholder" data-src="<base64-encoded source>" data-type="process">
   ```
2. `MessageBubble.tsx` hydration effect — call `renderMdArt(src)` → inject SVG into placeholder
3. Overlay 📎 button on hover → "Save as Artifact" (saves source text as `mdart` artifact)

### Artifact type `mdart`

- **Server:** add `'mdart'` to `validTypes` in `routes/artifacts.ts` and `db/index.ts`; `artifactExtension()` returns `.mdart`
- **`ArtifactViewer.tsx`:** add `MdArtView` component — split layout (editor left, live SVG right), re-renders on every keystroke, no server round-trip
- **`ArtifactPanel.tsx`:** teal badge for mdart type
- **`api.ts`:** add `'mdart'` to `ArtifactType` union

### MCP tool (works automatically)

```
artifact_create(type: "mdart", content: "type: process\n...")
```

No extra work needed — falls through to the existing artifact pipeline.

### System prompt addition

`server/src/lib/mdartPrompt.ts` — injected into every session, describes the fence syntax so Claude can author MdArt diagrams on request.

---

## Files to create / modify

### New files

| File | Purpose |
|---|---|
| `client/src/lib/mdart/parser.ts` | Front-matter + body parser |
| `client/src/lib/mdart/renderer.ts` | SVGSpec → SVG string orchestrator |
| `client/src/lib/mdart/theme.ts` | Color palette definitions |
| `client/src/lib/mdart/layouts/list.ts` | 12 list layout engines |
| `client/src/lib/mdart/layouts/process.ts` | 15 process layout engines |
| `client/src/lib/mdart/layouts/cycle.ts` | 8 cycle layout engines |
| `client/src/lib/mdart/layouts/hierarchy.ts` | 8 hierarchy layout engines |
| `client/src/lib/mdart/layouts/relationship.ts` | 12 relationship layout engines |
| `client/src/lib/mdart/layouts/matrix.ts` | 7 matrix layout engines |
| `client/src/lib/mdart/layouts/pyramid.ts` | 5 pyramid layout engines |
| `client/src/lib/mdart/layouts/statistical.ts` | 5 statistical layout engines |
| `client/src/lib/mdart/layouts/planning.ts` | 3 planning layout engines |
| `client/src/lib/mdart/layouts/technical.ts` | 4 technical layout engines |
| `client/src/components/MdArtView.tsx` | Artifact viewer: editor + live render |
| `server/src/lib/mdartPrompt.ts` | System prompt instructions |

### Modified files

| File | Change |
|---|---|
| `client/src/lib/markdownRenderer.ts` | Detect fence, emit placeholder div |
| `client/src/components/MessageBubble.tsx` | Hydrate placeholders, add 📎 save button |
| `client/src/components/ArtifactViewer.tsx` | Dispatch to `MdArtView` |
| `client/src/components/ArtifactPanel.tsx` | Teal badge for mdart type |
| `client/src/lib/api.ts` | Add `'mdart'` to `ArtifactType` union |
| `server/src/routes/artifacts.ts` | Add `'mdart'` to `validTypes` |
| `server/src/db/index.ts` | Add `'mdart'` to `ArtifactType` |
| `server/src/routes/chat.ts` | Import and inject `mdartPrompt` |

---

## Rollout Order

Ordered by value × implementation complexity:

| Priority | Types | Rationale |
|---|---|---|
| **1** | `process`, `list`, `cycle` | Most commonly requested; simple linear / circular layouts |
| **2** | `swot`, `pros-cons`, `comparison` | High business value; fixed 2×2 or 2-column geometry |
| **3** | `pyramid`, `matrix-2x2` | Simple geometry already prototyped in reference SVGs |
| **4** | `hierarchy`, `org-chart`, `mind-map` | Need tree-layout algorithm (Reingold-Tilford or similar) |
| **5** | `kanban`, `gantt-lite`, `sprint-board` | Planning types; card layout is straightforward |
| **6** | `entity`, `layered-arch`, `pipeline` | Technical types; more complex node/edge parsing |
| **7** | `treemap`, `sankey`, `bcg` | Data types require numeric inputs and value-proportional geometry |

---

## Testing Plan

- **Parser:** property-based tests (jsproptest) — generate random valid inputs, assert round-trip stability and no panics on malformed input
- **Layout engines:** snapshot tests per layout type using known fixture inputs
- **Renderer:** assert valid SVG (no unclosed tags, valid viewBox, required attributes)
- **Integration:** Playwright smoke test — type a fence in chat, assert SVG appears in DOM

---

## Open Questions

1. **Inline vs block editor for MdArtView:** full CodeMirror (like ArtifactEditor) or plain `<textarea>` for phase 1?
2. **Export:** "Download as SVG" / "Download as PNG" button on the artifact viewer?
3. **Animation:** optional CSS transitions on process arrows, cycle rotation? Probably post-MVP.
4. **i18n labels:** named matrix types (BCG, Ansoff, SWOT) have fixed English quadrant labels — parameterize or hardcode for now?
