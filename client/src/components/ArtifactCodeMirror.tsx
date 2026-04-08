import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { cpp } from '@codemirror/lang-cpp'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import type { Extension } from '@codemirror/state'

interface Props {
  value: string
  onChange: (value: string) => void
  language: string
  readOnly?: boolean
  className?: string
}

function langExtension(language: string): Extension {
  switch (language.toLowerCase()) {
    case 'python':
      return python()
    case 'javascript':
    case 'js':
      return javascript()
    case 'typescript':
    case 'ts':
      return javascript({ typescript: true })
    case 'cpp':
    case 'c++':
    case 'c':
      return cpp()
    case 'markdown':
    case 'md':
      return markdown()
    case 'json':
      return json()
    case 'bash':
    case 'shell':
    case 'sh':
      return StreamLanguage.define(shell)
    default:
      return []
  }
}

export function ArtifactCodeMirror({ value, onChange, language, readOnly = false, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Keep onChange stable inside editor via ref
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Create / recreate editor when language or readOnly changes
  useEffect(() => {
    if (!containerRef.current) return

    const extensions: Extension[] = [
      oneDark,
      lineNumbers(),
      syntaxHighlighting(defaultHighlightStyle),
      bracketMatching(),
      keymap.of([indentWithTab, ...defaultKeymap]),
      langExtension(language),
      EditorView.updateListener.of(u => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString())
      }),
      EditorView.theme({
        '&': { background: '#0d0d0d !important', height: '100%' },
        '.cm-editor': { background: '#0d0d0d !important', height: '100%' },
        '.cm-scroller': {
          fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
          fontSize: '12px',
          lineHeight: '1.6',
          overflow: 'auto',
        },
        '.cm-content': { padding: '8px 0' },
        '.cm-focused': { outline: 'none' },
        '.cm-gutters': {
          background: '#0d0d0d',
          borderRight: '1px solid #1f1f1f',
          color: '#444',
        },
        '.cm-activeLineGutter': { background: 'rgba(255,255,255,0.04)' },
        '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
      }),
    ]

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true))
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions,
      }),
      parent: containerRef.current,
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly])

  // Sync external value changes (e.g. SSE refresh) without resetting cursor
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ background: '#0d0d0d' }}
    />
  )
}
