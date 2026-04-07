import fs from 'node:fs'
import path from 'node:path'
import { artifactQueries } from '../db/index.js'

const MAX_CONTENT_BYTES = 50_000
const MAX_ARTIFACTS = 5

export function resolveArtifactMentions(message: string, project: { id: string; path: string }): string {
  // Find all @name tokens (word boundary, alphanumeric + hyphens/underscores)
  const matches = [...message.matchAll(/@([\w-]+)/g)]
  if (matches.length === 0) return message

  const injected: string[] = []
  let count = 0

  for (const match of matches) {
    if (count >= MAX_ARTIFACTS) break
    const name = match[1]
    const artifact = artifactQueries.findByProjectAndName(project.id, name)
    if (!artifact) continue

    const absPath = path.join(project.path, artifact.path)
    let content: string
    try {
      const raw = fs.readFileSync(absPath, 'utf8')
      content = raw.length > MAX_CONTENT_BYTES
        ? raw.slice(0, MAX_CONTENT_BYTES) + '\n... [truncated]'
        : raw
    } catch {
      continue
    }

    injected.push(`[Artifact: ${artifact.name} (${artifact.type})]\n${content}\n---`)
    count++
  }

  if (injected.length === 0) return message
  return injected.join('\n') + '\n\n' + message
}
