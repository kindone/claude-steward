export interface SmartArtItem {
  label: string
  value?: string          // from "label: value" pattern
  attrs: string[]         // from [attr, attr] brackets
  children: SmartArtItem[]
  flowChildren: SmartArtItem[]   // → prefixed children
  prefix?: '+' | '-' | '?' | '!'  // swot prefix chars
  isIntersection?: boolean        // label contains ∩
  isMilestone?: boolean           // * prefix
}

export interface SmartArtSpec {
  type: string
  theme?: string
  title?: string
  direction?: 'LR' | 'TB'
  width?: number
  items: SmartArtItem[]
  nodes?: string[]        // for network graph sections
  edges?: Array<{from: string, to: string}>
  raw: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAttrs(segment: string): { cleanLabel: string; attrs: string[] } {
  // Find last [...] bracket group
  const bracketMatch = segment.match(/^(.*)\[([^\]]*)\]\s*$/)
  if (!bracketMatch) {
    return { cleanLabel: segment.trim(), attrs: [] }
  }
  const cleanLabel = bracketMatch[1].trim()
  const attrs = bracketMatch[2].split(',').map(a => a.trim()).filter(Boolean)
  return { cleanLabel, attrs }
}

function parseLabelValue(raw: string): { label: string; value?: string } {
  // Split on first colon that's not part of a URL (://)
  const colonIdx = raw.indexOf(':')
  if (colonIdx === -1) return { label: raw.trim() }
  // Check if it's a URL
  if (raw[colonIdx + 1] === '/' && raw[colonIdx + 2] === '/') return { label: raw.trim() }
  const label = raw.slice(0, colonIdx).trim()
  const value = raw.slice(colonIdx + 1).trim()
  return { label, value: value || undefined }
}

function parseItem(rawLine: string): SmartArtItem {
  const { cleanLabel, attrs } = parseAttrs(rawLine)
  const { label, value } = parseLabelValue(cleanLabel)
  return {
    label,
    value,
    attrs,
    children: [],
    flowChildren: [],
    isIntersection: label.includes('∩'),
  }
}

