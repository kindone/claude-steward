import { describe, it, expect } from 'vitest'
import { parseSmartArt } from './parser'

describe('parseSmartArt', () => {
  // ── Arrow chain ──────────────────────────────────────────────────────────

  it('parses flat arrow chain into flat items', () => {
    const spec = parseSmartArt('A → B → C')
    expect(spec.items).toHaveLength(3)
    expect(spec.items[0].label).toBe('A')
    expect(spec.items[1].label).toBe('B')
    expect(spec.items[2].label).toBe('C')
    expect(spec.items[0].children).toHaveLength(0)
  })

  it('uses hintType from fence header', () => {
    const spec = parseSmartArt('A → B → C', 'process')
    expect(spec.type).toBe('process')
  })

  it('parses arrow chain with value annotations', () => {
    const spec = parseSmartArt('Alpha: First → Beta: Second → Gamma: Third')
    expect(spec.items).toHaveLength(3)
    expect(spec.items[0].label).toBe('Alpha')
    expect(spec.items[0].value).toBe('First')
  })

  // ── Front-matter ─────────────────────────────────────────────────────────

  it('extracts type from front-matter', () => {
    const src = 'type: cycle\ntitle: My Cycle\n\n- Step 1\n- Step 2'
    const spec = parseSmartArt(src)
    expect(spec.type).toBe('cycle')
    expect(spec.title).toBe('My Cycle')
    expect(spec.items).toHaveLength(2)
  })

  it('extracts theme and direction from front-matter', () => {
    const src = 'type: process\ntheme: mono-light\ndirection: TB\n\n- A\n- B'
    const spec = parseSmartArt(src)
    expect(spec.theme).toBe('mono-light')
    expect(spec.direction).toBe('TB')
  })

  it('front-matter stops at first list item', () => {
    const src = 'type: swot\n- First item'
    const spec = parseSmartArt(src)
    expect(spec.type).toBe('swot')
    expect(spec.items).toHaveLength(1)
    expect(spec.items[0].label).toBe('First item')
  })

  it('handles missing type in front-matter with hintType fallback', () => {
    const src = 'title: My Chart\n\n- A\n- B'
    const spec = parseSmartArt(src, 'bullet-list')
    expect(spec.type).toBe('bullet-list')
    expect(spec.title).toBe('My Chart')
  })

  // ── Prefix chars ─────────────────────────────────────────────────────────

  it('parses + prefix as S quadrant', () => {
    const spec = parseSmartArt('+ Strong brand\n+ Good team')
    expect(spec.items).toHaveLength(2)
    expect(spec.items[0].prefix).toBe('+')
    expect(spec.items[0].label).toBe('Strong brand')
  })

  it('parses - prefix as W quadrant in swot context', () => {
    const spec = parseSmartArt('type: swot\n\n- High cost\n- Low margin')
    expect(spec.items[0].prefix).toBe('-')
  })

  it('parses ? prefix as O quadrant', () => {
    const spec = parseSmartArt('? New markets')
    expect(spec.items[0].prefix).toBe('?')
  })

  it('parses ! prefix as T quadrant', () => {
    const spec = parseSmartArt('! Competitor threat')
    expect(spec.items[0].prefix).toBe('!')
  })

  it('parses mixed prefix swot block', () => {
    const src = 'type: swot\n\n+ Strength\n- Weakness\n? Opportunity\n! Threat'
    const spec = parseSmartArt(src)
    expect(spec.items).toHaveLength(4)
    expect(spec.items.map(i => i.prefix)).toEqual(['+', '-', '?', '!'])
  })

  // ── Nested indentation → children ────────────────────────────────────────

  it('parses indented children', () => {
    const src = '- Parent\n  - Child 1\n  - Child 2'
    const spec = parseSmartArt(src)
    expect(spec.items).toHaveLength(1)
    expect(spec.items[0].label).toBe('Parent')
    expect(spec.items[0].children).toHaveLength(2)
    expect(spec.items[0].children[0].label).toBe('Child 1')
  })

  it('parses deeply nested children', () => {
    const src = '- A\n  - B\n    - C'
    const spec = parseSmartArt(src)
    expect(spec.items[0].children[0].children[0].label).toBe('C')
  })

  it('multiple top-level items with children', () => {
    const src = '- Group 1\n  - Item A\n- Group 2\n  - Item B'
    const spec = parseSmartArt(src)
    expect(spec.items).toHaveLength(2)
    expect(spec.items[0].children).toHaveLength(1)
    expect(spec.items[1].children).toHaveLength(1)
  })

  // ── [attr] extraction ─────────────────────────────────────────────────────

  it('extracts single attr', () => {
    const spec = parseSmartArt('- My Task [done]')
    expect(spec.items[0].attrs).toEqual(['done'])
    expect(spec.items[0].label).toBe('My Task')
  })

  it('extracts multiple attrs', () => {
    const spec = parseSmartArt('- id: uuid [PK, NOT NULL]')
    expect(spec.items[0].attrs).toEqual(['PK', 'NOT NULL'])
    expect(spec.items[0].label).toBe('id')
    expect(spec.items[0].value).toBe('uuid')
  })

  it('handles items without attrs', () => {
    const spec = parseSmartArt('- Plain item')
    expect(spec.items[0].attrs).toEqual([])
  })

  // ── ∩ intersection detection ──────────────────────────────────────────────

  it('detects ∩ in label → isIntersection true', () => {
    const spec = parseSmartArt('- Engineering ∩ Product')
    expect(spec.items[0].isIntersection).toBe(true)
    expect(spec.items[0].label).toBe('Engineering ∩ Product')
  })

  it('non-intersection labels have isIntersection falsy', () => {
    const spec = parseSmartArt('- Plain Item')
    expect(spec.items[0].isIntersection).toBeFalsy()
  })

  // ── Flow children ──────────────────────────────────────────────────────────

  it('parses → flow children', () => {
    const src = '- Source\n  → Target A\n  → Target B'
    const spec = parseSmartArt(src)
    expect(spec.items[0].flowChildren).toHaveLength(2)
    expect(spec.items[0].flowChildren[0].label).toBe('Target A')
  })

  // ── Milestone ──────────────────────────────────────────────────────────────

  it('parses * milestone items', () => {
    const src = '- Regular\n* Milestone item'
    const spec = parseSmartArt(src)
    const milestone = spec.items.find(i => i.isMilestone)
    expect(milestone).toBeDefined()
    expect(milestone?.label).toBe('Milestone item')
  })

  // ── Nodes/edges sections ──────────────────────────────────────────────────

  it('parses nodes: and edges: sections', () => {
    const src = 'type: network\n\nnodes:\n  - A\n  - B\nedges:\n  - A → B'
    const spec = parseSmartArt(src)
    expect(spec.nodes).toEqual(['A', 'B'])
    expect(spec.edges).toEqual([{ from: 'A', to: 'B' }])
  })

  // ── Robustness ────────────────────────────────────────────────────────────

  it('does not throw on empty input', () => {
    expect(() => parseSmartArt('')).not.toThrow()
    const spec = parseSmartArt('')
    expect(spec.items).toEqual([])
  })

  it('does not throw on malformed input with no colon in front-matter', () => {
    expect(() => parseSmartArt('this is not yaml\n\n- item')).not.toThrow()
  })

  it('does not throw on deeply nested items beyond expected depth', () => {
    const src = '- A\n  - B\n    - C\n      - D\n        - E'
    expect(() => parseSmartArt(src)).not.toThrow()
  })

  it('does not throw on unicode-heavy input', () => {
    const src = '- 日本語テスト ∩ 中文 → العربية'
    expect(() => parseSmartArt(src)).not.toThrow()
  })

  it('returns fallback spec on completely invalid input that throws', () => {
    // Even with weird input, should return a valid SmartArtSpec
    const spec = parseSmartArt(null as unknown as string, 'process')
    expect(spec).toHaveProperty('items')
    expect(spec.type).toBe('process')
  })

  // ── Key: value parsing ────────────────────────────────────────────────────

  it('splits label: value correctly', () => {
    const spec = parseSmartArt('- Storage: 100 GB')
    expect(spec.items[0].label).toBe('Storage')
    expect(spec.items[0].value).toBe('100 GB')
  })

  it('does not split URLs on colon', () => {
    const spec = parseSmartArt('- Link: https://example.com')
    expect(spec.items[0].label).toBe('Link')
    // value should be the URL
    expect(spec.items[0].value).toBe('https://example.com')
  })

  it('handles plain items without colon', () => {
    const spec = parseSmartArt('- Simple Label')
    expect(spec.items[0].label).toBe('Simple Label')
    expect(spec.items[0].value).toBeUndefined()
  })
})
