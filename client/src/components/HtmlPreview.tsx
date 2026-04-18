import { useState } from 'react'

type Props = {
  /** Raw HTML source to preview. */
  html: string
}

/**
 * Renders a standalone HTML artifact produced by Claude.
 *
 * Provides a togglable source/preview view:
 * - Preview tab: sandboxed `<iframe srcdoc>` (scripts allowed, no parent access).
 * - Source tab: syntax-highlighted `<pre>` of the raw HTML.
 */
export function HtmlPreview({ html }: Props) {
  const [showSource, setShowSource] = useState(false)

  return (
    <div className="my-2 rounded-xl border border-app-border-2 overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-app-bg-raised border-b border-app-border-2">
        <span className="text-[11px] text-app-text-6 select-none">HTML</span>
        <div className="flex gap-1">
          <TabButton active={!showSource} onClick={() => setShowSource(false)}>
            Preview
          </TabButton>
          <TabButton active={showSource} onClick={() => setShowSource(true)}>
            Source
          </TabButton>
        </div>
      </div>

      {/* Content */}
      {showSource ? (
        <pre className="p-4 text-xs text-app-text-2 bg-app-bg overflow-x-auto whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto">
          <code>{html}</code>
        </pre>
      ) : (
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          className="w-full border-none bg-white"
          style={{ minHeight: '200px', maxHeight: '600px' }}
          onLoad={(e) => {
            // Auto-size to content height, capped at 600px
            const iframe = e.currentTarget
            try {
              const body = iframe.contentDocument?.body
              if (body) {
                const h = Math.min(600, Math.max(200, body.scrollHeight + 16))
                iframe.style.height = `${h}px`
              }
            } catch {
              // cross-origin / sandboxed — leave at default height
            }
          }}
          title="HTML preview"
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
        active
          ? 'bg-app-border-2 text-app-text-2'
          : 'text-app-text-6 hover:text-app-text-4'
      }`}
    >
      {children}
    </button>
  )
}
