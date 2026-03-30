/**
 * Tests for markdownRenderer.ts utilities.
 */
import { describe, it, expect } from 'vitest'
import { splitContent, buildMarkedOptions, preprocessKaTeX } from '../lib/markdownRenderer'
import { marked } from 'marked'

// ── splitContent ─────────────────────────────────────────────────────────────

describe('splitContent', () => {
  it('returns single markdown segment when no html fence present', () => {
    const result = splitContent('Hello **world**')
    expect(result).toEqual([{ type: 'markdown', content: 'Hello **world**' }])
  })

  it('returns single html-preview segment for standalone html fence', () => {
    const raw = '```html\n<h1>Hello</h1>\n```'
    const result = splitContent(raw)
    expect(result).toEqual([{ type: 'html-preview', content: '<h1>Hello</h1>\n' }])
  })

  it('splits markdown before and after html fence', () => {
    const raw = 'Before\n```html\n<p>html</p>\n```\nAfter'
    const result = splitContent(raw)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ type: 'markdown', content: 'Before\n' })
    expect(result[1]).toEqual({ type: 'html-preview', content: '<p>html</p>\n' })
    expect(result[2]).toEqual({ type: 'markdown', content: '\nAfter' })
  })

  it('handles multiple html fences', () => {
    const raw = '```html\n<div>A</div>\n```\ntext\n```html\n<div>B</div>\n```'
    const result = splitContent(raw)
    expect(result.filter((s) => s.type === 'html-preview')).toHaveLength(2)
    expect(result.filter((s) => s.type === 'markdown')).toHaveLength(1)
  })

  it('does not treat non-html fences as html-preview', () => {
    const raw = '```js\nconsole.log("hi")\n```'
    const result = splitContent(raw)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('markdown')
  })

  it('returns single markdown segment for empty string', () => {
    const result = splitContent('')
    expect(result).toEqual([{ type: 'markdown', content: '' }])
  })
})

// ── buildMarkedOptions (Mermaid placeholder) ─────────────────────────────────

describe('buildMarkedOptions – mermaid', () => {
  it('renders mermaid fences as placeholder divs', () => {
    const { renderer } = buildMarkedOptions(null)
    const html = marked.parse('```mermaid\ngraph TD\nA-->B\n```', { renderer }) as string
    expect(html).toContain('class="mermaid-placeholder"')
    expect(html).toContain('data-graph=')
  })

  it('encodes graph source in data-graph attribute', () => {
    const src = 'graph TD\nA-->B'
    const { renderer } = buildMarkedOptions(null)
    const html = marked.parse(`\`\`\`mermaid\n${src}\n\`\`\``, { renderer }) as string
    expect(html).toContain(encodeURIComponent(src))
  })

  it('renders non-mermaid fences normally', () => {
    const { renderer } = buildMarkedOptions(null)
    const html = marked.parse('```js\nconsole.log(1)\n```', { renderer }) as string
    expect(html).not.toContain('mermaid-placeholder')
    expect(html).toContain('<code')
  })
})

// ── buildMarkedOptions (image URL rewriting) ─────────────────────────────────

describe('buildMarkedOptions – image rewriting', () => {
  it('rewrites relative image paths when projectId is set', () => {
    const { renderer } = buildMarkedOptions('proj-123')
    const html = marked.parse('![alt](./output.png)', { renderer }) as string
    expect(html).toContain('/api/projects/proj-123/files/raw')
    expect(html).toContain(encodeURIComponent('./output.png'))
  })

  it('leaves absolute http URLs untouched', () => {
    const { renderer } = buildMarkedOptions('proj-123')
    const html = marked.parse('![alt](https://example.com/img.png)', { renderer }) as string
    expect(html).toContain('https://example.com/img.png')
    expect(html).not.toContain('/api/projects/')
  })

  it('leaves data URIs untouched', () => {
    const { renderer } = buildMarkedOptions('proj-123')
    const dataUri = 'data:image/png;base64,abc'
    const html = marked.parse(`![alt](${dataUri})`, { renderer }) as string
    expect(html).toContain(dataUri)
    expect(html).not.toContain('/api/projects/')
  })

  it('does not rewrite images when projectId is null', () => {
    const { renderer } = buildMarkedOptions(null)
    const html = marked.parse('![alt](./output.png)', { renderer }) as string
    expect(html).not.toContain('/api/projects/')
  })
})

// ── preprocessKaTeX ───────────────────────────────────────────────────────────

describe('preprocessKaTeX', () => {
  it('returns text unchanged when no $ present', () => {
    const text = 'No math here'
    expect(preprocessKaTeX(text)).toBe(text)
  })

  it('replaces display math $$...$$ with KaTeX HTML', () => {
    const result = preprocessKaTeX('$$x^2 + y^2 = r^2$$')
    expect(result).toContain('katex')
    expect(result).not.toContain('$$')
  })

  it('replaces inline math $...$ with KaTeX HTML', () => {
    const result = preprocessKaTeX('The formula $E=mc^2$ is famous.')
    expect(result).toContain('katex')
    expect(result).not.toContain('$E=mc^2$')
  })

  it('skips math inside triple-backtick code fences', () => {
    const text = '```\n$E=mc^2$\n```'
    const result = preprocessKaTeX(text)
    // Content inside fences must not be rendered by KaTeX
    expect(result).toBe(text)
  })

  it('skips math inside inline code spans', () => {
    const text = 'Use `$x$` to write math'
    const result = preprocessKaTeX(text)
    expect(result).toBe(text)
  })

  it('handles text with $ (currency) without false positives', () => {
    // Single $ at end-of-word or adjacent to space should not match
    const text = 'It costs $50 and $100.'
    // Single digit tokens — the regex requires non-whitespace on both sides, so "$50" fails
    // because "5" is not preceded by "$" that matches the pattern (there's a space after the $)
    const result = preprocessKaTeX(text)
    // We just check it doesn't throw and doesn't produce katex HTML for simple currency
    expect(result).toBe(text)
  })
})
