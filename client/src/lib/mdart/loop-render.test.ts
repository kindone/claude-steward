// @quality: correctness
// @type: example

import { describe, it, expect } from 'vitest'
import { renderMdArt } from './renderer'
import { getTheme } from './theme'

describe('loop layout render', () => {
  it('uses theme.text for node labels so overflow is readable on canvas', () => {
    const src = `type: loop
title: Feedback
- Build
- Measure
`
    const svg = renderMdArt(src)
    const theme = getTheme('loop')
    expect(svg).toContain(`fill="${theme.text}"`)
    expect(svg).toContain('paint-order="stroke fill"')
  })
})
