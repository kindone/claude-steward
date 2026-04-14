/**
 * remark-mdart adapter
 *
 * A real unified/remark plugin that visits `code` nodes in the mdast tree,
 * renders any node whose `lang === 'mdart'` to SVG, and replaces it with an
 * `html` node so the inline SVG passes through rehype untouched.
 *
 * This is the exact shape a published `remark-mdart` package would export —
 * only the import path would change from a local relative path to `@mdart/core`.
 *
 * Usage (app code):
 *   import { unified }        from 'unified'
 *   import remarkParse        from 'remark-parse'
 *   import remarkRehype       from 'remark-rehype'
 *   import rehypeStringify    from 'rehype-stringify'
 *   import { remarkMdart }    from 'remark-mdart'
 *
 *   const html = await unified()
 *     .use(remarkParse)
 *     .use(remarkMdart)                // ← inject before remarkRehype
 *     .use(remarkRehype, { allowDangerousHtml: true })
 *     .use(rehypeStringify, { allowDangerousHtml: true })
 *     .process(markdown)
 *     .then(String)
 */

import { unified }            from 'unified'
import remarkParse            from 'remark-parse'
import remarkRehype           from 'remark-rehype'
import rehypeStringify        from 'rehype-stringify'
import { visit }              from 'unist-util-visit'
import type { Root, Code, Html } from 'mdast'
import type { Plugin }        from 'unified'

// In a published package this would be:  import { renderMdArt } from '@mdart/core'
import { renderMdArt } from '../../../../client/src/lib/mdart/renderer.js'

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * remarkMdart — remark plugin
 *
 * Transforms `code` nodes with lang="mdart" into raw `html` nodes containing
 * the rendered SVG. Must be used before remarkRehype.
 */
export const remarkMdart: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, 'code', (node: Code, index, parent) => {
    if (node.lang !== 'mdart') return

    // node.meta holds the hint type (the text after the language tag)
    const hintType = node.meta?.trim() || undefined

    let svg: string
    try {
      svg = renderMdArt(node.value, hintType)
    } catch (err) {
      svg = `<pre class="mdart-error">${String(err)}</pre>`
    }

    // Replace the code node with a raw HTML node.
    // remarkRehype's `allowDangerousHtml: true` will pass it through as-is.
    const htmlNode: Html = { type: 'html', value: svg }
    if (parent && typeof index === 'number') {
      parent.children.splice(index, 1, htmlNode)
    }
  })
}

// ── Convenience wrapper ───────────────────────────────────────────────────────

/** Render a full Markdown document, with mdart fences replaced by SVG. */
export async function renderWithUnified(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkMdart)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown)
  return String(file)
}
