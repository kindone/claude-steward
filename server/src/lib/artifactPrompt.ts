import { artifactQueries } from '../db/index.js'

export function buildArtifactFragment(projectId: string | null): string {
  if (!projectId) return ''

  // MCP tool instructions (always shown so the agent knows it can create artifacts)
  const toolBlock = `\n---
You have access to MCP tools for managing steward artifacts (from the "steward-artifacts" MCP server):

- artifact_list(session_id) — list all artifacts in the current project
- artifact_create(session_id, name, type, content, metadata?) — create a new artifact that appears in the Art panel
  — type: "chart" (Vega-Lite JSON) | "report" (Markdown) | "data" (JSON/CSV) | "code" (any language) | "pikchr"
  — metadata: { language: "python" } for code, { format: "csv" } for data artifacts
  — Use this to publish analysis results, charts, or code so the user can view, run, and save them.`

  const artifacts = artifactQueries.listByProject(projectId)
  if (artifacts.length === 0) return toolBlock + '\n---'

  const capped = artifacts.slice(0, 20)
  const manifest = capped.map(a => `- ${a.name} (${a.type}, id: ${a.id})`).join('\n')
  return toolBlock + `\n\nProject artifacts:\n${manifest}\n---`
}