function indentLevel(line: string): number {
  let spaces = 0
  for (const ch of line) {
    if (ch === ' ') spaces++
    else if (ch === '\t') spaces += 2
    else break
  }
  return Math.floor(spaces / 2)
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseSmartArt(raw: string, hintType?: string): SmartArtSpec {
  try {
    return _parseSmartArt(raw, hintType)
  } catch {
    // On any parse error, return a minimal valid spec
    return {
      type: hintType ?? 'process',
      items: [],
      raw,
    }
  }
}

function _parseSmartArt(raw: string, hintType?: string): SmartArtSpec {
  const lines = raw.split('\n')
  const spec: SmartArtSpec = {
    type: hintType ?? '',
    items: [],
    raw,
  }

  // Track whether we're in nodes: or edges: sections
  let inNodes = false
  let inEdges = false
  const nodes: string[] = []
  const edges: Array<{from: string, to: string}> = []

  // ── Front-matter parsing ──────────────────────────────────────────────────
  // Front-matter: key: value lines before first blank line or bullet/flow/prefix/section
  const bodyStartChars = new Set(['-', '→', '+', '?', '!', '*'])
  const sectionHeaders = new Set(['nodes:', 'edges:'])

  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      // blank line ends front-matter
      bodyStart = i + 1
      break
    }
    if (bodyStartChars.has(trimmed[0]) || sectionHeaders.has(trimmed.toLowerCase())) {
      bodyStart = i
      break
    }
    // Try to parse as front-matter key: value
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim().toLowerCase()
      const val = trimmed.slice(colonIdx + 1).trim()
      if (key === 'type') spec.type = val
      else if (key === 'theme') spec.theme = val
      else if (key === 'title') spec.title = val
      else if (key === 'direction') spec.direction = val as 'LR' | 'TB'
      else if (key === 'width') spec.width = parseInt(val, 10) || undefined
      else {
        // Not a recognized front-matter key — treat as body start
        bodyStart = i
        break
      }
      bodyStart = i + 1
    } else {
      // No colon — body start
      bodyStart = i
      break
    }
  }

  // Fallback to hintType if not set in front-matter
  if (!spec.type && hintType) spec.type = hintType
  if (!spec.type) spec.type = 'process'

  // ── Arrow chain detection ──────────────────────────────────────────────────
  // Check if the entire body is a single arrow-chain line
  const bodyLines = lines.slice(bodyStart).filter(l => l.trim())
  if (bodyLines.length === 1 && bodyLines[0].includes(' → ')) {
    const parts = bodyLines[0].split(' → ')
    spec.items = parts.map(p => parseItem(p.trim()))
    return spec
  }

  // ── Hierarchical list parsing ──────────────────────────────────────────────
  // Stack-based: track indent depth
  const stack: Array<{ item: SmartArtItem; depth: number }> = []

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    // Section headers
    const lowerTrimmed = trimmed.toLowerCase()
    if (lowerTrimmed === 'nodes:') { inNodes = true; inEdges = false; continue }
    if (lowerTrimmed === 'edges:') { inEdges = true; inNodes = false; continue }

    // Nodes section
    if (inNodes) {
      if (trimmed.startsWith('- ')) {
        nodes.push(trimmed.slice(2).trim())
      }
      continue
    }

    // Edges section
    if (inEdges) {
      if (trimmed.startsWith('- ')) {
        const edgeStr = trimmed.slice(2).trim()
        const arrowIdx = edgeStr.indexOf(' → ')
        if (arrowIdx !== -1) {
          edges.push({ from: edgeStr.slice(0, arrowIdx).trim(), to: edgeStr.slice(arrowIdx + 3).trim() })
        }
      }
      continue
    }

    const depth = indentLevel(line)

    // Arrow chain line (can appear as a body line)
    if (trimmed.includes(' → ') && !trimmed.startsWith('→')) {
      const parts = trimmed.split(' → ')
      const items = parts.map(p => parseItem(p.trim()))
      spec.items.push(...items)
      stack.length = 0
      continue
    }

    // Flow child: → prefix
    // Flow children attach to the nearest parent at a strictly shallower depth.
    // They are NOT pushed onto the stack themselves (they don't own sub-items
    // in the normal containment sense; they're edges, not containers).
    if (trimmed.startsWith('→ ')) {
      const raw = trimmed.slice(2).trim()
      const item = parseItem(raw)
      // Find the nearest ancestor at a shallower depth
      let parentItem: SmartArtItem | null = null
      for (let si = stack.length - 1; si >= 0; si--) {
        if (stack[si].depth < depth) {
          parentItem = stack[si].item
          break
        }
      }
      if (parentItem) {
        parentItem.flowChildren.push(item)
      } else if (spec.items.length > 0) {
        spec.items[spec.items.length - 1].flowChildren.push(item)
      }
      // Do NOT push flow children onto the stack
      continue
    }

    // Prefix chars (SWOT): +, ?, ! are unambiguous (never used as list bullets).
    // '-' is ambiguous — it's both a list bullet AND a SWOT weakness marker.
    // We handle '-' in the regular list-item section below.
    const prefixMatch = trimmed.match(/^([+?!])\s+(.+)$/)
    if (prefixMatch) {
      const prefix = prefixMatch[1] as '+' | '?' | '!'
      const rest = prefixMatch[2]
      const item = parseItem(rest)
      item.prefix = prefix
      // Prefix items are flat — they don't nest in the stack
      spec.items.push(item)
      stack.length = 0
      continue
    }

    // Milestone: * prefix
    if (trimmed.startsWith('* ')) {
      const rest = trimmed.slice(2).trim()
      const item = parseItem(rest)
      item.isMilestone = true
      // Find correct parent from stack
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop()
      }
      if (stack.length === 0) {
        spec.items.push(item)
      } else {
        stack[stack.length - 1].item.children.push(item)
      }
      stack.push({ item, depth })
      continue
    }

    // Regular list item: - prefix
    // Special case: for swot type, top-level (depth 0) '-' items are SWOT weakness markers.
    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2).trim()
      if (spec.type === 'swot' && depth === 0) {
        // Treat as SWOT weakness prefix item (flat, no parent-child nesting)
        const item = parseItem(rest)
        item.prefix = '-'
        spec.items.push(item)
        stack.length = 0
        continue
      }
      const item = parseItem(rest)
      // Pop stack until we're at a shallower depth
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop()
      }
      if (stack.length === 0) {
        spec.items.push(item)
      } else {
        stack[stack.length - 1].item.children.push(item)
      }
      stack.push({ item, depth })
      continue
    }

    // Plain line (no prefix): treat as a flat item at current depth
    const item = parseItem(trimmed)
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop()
    }
    if (stack.length === 0) {
      spec.items.push(item)
    } else {
      stack[stack.length - 1].item.children.push(item)
    }
    stack.push({ item, depth })
  }

  if (nodes.length > 0) spec.nodes = nodes
  if (edges.length > 0) spec.edges = edges

  return spec
}
