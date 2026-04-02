import fs from 'node:fs'
import path from 'node:path'

function listDocFiles(docsDir: string, maxFiles = 40): string {
  const results: string[] = []
  const docsPath = path.join(docsDir, 'docs')
  if (!fs.existsSync(docsPath)) return '  (docs/ directory not found)'

  const walk = (dir: string, prefix = '') => {
    if (results.length >= maxFiles) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel)
      } else if (entry.name.endsWith('.md')) {
        results.push(`  docs/${rel}`)
      }
    }
  }
  walk(docsPath)
  if (results.length >= maxFiles) results.push('  … (truncated)')
  return results.join('\n') || '  (no .md files found)'
}

function readMkDocsConfig(docsDir: string): string {
  const yml = path.join(docsDir, 'mkdocs.yml')
  if (!fs.existsSync(yml)) return '  (mkdocs.yml not found)'
  const content = fs.readFileSync(yml, 'utf8')
  // Limit to first 40 lines to keep prompt lean
  return content.split('\n').slice(0, 40).map(l => `  ${l}`).join('\n')
}

export function buildSystemPrompt(docsDir: string): string {
  const files = listDocFiles(docsDir)
  const config = readMkDocsConfig(docsDir)

  return `You are an AI assistant embedded in a MkDocs documentation site.
Your working directory is the documentation project root: ${docsDir}

## Project structure
\`\`\`
mkdocs.yml          ← site config, navigation
docs/               ← all markdown source files
${files}
\`\`\`

## mkdocs.yml (first 40 lines)
\`\`\`yaml
${config}
\`\`\`

## What you can do
- Read any page: Read docs/<path>.md
- Edit a page: Edit docs/<path>.md
- Create a new page: Write docs/<path>.md (then add it to mkdocs.yml nav if needed)
- Restructure nav: Edit mkdocs.yml
- The MkDocs dev server is running and will hot-reload any file changes automatically

## Guidelines
- Keep edits focused and minimal — don't rewrite entire pages unless asked
- When adding a new page, always update the nav in mkdocs.yml
- Markdown flavour is MkDocs Material — you can use admonitions, tabs, code blocks with syntax highlighting
- After editing, briefly summarise what changed
`
}
