import type { ArtifactType } from './api'

export type ArtifactDesktopViewMode = 'split' | 'source' | 'preview'

function opensPreviewFirst(type: ArtifactType): boolean {
  return type === 'report' || type === 'html'
}

/** Desktop layout when an artifact tab is activated (by type). */
export function defaultDesktopViewMode(type: ArtifactType): ArtifactDesktopViewMode {
  return opensPreviewFirst(type) ? 'preview' : 'split'
}

/** Mobile single-pane tab when an artifact tab is activated (by type). */
export function defaultMobileArtifactTab(type: ArtifactType): 'editor' | 'preview' {
  return opensPreviewFirst(type) ? 'preview' : 'editor'
}
