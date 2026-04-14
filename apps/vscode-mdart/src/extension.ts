/**
 * vscode-mdart — extension entry point
 *
 * VS Code's markdown preview is powered by markdown-it. It exposes a single
 * hook: `extendMarkdownIt(md)`. We plug in `mdartPlugin` — the same adapter
 * used by `mdart-markdown-it` — which overrides the `fence` renderer rule to
 * intercept ```mdart blocks and replace them with inline SVG.
 *
 * The extension host runs in Node.js, so importing from the local mdart core
 * works at build time (esbuild bundles everything into dist/extension.js).
 * When `mdart-markdown-it` is published to npm the import below becomes:
 *
 *   import { mdartPlugin } from 'mdart-markdown-it'
 */

import type { ExtensionContext } from 'vscode'
import type MarkdownIt           from 'markdown-it'

// Until published: import from the local adapter in apps/mdart/
import { mdartPlugin } from '../../mdart/src/adapters/markdown-it-adapter.js'

export function activate(_ctx: ExtensionContext): void {
  // Nothing to initialise — the markdown preview hook is sufficient.
}

export function deactivate(): void {}

/**
 * VS Code calls this with its internal markdown-it instance.
 * We apply our plugin and return the mutated instance.
 */
export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
  md.use(mdartPlugin)
  return md
}
