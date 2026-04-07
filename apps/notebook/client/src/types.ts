export type Language = 'python' | 'node' | 'bash' | 'cpp'
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
  source: string
  created_at: number
  updated_at: number
}

export interface KernelStatus {
  language: Language
  alive: boolean
  pid: number | null
}

export interface OutputLine {
  text: string
  isError?: boolean
}

export interface CompileResult {
  ok: boolean
  output: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
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
