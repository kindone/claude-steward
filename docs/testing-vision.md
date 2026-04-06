# Testing Vision — Long-Term Discussion

*Started: 2026-04-06. Revisit when bandwidth allows.*

---

## Current State (as of Apr 2026)

176 tests, all passing (~51s). Two tiers:

| Tier | What | Cost | Speed |
|------|------|------|-------|
| 1 | Unit + property (Vitest/jsproptest) | ~$0 | ~51s |
| 2 | E2E worker (real Claude CLI, no browser) | ~$0.05/run | ~90s |

5 property-based tests (jsproptest): nextFireAt, pagination, session lifecycle (stateful), tool-detail labels, path containment security.

---

## The Ambition

### Tier 3 — Playwright + Vision
- Drive the browser via Playwright, capture screenshots at key moments
- Use a cheap Claude call (Haiku) for visual assertions: *"does this screenshot show a tool call badge labeled 'git'?"*
- Replaces fragile DOM selector assertions with semantic vision checks
- High value for: image gallery, error console, compact divider, session rename menu — things hard to unit-test meaningfully
- Cost: ~$0.001–0.003 per screenshot assertion (Haiku)

### Tier 4 — Subagent Doc/Skill Verification
- Spawn a fresh `claude` session with a specific doc or skill
- Give it a concrete task, assert the MCP tool was called correctly / output matches expected
- Covers: CLAUDE.md conventions staying accurate, skill correctness, docs synced with code
- Cost: ~$0.05–0.20 per test (Sonnet/Haiku depending on task)
- **This is the expensive one** — needs caching (hash doc + relevant source files, skip if unchanged)

### Command structure (proposed)
```bash
npm test           # Tier 1+2: fast, free, always runs (pre-deploy gate)
npm run test:e2e   # Tier 2: worker real-Claude
npm run test:ui    # Tier 3: Playwright + vision (new)
npm run test:docs  # Tier 4: subagent doc/skill (new)
npm run test:all   # Everything
```

---

## Open Questions

- Tier 3: Claude vision for *every* assertion, or only layout/visual things while keeping DOM queries for data correctness?
- Tier 4: subagent via `claude --print` (one-shot) or via the Worker? One-shot simpler for doc testing.
- Budget cap: should tier 4 tests enforce a per-run token budget at the harness level?
- Caching strategy: git-tracked input hashing (doc + source) to skip unchanged subagent tests?

---

## Interim Workarounds (until tiers 3/4 exist)

1. **`/smoke` skill** — fast sanity ritual: build succeeds, `npm test` passes, hit key API endpoints, optionally screenshot the app. Agent invokes before handing back.
2. **Hooks** — PostToolUse on Edit/Write of `docs/`: prompt agent to check that described code still matches. PostToolUse on test file write: run it before continuing.
3. **CLAUDE.md "verify before handoff" block** — encode the discipline as text, zero infrastructure.
4. **`/writing_test` as a thinking prompt** — before declaring done, have I identified the invariant this should satisfy?

None of these are implemented yet. They're the bridge before formal tiers 3/4.

---

## Highest-Value First Targets (when ready to build)

**Tier 3 first** — highest value-to-cost ratio. Visual coverage gap is real:
- Compact divider (expand/collapse)
- Image gallery (lightbox, keyboard nav)
- Error console (badge count, drawer, dismiss)
- Session rename (portal menu, context)

**Tier 4 second** — start with highest-risk docs/skills:
- `/deploy` skill (broke once already)
- `docs/scheduler-usage.md` (complex enough to get wrong)
- `CLAUDE.md` scheduling convention
