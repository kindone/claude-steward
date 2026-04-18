import { memo, useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { cpp } from '@codemirror/lang-cpp'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import type { Extension } from '@codemirror/state'

interface Props {
  value: string
  onChange: (value: string) => void
  language: string
  readOnly?: boolean
  className?: string
  wrapLines?: boolean
  theme?: 'dark' | 'light'
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
      // Disable codeLanguages (embedded language parsing inside fenced code blocks)
      // — it re-parses every block on every keystroke and is expensive for long docs.
      return markdown({ codeLanguages: [] })
    case 'json':
      return json()
    case 'html':
      return html()
    case 'bash':
    case 'shell':
    case 'sh':
      return StreamLanguage.define(shell)
    default:
      return []
  }
}

export const ArtifactCodeMirror = memo(function ArtifactCodeMirror({ value, onChange, language, readOnly = false, className, wrapLines = false, theme = 'dark' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const wrapCompartment = useRef(new Compartment())
  const themeCompartment = useRef(new Compartment())

  // Keep onChange stable inside editor via ref
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Debounce timer for notifying React — CodeMirror updates its own state
  // immediately on every keystroke, but React only gets notified after a
  // 150ms pause. This eliminates per-keystroke React re-renders.
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tracks the last value we notified React about. The value-sync useEffect
  // skips dispatching when it sees this value — it's our own round-trip, not
  // an external change. Without this, there's a race: user types during the
  // gap between our notification and React processing it, causing the stale
  // value to be dispatched back into the editor and the cursor to jump.
  const lastNotifiedRef = useRef(value)

  function buildThemeExtension(t: 'dark' | 'light'): Extension {
    const isDark = t === 'dark'
    return [
      isDark ? oneDark : [],
      EditorView.theme({
        '&': { background: 'var(--app-bg) !important', height: '100%' },
        '.cm-editor': { background: 'var(--app-bg) !important', height: '100%' },
        '.cm-scroller': {
          fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
          fontSize: '12px',
          lineHeight: '1.6',
          overflow: 'auto',
        },
        '.cm-content': { padding: '8px 0', ...(isDark ? {} : { color: 'var(--app-text)' }) },
        '.cm-focused': { outline: 'none' },
        '.cm-gutters': {
          background: 'var(--app-bg)',
          borderRight: '1px solid var(--app-border)',
          color: 'var(--app-text-7)',
        },
        '.cm-activeLineGutter': { background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
        '.cm-activeLine': { background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' },
      }, { dark: isDark }),
    ]
  }

  // Create / recreate editor when language or readOnly changes
  useEffect(() => {
    if (!containerRef.current) return

    const extensions: Extension[] = [
      themeCompartment.current.of(buildThemeExtension(theme)),
      lineNumbers(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([indentWithTab, ...defaultKeymap]),
      langExtension(language),
      EditorView.updateListener.of(u => {
        if (!u.docChanged) return
        // Debounce React notification — editor updates its own rope immediately,
        // but we only push to React state after a 150ms typing pause.
        // Read from viewRef.current at fire-time (not u.state at set-time) so
        // we always send the current content, never stale mid-burst content.
        if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current)
        notifyTimerRef.current = setTimeout(() => {
          const doc = viewRef.current?.state.doc.toString()
          if (doc !== undefined) {
            lastNotifiedRef.current = doc
            onChangeRef.current(doc)
          }
        }, 150)
      }),
    ]

    extensions.push(wrapCompartment.current.of(wrapLines ? EditorView.lineWrapping : []))

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
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current)
      view.destroy()
      viewRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly])

  // Reconfigure line-wrapping without recreating the editor
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrapLines ? EditorView.lineWrapping : []),
    })
  }, [wrapLines])

  // Reconfigure color theme without recreating the editor
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(buildThemeExtension(theme)),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  // Sync external value changes (e.g. SSE refresh) without resetting cursor.
  // Skip when the value is our own round-trip from the debounced notification —
  // the editor already has this content and dispatching would clobber any chars
  // typed in the gap between notification and React processing.
  useEffect(() => {
    if (value === lastNotifiedRef.current) return
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
      style={{ background: 'var(--app-bg)' }}
    />
  )
})
