import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { cpp } from '@codemirror/lang-cpp'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import type { Extension } from '@codemirror/state'
import type { Language } from '../types'

function langExtension(language: Language): Extension {
  switch (language) {
    case 'python': return python()
    case 'node':   return javascript()
    case 'bash':   return StreamLanguage.define(shell)
    case 'cpp':    return cpp()
    default:       return []
  }
}

interface Props {
  value: string
  language: Language
  onChange: (val: string) => void
  onRun: () => void
  onBlur: () => void
  wrapLines?: boolean
}

export function CodeMirrorEditor({ value, language, onChange, onRun, onBlur, wrapLines = false }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const viewRef       = useRef<EditorView | null>(null)
  const wrapCompartment = useRef(new Compartment())

  // Keep callbacks stable inside the editor via refs
  const onChangeRef = useRef(onChange)
  const onRunRef    = useRef(onRun)
  const onBlurRef   = useRef(onBlur)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onRunRef.current    = onRun    }, [onRun])
  useEffect(() => { onBlurRef.current   = onBlur   }, [onBlur])

  // Create / recreate editor when language changes
  useEffect(() => {
    if (!containerRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          oneDark,
          langExtension(language),
          keymap.of([
            { key: 'Ctrl-Enter', mac: 'Mod-Enter', run: () => { onRunRef.current(); return true } },
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of(u => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            blur: () => { onBlurRef.current(); return false },
          }),
          EditorView.theme({
            '&':                       { background: 'transparent !important' },
            '.cm-editor':              { background: 'transparent !important' },
            '.cm-scroller':            { fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", monospace)', overflow: 'auto' },
            '.cm-content':             { padding: '12px', minHeight: '80px' },
            '.cm-focused':             { outline: 'none' },
            '.cm-gutters':             { background: 'rgba(0,0,0,0.2)', borderRight: '1px solid rgba(255,255,255,0.06)' },
            '.cm-activeLine':          { background: 'rgba(255,255,255,0.03)' },
            '.cm-activeLineGutter':    { background: 'rgba(255,255,255,0.05)' },
          }),
          wrapCompartment.current.of(wrapLines ? EditorView.lineWrapping : []),
        ],
      }),
      parent: containerRef.current,
    })

    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // Reconfigure line-wrapping without recreating the editor
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrapLines ? EditorView.lineWrapping : []),
    })
  }, [wrapLines])

  // Sync external value changes (file watcher / AI edits)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <div ref={containerRef} className="w-full" />
}
