// @quality: correctness
// @type: example

import { describe, it, expect } from 'vitest'
import { activateMdArtTab, tryActivateMdArtTabFromEventTarget } from './tabListInteract'

const miniSvg = `
<svg xmlns="http://www.w3.org/2000/svg">
  <g class="mdart-tab-root" data-text-muted="#999999">
    <g class="mdart-tab-hit" data-tab="0" data-color="#ff0000" style="cursor:pointer">
      <rect class="mdart-tab-rect" width="40" height="20" fill="#ff0000"/>
      <text class="mdart-tab-label" fill="#ffffff" font-weight="700">A</text>
    </g>
    <g class="mdart-tab-hit" data-tab="1" data-color="#00aa00" style="cursor:pointer">
      <rect class="mdart-tab-rect" width="40" height="20" fill="#00aa0022" stroke="#00aa0055" stroke-width="1"/>
      <text class="mdart-tab-label" fill="#999999" font-weight="400">B</text>
    </g>
    <rect class="mdart-tab-content-bg" fill="#ff000011" stroke="#ff000044" stroke-width="1.2"/>
    <g class="mdart-tab-panel" data-tab="0" visibility="visible"><text>P0</text></g>
    <g class="mdart-tab-panel" data-tab="1" visibility="hidden"><text>P1</text></g>
  </g>
</svg>`

describe('tabListInteract', () => {
  it('activateMdArtTab switches panel visibility and content border', () => {
    const doc = new DOMParser().parseFromString(miniSvg, 'image/svg+xml')
    const root = doc.querySelector('.mdart-tab-root')!
    activateMdArtTab(root, 1)

    expect(doc.querySelector('.mdart-tab-panel[data-tab="0"]')?.getAttribute('visibility')).toBe('hidden')
    expect(doc.querySelector('.mdart-tab-panel[data-tab="1"]')?.getAttribute('visibility')).toBe('visible')

    const bg = doc.querySelector('.mdart-tab-content-bg')!
    expect(bg.getAttribute('fill')).toBe('#00aa0011')
    expect(bg.getAttribute('stroke')).toBe('#00aa0044')
  })

  it('tryActivateMdArtTabFromEventTarget finds tab from nested target', () => {
    const doc = new DOMParser().parseFromString(miniSvg, 'image/svg+xml')
    const secondLabel = doc.querySelector('.mdart-tab-hit[data-tab="1"] .mdart-tab-label')!
    expect(tryActivateMdArtTabFromEventTarget(secondLabel)).toBe(true)
    expect(doc.querySelector('.mdart-tab-panel[data-tab="1"]')?.getAttribute('visibility')).toBe('visible')
  })

  it('returns false when target is outside tab UI', () => {
    const doc = new DOMParser().parseFromString('<div><span>x</span></div>', 'text/html')
    const span = doc.querySelector('span')!
    expect(tryActivateMdArtTabFromEventTarget(span)).toBe(false)
  })
})
