type Preset = 'half' | 'wide'

type Props = {
  url: string
  name: string
  preset: Preset
  onPresetChange: (p: Preset) => void
  onClose: () => void
}

const PRESET_WIDTH: Record<Preset, string> = {
  half: 'md:w-1/2',
  wide: 'md:w-3/5',
}

export function AppViewPanel({ url, name, preset, onPresetChange, onClose }: Props) {
  return (
    <>
      {/* Divider — desktop only */}
      <div className="hidden md:block w-px bg-app-border flex-shrink-0" />

      {/* Panel — fixed full-screen on mobile, inline column on desktop */}
      <div
        className={`
          fixed inset-0 z-50 flex flex-col bg-app-bg
          md:static md:inset-auto md:z-auto md:flex-shrink-0
          ${PRESET_WIDTH[preset]}
        `}
      >
        {/* Title bar */}
        <div className="flex items-center gap-1.5 h-10 px-3 border-b border-app-border flex-shrink-0 bg-app-bg-raised">
          <span className="flex-1 text-[12px] text-app-text-4 truncate" title={url}>{name}</span>

          {/* Preset toggles */}
          <button
            onClick={() => onPresetChange('half')}
            title="50/50 split"
            className={`hidden md:flex w-7 h-7 items-center justify-center rounded text-[11px] transition-colors
              ${preset === 'half' ? 'bg-app-border-2 text-app-text' : 'text-app-text-6 hover:text-app-text-3'}`}
          >
            ½
          </button>
          <button
            onClick={() => onPresetChange('wide')}
            title="60/40 split (app wider)"
            className={`hidden md:flex w-7 h-7 items-center justify-center rounded text-[11px] transition-colors
              ${preset === 'wide' ? 'bg-app-border-2 text-app-text' : 'text-app-text-6 hover:text-app-text-3'}`}
          >
            ⅔
          </button>

          {/* External link */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in new tab"
            className="w-7 h-7 flex items-center justify-center rounded text-app-text-6 hover:text-app-text-3 transition-colors text-[13px]"
          >
            ↗
          </a>

          {/* Close */}
          <button
            onClick={onClose}
            title="Close"
            className="w-7 h-7 flex items-center justify-center rounded text-app-text-6 hover:text-app-text-3 transition-colors text-[15px]"
          >
            ✕
          </button>
        </div>

        {/* iframe */}
        <iframe
          src={url}
          title={name}
          className="flex-1 w-full border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        />
      </div>
    </>
  )
}
