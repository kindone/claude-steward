export type Language = 'python' | 'node' | 'bash' | 'cpp' | 'sql'
export type CellType = 'code' | 'markdown'

export interface Notebook {
  id: string
  title: string
  claude_session_id: string | null
  created_at: number
  updated_at: number
}

export interface Cell {
  id: string
  notebook_id: string
  type: CellType
  language: Language
  position: number
  name: string | null
  source: string
  created_at: number
  updated_at: number
}

export interface KernelStatus {
  language: Language
  alive: boolean
  pid: number | null
}

export interface TextOutputItem {
  kind: 'text'
  text: string
  isError?: boolean
}

export type RichOutputKind = 'vega' | 'html' | 'image' | 'table'

export interface RichOutputItem {
  kind: RichOutputKind
  payload: string   // base64-encoded, decoded by renderer
}

export type OutputItem = TextOutputItem | RichOutputItem

// Legacy alias so any remaining OutputLine references still compile
export type OutputLine = TextOutputItem

export interface CompileResult {
  ok: boolean
  output: string
}

export interface ChatSession {
  id: string
  notebook_id: string
  claude_session_id: string | null
  title: string
  created_at: number
  updated_at: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'divider'
  content: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
  isError?: boolean
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
}
