/**
 * marked-mdart adapter
 *
 * A real `marked` extension that intercepts ```mdart fences and renders them
 * to inline SVG. This is the exact shape a published `marked-mdart` package
 * would export — only the import path would change from a local relative path
 * to `@mdart/core`.
 *
 * Usage (app code):
 *   import { Marked } from 'marked'
 *   import { mdartExtension } from 'marked-mdart'
 *   const marked = new Marked({ extensions: [mdartExtension()] })
 *   const html = await marked.parse(markdown)
 */

import { Marked, type TokenizerExtension, type RendererExtension, type Tokens } from 'marked'

// In a published package this would be:  import { renderMdArt } from '@mdart/core'
import { renderMdArt } from '../../../../client/src/lib/mdart/renderer.js'

// ── Token type ────────────────────────────────────────────────────────────────

interface MdartToken extends Tokens.Generic {
  type:     'mdart'
  raw:      string
  source:   string
  hintType: string | undefined
}

// ── Extension ─────────────────────────────────────────────────────────────────

export function mdartExtension(): TokenizerExtension & RendererExtension {
  return {
    name:  'mdart',
    level: 'block',

    start(src: string): number | undefined {
      const idx = src.indexOf('\n```mdart')
      return idx >= 0 ? idx : undefined
    },

    tokenizer(src: string): MdartToken | undefined {
      // Matches ```mdart or ```mdart <hintType>
      const match = /^```mdart(?:\s+(\S+))?\n([\s\S]*?)```[ \t]*(?:\n|$)/.exec(src)
      if (!match) return undefined
      return {
        type:     'mdart',
        raw:      match[0],
        source:   match[2],
        hintType: match[1],
      }
    },

    renderer(token: Tokens.Generic): string {
      const t = token as MdartToken
      try {
        return renderMdArt(t.source, t.hintType)
      } catch (err) {
        return `<pre class="mdart-error">${String(err)}</pre>`
      }
    },
  }
}

// ── Convenience wrapper ───────────────────────────────────────────────────────

/** Render a full Markdown document, with mdart fences replaced by SVG. */
export async function renderWithMarked(markdown: string): Promise<string> {
  const instance = new Marked({ extensions: [mdartExtension()] })
  return await instance.parse(markdown)
}
