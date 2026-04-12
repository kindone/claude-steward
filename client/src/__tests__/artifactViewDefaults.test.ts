// @quality: correctness
// @type: example

import { describe, it, expect } from 'vitest'
import { defaultDesktopViewMode, defaultMobileArtifactTab } from '../lib/artifactViewDefaults'

describe('artifactViewDefaults', () => {
  it('defaults report and html to preview on desktop and mobile', () => {
    expect(defaultDesktopViewMode('report')).toBe('preview')
    expect(defaultMobileArtifactTab('report')).toBe('preview')
    expect(defaultDesktopViewMode('html')).toBe('preview')
    expect(defaultMobileArtifactTab('html')).toBe('preview')
  })

  it('defaults other preview-capable types to split / editor', () => {
    expect(defaultDesktopViewMode('chart')).toBe('split')
    expect(defaultMobileArtifactTab('chart')).toBe('editor')
  })
})
