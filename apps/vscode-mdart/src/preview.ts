/**
 * vscode-mdart — preview webview script
 *
 * This file is injected into the VS Code Markdown Preview webview
 * (browser context) via `markdown.previewScripts` in package.json.
 *
 * Responsibility: wire tab-list interactivity on the rendered SVGs.
 * The SVG is static from the renderer; this script toggles tab
 * visibility and chrome when the user clicks a tab hit-area —
 * the same behaviour as the main steward client.
 *
 * esbuild bundles tabListInteract.ts into dist/preview.js (IIFE).
 * When `mdart` is published to npm the import below becomes:
 *
 *   import { tryActivateMdArtTabFromEventTarget } from 'mdart/preview'
 */

import { tryActivateMdArtTabFromEventTarget } from '../../../client/src/lib/mdart/tabListInteract.js'

// ── Wire tab-list roots ───────────────────────────────────────────────────────

/**
 * Find every unwired .mdart-tab-root and attach a delegated click handler.
 * Uses a data attribute to avoid double-wiring on re-renders.
 */
function wireTabRoots(scope: Document | Element = document): void {
  scope.querySelectorAll<Element>('.mdart-tab-root:not([data-mdart-wired])').forEach(root => {
    root.setAttribute('data-mdart-wired', '1')
    root.addEventListener('click', (e: Event) => {
      tryActivateMdArtTabFromEventTarget(e.target)
    })
  })
}

// ── Initial wire ──────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => wireTabRoots())
} else {
  wireTabRoots()
}

// ── Re-wire after VS Code re-renders the preview ──────────────────────────────
//
// VS Code posts a message to the webview whenever preview content is refreshed.
// We also use a MutationObserver as a belt-and-suspenders fallback, since the
// message protocol is an implementation detail that could change.

window.addEventListener('message', (event: MessageEvent) => {
  // VS Code sends { type: 'updateContent' } (and others) when re-rendering.
  if (event.data?.type === 'updateContent') {
    wireTabRoots()
  }
})

const observer = new MutationObserver(() => wireTabRoots())
observer.observe(document.body, { childList: true, subtree: true })
