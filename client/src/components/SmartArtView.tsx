import { useEffect, useRef, useState } from 'react'
import { renderSmartArt } from '../lib/smartart/renderer'

interface Props {
  content: string
}

/**
 * SmartArt artifact viewer: textarea editor on the left, live SVG preview on the right.
 * Re-renders the preview on every editor change (debounced 200ms).
 * "Download SVG" saves the rendered SVG as a file.
 */
export function SmartArtView({ content }: Props) {
  const [source, setSource] = useState(content)
  const [svg, setSvg] = useState<string>(() => renderSmartArt(content))
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-render when content prop changes (e.g. artifact reload)
  useEffect(() => {
    setSource(content)
    setSvg(renderSmartArt(content))
  }, [content])

  function handleChange(value: string) {
    setSource(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSvg(renderSmartArt(value))
    }, 200)
  }

  function handleDownload() {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'smartart.svg'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 flex-shrink-0">
        <button
          onClick={handleDownload}
          className="text-[11px] text-[#555] hover:text-[#aaa] py-0.5 px-2 rounded border border-[#2a2a2a] hover:border-[#444]"
          title="Download SVG"
        >
          ↓ Download SVG
        </button>
      </div>

      {/* Split layout */}
      <div className="flex gap-3 min-h-0 flex-1">
        {/* Editor */}
        <div className="flex-1 min-w-0">
          <textarea
            value={source}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full h-full min-h-[200px] rounded-md bg-[#0d0d0d] border border-[#2a2a2a] text-[#ccc] text-[12px] font-mono p-3 resize-none focus:outline-none focus:border-[#444]"
            spellCheck={false}
            placeholder="type: process&#10;&#10;- Step 1&#10;- Step 2&#10;- Step 3"
          />
        </div>

        {/* Preview */}
        <div className="flex-1 min-w-0 overflow-auto rounded-md bg-[#0a0a0a] border border-[#2a2a2a] p-3 flex items-start">
          <div
            className="w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>
  )
}
