/**
 * Utilities for rendering Claude message content.
 *
 * - buildMarkedOptions: returns a marked renderer with Mermaid placeholder divs
 *   and project-relative image URL rewriting.
 * - splitContent: splits raw content into markdown and sandboxed HTML-preview segments.
 * - preprocessKaTeX: replaces $…$ and $$…$$ with KaTeX-rendered HTML before markdown parsing.
 */

import { marked } from 'marked'
import katex from 'katex'

// ── Types ─────────────────────────────────────────────────────────────────────

export type MarkdownSegment = { type: 'markdown'; content: string }
export type HtmlPreviewSegment = { type: 'html-preview'; content: string }
export type Segment = MarkdownSegment | HtmlPreviewSegment

// ── splitContent ──────────────────────────────────────────────────────────────

/**
 * Split message content into markdown segments and sandboxed HTML-preview segments.
 *
 * A ```html … ``` fenced block at the top level is treated as a standalone HTML
 * artifact and rendered in a sandboxed iframe. Everything else stays as markdown.
 *
 * If no HTML fences are found the entire content is returned as a single markdown
 * segment.
 */
export function splitContent(raw: string): Segment[] {
  const segments: Segment[] = []
  // Match ```html fences; the fence must start at beginning-of-line.
  const HTML_FENCE_RE = /^```html[ \t]*\n([\s\S]*?)^```[ \t]*$/gm
  let lastIndex = 0

  for (const match of raw.matchAll(HTML_FENCE_RE)) {
    const before = raw.slice(lastIndex, match.index)
    if (before.trim()) {
      segments.push({ type: 'markdown', content: before })
    }
    segments.push({ type: 'html-preview', content: match[1] ?? '' })
    lastIndex = match.index! + match[0].length
  }

  const tail = raw.slice(lastIndex)
  if (tail.trim() || segments.length === 0) {
    segments.push({ type: 'markdown', content: tail })
  }

  return segments
}

// ── buildMarkedOptions ────────────────────────────────────────────────────────

const RAW_FILE_URL = (projectId: string, path: string) =>
  `/api/projects/${projectId}/files/raw?path=${encodeURIComponent(path)}`

/**
 * Return a marked renderer instance that:
 * - Replaces ```mermaid blocks with a placeholder div for post-render hydration.
 * - Rewrites relative image URLs to the project file-binary endpoint.
 *
 * @param projectId  Active project ID, or null when no project is open.
 */
export function buildMarkedOptions(projectId: string | null): { renderer: InstanceType<typeof marked.Renderer> } {
  const renderer = new marked.Renderer()

  // Mermaid + code block renderer
  const parentCode = renderer.code.bind(renderer)
  renderer.code = function (token) {
    if (token.lang === 'mermaid') {
      // Encode the graph source into a data attribute; the useEffect in
      // MessageBubble picks these up and renders them with mermaid.js.
      const encoded = encodeURIComponent(token.text)
      return `<div class="mermaid-placeholder" data-graph="${encoded}"></div>`
    }
    return parentCode(token)
  }

  // Image URL rewriting for relative paths
  if (projectId) {
    renderer.image = function ({ href, title, text }) {
      const resolved = resolveImageHref(href, projectId)
      const attrs = [
        `src="${escapeAttr(resolved)}"`,
        `alt="${escapeAttr(text ?? '')}"`,
        title ? `title="${escapeAttr(title)}"` : null,
      ].filter(Boolean).join(' ')
      return `<img ${attrs} />`
    }
  }

  return { renderer }
}

// ── preprocessKaTeX ───────────────────────────────────────────────────────────

/**
 * Replace LaTeX math expressions with KaTeX-rendered HTML before markdown parsing.
 *
 * - `$$…$$` → display-mode KaTeX (block)
 * - `$…$`   → inline-mode KaTeX
 *
 * Content inside backtick code spans/fences is left untouched.
 * Returns the original string unchanged when no `$` is present.
 *
 * KaTeX requires `style` attributes to render correctly; the caller must allow
 * them in DOMPurify (ADD_ATTR: ['style']).
 */
export function preprocessKaTeX(text: string): string {
  if (!text.includes('$')) return text

  // Build a list of code-span/fence ranges to skip
  const skipRanges: Array<[number, number]> = []
  for (const m of text.matchAll(/```[\s\S]*?```|`[^`]*`/g)) {
    skipRanges.push([m.index!, m.index! + m[0].length])
  }
  const inSkip = (start: number, end: number) =>
    skipRanges.some(([s, e]) => start >= s && end <= e)

  // Replace $$…$$ first (display mode)
  let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (full, expr: string, offset: number) => {
    if (inSkip(offset, offset + full.length)) return full
    try {
      return katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false })
    } catch {
      return full
    }
  })

  // Replace $…$ inline — content must be non-empty, no leading/trailing whitespace
  result = result.replace(/\$([^\s$`][^$`\n]*[^\s$`]|[^\s$`])\$/g, (full, expr: string, offset: number) => {
    if (inSkip(offset, offset + full.length)) return full
    try {
      return katex.renderToString(expr, { displayMode: false, throwOnError: false })
    } catch {
      return full
    }
  })

  return result
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Rewrite a relative image href to the project file-binary endpoint. */
function resolveImageHref(href: string | null | undefined, projectId: string): string {
  if (!href) return ''
  // Leave absolute URLs, data URIs, and root-relative paths untouched.
  if (/^(?:https?:|data:|\/)/i.test(href)) return href
  return RAW_FILE_URL(projectId, href)
}

/** Minimal HTML attribute escaping. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
