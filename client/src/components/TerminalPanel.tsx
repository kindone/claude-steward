import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { execCommand } from '../lib/api'

type Props = {
  projectId: string
}

export function TerminalPanel({ projectId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)

  // Command history — most-recent-last; index -1 means "no selection"
  const historyRef = useRef<string[]>([])
  const historyIdxRef = useRef(-1)
  // Stash the in-progress input when cycling history
  const draftRef = useRef('')

  // Initialise xterm.js once on mount
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0d0d0d',
        foreground: '#cccccc',
        cursor: '#cccccc',
        selectionBackground: '#333333',
        black: '#1a1a1a', brightBlack: '#555555',
        red: '#e06c75', brightRed: '#e06c75',
        green: '#98c379', brightGreen: '#98c379',
        yellow: '#e5c07b', brightYellow: '#e5c07b',
        blue: '#61afef', brightBlue: '#61afef',
        magenta: '#c678dd', brightMagenta: '#c678dd',
        cyan: '#56b6c2', brightCyan: '#56b6c2',
        white: '#abb2bf', brightWhite: '#ffffff',
      },
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 2000,
      convertEol: true,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)

    // Safe initial fit — element may not have dimensions yet if hidden
    try { fit.fit() } catch { /* retry via ResizeObserver */ }

    termRef.current = term
    fitAddonRef.current = fit

    // Refit whenever the container resizes (also fires when going from hidden → visible)
    const observer = new ResizeObserver(() => {
      try { fit.fit() } catch { /* ignore */ }
    })
    observer.observe(containerRef.current)

    term.writeln('\x1b[2m# Terminal ready — commands run in the project directory\x1b[0m')

    return () => {
      observer.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  const runCommand = useCallback(() => {
    const cmd = command.trim()
    if (!cmd || running) return

    const term = termRef.current
    if (!term) return

    // Append to history (skip duplicates at the tail)
    if (historyRef.current[historyRef.current.length - 1] !== cmd) {
      historyRef.current.push(cmd)
    }
    historyIdxRef.current = -1
    draftRef.current = ''

    term.writeln(`\r\n\x1b[1;32m$\x1b[0m \x1b[1m${cmd}\x1b[0m`)
    setCommand('')
    setRunning(true)

    const cancel = execCommand(projectId, cmd, {
      onOutput: (text) => term.write(text),
      onDone: (exitCode) => {
        const color = exitCode === 0 ? '\x1b[32m' : '\x1b[31m'
        term.writeln(`\r\n${color}[exit ${exitCode}]\x1b[0m`)
        setRunning(false)
        cancelRef.current = null
      },
      onError: (msg) => {
        term.writeln(`\r\n\x1b[31m[error] ${msg}\x1b[0m`)
        setRunning(false)
        cancelRef.current = null
      },
    })

    cancelRef.current = cancel
  }, [command, projectId, running])

  function handleStop() {
    cancelRef.current?.()
    cancelRef.current = null
    termRef.current?.writeln('\r\n\x1b[33m[stopped]\x1b[0m')
    setRunning(false)
  }

  function handleClear() {
    termRef.current?.clear()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      runCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const hist = historyRef.current
      if (hist.length === 0) return
      if (historyIdxRef.current === -1) draftRef.current = command
      const next = Math.min(historyIdxRef.current + 1, hist.length - 1)
      historyIdxRef.current = next
      setCommand(hist[hist.length - 1 - next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = historyIdxRef.current - 1
      historyIdxRef.current = next
      if (next < 0) {
        historyIdxRef.current = -1
        setCommand(draftRef.current)
      } else {
        setCommand(historyRef.current[historyRef.current.length - 1 - next])
      }
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#0d0d0d]">
      {/* xterm.js viewport */}
      <div ref={containerRef} className="flex-1 min-h-0 px-1 pt-1" />

      {/* Input bar */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-t border-[#1f1f1f] flex-shrink-0">
        <span className="text-[#4a9] text-[12px] font-mono flex-shrink-0 select-none">$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => { setCommand(e.target.value); historyIdxRef.current = -1 }}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder={running ? 'Running…' : 'Enter command'}
          className="flex-1 bg-transparent border-none outline-none text-[12px] font-mono text-[#ccc] placeholder-[#333] disabled:opacity-40 min-w-0"
          style={{ fontFamily: "'SF Mono', 'Fira Code', monospace" }}
          spellCheck={false}
          autoComplete="off"
        />
        {running ? (
          <button
            onClick={handleStop}
            className="text-[10px] px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 cursor-pointer bg-transparent transition-colors flex-shrink-0"
          >
            Stop
          </button>
        ) : (
          <>
            <button
              onClick={runCommand}
              disabled={!command.trim()}
              className="text-[10px] px-2 py-1 rounded border border-[#2a2a2a] text-[#666] hover:text-[#ccc] hover:border-[#444] cursor-pointer bg-transparent transition-colors disabled:opacity-30 disabled:cursor-default flex-shrink-0"
            >
              Run
            </button>
            <button
              onClick={handleClear}
              className="text-[10px] px-1.5 py-1 rounded text-[#444] hover:text-[#666] cursor-pointer bg-transparent border-none transition-colors flex-shrink-0"
              title="Clear terminal"
            >
              ⌫
            </button>
          </>
        )}
      </div>
    </div>
  )
}
