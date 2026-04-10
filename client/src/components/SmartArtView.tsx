import { useEffect, useState } from 'react'
import { renderSmartArt } from '../lib/smartart/renderer'

interface Props {
  content: string
}

/**
 * Pure SmartArt preview — renders source text to SVG.
 * Layout and view mode toggling is owned by ArtifactEditor.
 */
export function SmartArtView({ content }: Props) {
  const [svg, setSvg] = useState(() => renderSmartArt(content))

  useEffect(() => {
    setSvg(renderSmartArt(content))
  }, [content])

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
    <div className="flex flex-col gap-2 h-full p-3">
      <div className="flex justify-end flex-shrink-0">
        <button
          onClick={handleDownload}
          className="text-[11px] text-[#555] hover:text-[#aaa] py-0.5 px-2 rounded border border-[#2a2a2a] hover:border-[#444]"
          title="Download SVG"
        >
          ↓ SVG
        </button>
      </div>
      <div className="w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}
