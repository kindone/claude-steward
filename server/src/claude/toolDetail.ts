/**
 * Shared tool-call shape for DB JSON and worker/chat accumulation.
 */
export type StoredToolCall = {
  id: string
  name: string
  detail?: string
  output?: string
  isError?: boolean
}

/** Short human-readable detail for tool pills (matches client expectations). */
export function extractToolDetail(name: string, input: Record<string, unknown>): string | undefined {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined)
  switch (name) {
    case 'Bash':
      return s(input.command)?.replace(/\s+/g, ' ').slice(0, 100)
    case 'Read':
      return s(input.file_path)
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return s(input.file_path)
    case 'WebSearch':
      return s(input.query)?.slice(0, 80)
    case 'WebFetch':
      return s(input.url)?.slice(0, 80)
    default: {
      // opencode / generic tools (list_dir, glob, …) often use path-like fields
      return (
        s(input.path) ??
        s(input.target_directory) ??
        s(input.directory) ??
        s(input.pattern) ??
        s(input.file_path) ??
        s(input.filePath) ??
        undefined
      )
    }
  }
}
