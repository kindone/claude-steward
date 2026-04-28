import { useEffect, useRef } from 'react'

export type RunStatus = 'running' | 'done' | 'error'

export interface OutputPanelState {
  status: RunStatus
  lines: string[]
  exitCode: number | null
  durationMs: number | null
  compileOutput?: string   // C++ compile step output
  compileOk?: boolean
  abort?: () => void       // call to cancel a running execution
}

interface Props {
  state: OutputPanelState
  onSendToChat?: (text: string) => void
  onDismiss: () => void
}

export function KernelOutputPanel({ state, onSendToChat, onDismiss }: Props) {
  const { status, lines, exitCode, durationMs, compileOutput, compileOk } = state
  const outputRef = useRef<HTMLPreElement>(null)

  // Auto-scroll output as lines arrive
  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const outputText = lines.join('\n')

  return (
    <div className="kernel-output-panel mt-1 mb-2 rounded-md border border-app-border-2 bg-app-bg text-xs font-mono overflow-hidden">
      {/* Compile step (C++ only) */}
      {compileOutput !== undefined && (
        <div className={`px-3 py-1.5 border-b border-app-border-2 text-[11px] ${compileOk ? 'text-green-400' : 'text-red-400'}`}>
          {compileOk ? '✓ Compiled' : '✗ Compile error'}
          {compileOutput && (
            <pre className="mt-1 text-app-text-4 whitespace-pre-wrap">{compileOutput}</pre>
          )}
        </div>
      )}

      {/* Output lines */}
      <pre
        ref={outputRef}
        className="p-3 text-app-text-2 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed"
      >
        {outputText || (status === 'running' ? <span className="text-app-text-6 animate-pulse">Running…</span> : null)}
      </pre>

      {/* Footer */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-app-border-2 bg-app-bg-raised">
        {/* Status badge */}
        <span className={`flex items-center gap-1 text-[11px] ${
          status === 'running' ? 'text-blue-400' :
          status === 'done' && exitCode === 0 ? 'text-green-400' :
          'text-red-400'
        }`}>
          {status === 'running' && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
          {status === 'running' ? 'Running' :
           status === 'done' && exitCode === 0 ? `✓ Done` :
           `✗ Error (exit ${exitCode ?? '?'})`}
          {durationMs != null && status !== 'running' && (
            <span className="text-app-text-6 ml-1">{durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}</span>
          )}
        </span>

        <div className="flex-1" />

        {/* Stop button while running */}
        {status === 'running' && state.abort && (
          <button
            onClick={state.abort}
            className="text-[11px] text-app-text-5 hover:text-red-400 transition-colors cursor-pointer"
          >
            ■ Stop
          </button>
        )}

        {/* Send to chat */}
        {status !== 'running' && outputText && onSendToChat && (
          <button
            onClick={() => onSendToChat(outputText)}
            className="text-[11px] text-app-text-5 hover:text-app-text-3 transition-colors cursor-pointer"
            title="Send output to chat as a follow-up message"
          >
            ↑ Send to chat
          </button>
        )}

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="text-[11px] text-app-text-7 hover:text-app-text-4 transition-colors cursor-pointer"
          title="Dismiss output"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
