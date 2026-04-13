// @quality: correctness
// @type: example

import { describe, it, expect } from 'vitest'
import { renderMdArt } from './renderer'

describe('checklist render', () => {
  it('done items stay readable: no strikethrough, italic + fill-opacity', () => {
    const src = `type: checklist
- Finished [done]
- Still open
`
    const svg = renderMdArt(src)
    expect(svg).not.toContain('line-through')
    expect(svg).toContain('fill-opacity="0.62"')
    expect(svg).toContain('font-style="italic"')
  })
})
