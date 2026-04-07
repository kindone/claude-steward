import { artifactQueries } from '../db/index.js'

export function buildArtifactFragment(projectId: string | null): string {
  if (!projectId) return ''
  const artifacts = artifactQueries.listByProject(projectId)
  if (artifacts.length === 0) return ''
  const capped = artifacts.slice(0, 20)
  const manifest = capped.map(a => `- ${a.name} (${a.type}, id: ${a.id})`).join('\n')
  return `\n---\nProject artifacts:\n${manifest}\n---`
}
