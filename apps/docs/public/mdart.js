// src/parser.ts
function parseAttrs(segment) {
  let s = segment;
  const attrs = [];
  while (true) {
    const m = s.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
    if (!m) break;
    const inside = m[2].split(",").map((a) => a.trim()).filter(Boolean);
    attrs.unshift(...inside);
    s = m[1];
  }
  return { cleanLabel: s.trim(), attrs };
}
function parseLabelValue(raw) {
  const colonIdx = raw.indexOf(":");
  if (colonIdx === -1) return { label: raw.trim() };
  if (raw[colonIdx + 1] === "/" && raw[colonIdx + 2] === "/") return { label: raw.trim() };
  const label = raw.slice(0, colonIdx).trim();
  const value = raw.slice(colonIdx + 1).trim();
  return { label, value: value || void 0 };
}
function parseItem(rawLine) {
  const tailParsed = parseAttrs(rawLine);
  const { label: rawLabel, value } = parseLabelValue(tailParsed.cleanLabel);
  const labelParsed = parseAttrs(rawLabel);
  const label = labelParsed.cleanLabel;
  const attrs = [...labelParsed.attrs, ...tailParsed.attrs];
  return {
    label,
    value,
    attrs,
    children: [],
    flowChildren: [],
    // Intersection is signalled by ∩ (math) or && (typeable). Both work in any
    // venn renderer, e.g. `Marketing && Sales` ≡ `Marketing ∩ Sales`.
    isIntersection: /∩|&&/.test(label)
  };
}
function indentLevel(line) {
  let spaces = 0;
  for (const ch of line) {
    if (ch === " ") spaces++;
    else if (ch === "	") spaces += 2;
    else break;
  }
  return Math.floor(spaces / 2);
}
function parseMdArt(raw, hintType) {
  try {
    return _parseMdArt(raw, hintType);
  } catch {
    return {
      type: hintType ?? "process",
      items: [],
      raw
    };
  }
}
function _parseMdArt(raw, hintType) {
  const lines = raw.split("\n");
  const spec = {
    type: hintType ?? "",
    items: [],
    raw
  };
  let inNodes = false;
  let inEdges = false;
  const nodes = [];
  const edges = [];
  const bodyStartChars = /* @__PURE__ */ new Set(["-", "\u2192", "+", "?", "!", "*"]);
  const sectionHeaders = /* @__PURE__ */ new Set(["nodes:", "edges:"]);
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      bodyStart = i + 1;
      break;
    }
    if (bodyStartChars.has(trimmed[0]) || sectionHeaders.has(trimmed.toLowerCase())) {
      bodyStart = i;
      break;
    }
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (key === "type") spec.type = val;
      else if (key === "theme") spec.theme = val;
      else if (key === "mode") {
        const m = val.toLowerCase();
        if (m === "dark" || m === "light") spec.mode = m;
      } else if (key === "title") spec.title = val;
      else if (key === "direction") spec.direction = val;
      else if (key === "width") spec.width = parseInt(val, 10) || void 0;
      else if (["primary", "secondary", "accent", "muted", "bg", "surface", "border", "text", "textmuted", "danger", "warning"].includes(key)) {
        const camelKey = key === "textmuted" ? "textMuted" : key;
        if (!spec.colors) spec.colors = {};
        spec.colors[camelKey] = val;
      } else if (key === "palette") {
        if (!spec.colors) spec.colors = {};
        spec.colors["palette"] = val.split(",").map((c) => c.trim()).filter(Boolean);
      } else if (key === "columns") {
        spec.columns = val.split(",").map((c) => c.trim()).filter(Boolean);
      } else {
        bodyStart = i;
        break;
      }
      bodyStart = i + 1;
    } else {
      bodyStart = i;
      break;
    }
  }
  if (!spec.type && hintType) spec.type = hintType;
  if (!spec.type) spec.type = "process";
  const bodyLines = lines.slice(bodyStart).filter((l) => l.trim()).map((l) => l.replace(/ -> /g, " \u2192 "));
  if (bodyLines.length === 1 && bodyLines[0].includes(" \u2192 ")) {
    const chainLine = bodyLines[0].trim().replace(/^[-*]\s+/, "");
    const colonIdx = chainLine.indexOf(": ");
    const arrowIdx = chainLine.indexOf(" \u2192 ");
    const colonBeforeArrow = colonIdx !== -1 && colonIdx < arrowIdx;
    const moreColonsAfterArrow = colonBeforeArrow && chainLine.indexOf(": ", arrowIdx) !== -1;
    const isKeyValueOnly = colonBeforeArrow && !moreColonsAfterArrow;
    if (!isKeyValueOnly) {
      const parts = chainLine.split(" \u2192 ");
      spec.items = parts.map((p) => parseItem(p.trim()));
      return spec;
    }
  }
  const stack = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim().replace(/^->\s/, "\u2192 ").replace(/ -> /g, " \u2192 ");
    if (!trimmed) continue;
    const lowerTrimmed = trimmed.toLowerCase();
    if (lowerTrimmed === "nodes:") {
      inNodes = true;
      inEdges = false;
      continue;
    }
    if (lowerTrimmed === "edges:") {
      inEdges = true;
      inNodes = false;
      continue;
    }
    if (inNodes) {
      if (trimmed.startsWith("- ")) {
        nodes.push(trimmed.slice(2).trim());
      }
      continue;
    }
    if (inEdges) {
      if (trimmed.startsWith("- ")) {
        const edgeStr = trimmed.slice(2).trim();
        const arrowIdx = edgeStr.indexOf(" \u2192 ");
        if (arrowIdx !== -1) {
          edges.push({ from: edgeStr.slice(0, arrowIdx).trim(), to: edgeStr.slice(arrowIdx + 3).trim() });
        }
      }
      continue;
    }
    const depth = indentLevel(line);
    if (trimmed.includes(" \u2192 ") && !trimmed.startsWith("\u2192") && depth === 0) {
      const chainLine = trimmed.replace(/^[-*]\s+/, "");
      const colonIdx = chainLine.indexOf(": ");
      const arrowIdx = chainLine.indexOf(" \u2192 ");
      const colonBeforeArrow = colonIdx !== -1 && colonIdx < arrowIdx;
      const moreColonsAfterArrow = colonBeforeArrow && chainLine.indexOf(": ", arrowIdx) !== -1;
      const isKeyValueOnly = colonBeforeArrow && !moreColonsAfterArrow;
      if (!isKeyValueOnly) {
        const parts = chainLine.split(" \u2192 ");
        const items = parts.map((p) => parseItem(p.trim()));
        spec.items.push(...items);
        stack.length = 0;
        continue;
      }
    }
    if (trimmed.startsWith("\u2192 ")) {
      const raw2 = trimmed.slice(2).trim();
      const item2 = parseItem(raw2);
      let parentItem = null;
      for (let si = stack.length - 1; si >= 0; si--) {
        if (stack[si].depth < depth) {
          parentItem = stack[si].item;
          break;
        }
      }
      if (parentItem) {
        parentItem.flowChildren.push(item2);
        parentItem.children.push(item2);
      } else if (spec.items.length > 0) {
        spec.items[spec.items.length - 1].flowChildren.push(item2);
        spec.items[spec.items.length - 1].children.push(item2);
      }
      continue;
    }
    const prefixMatch = trimmed.match(/^([+?!])\s+(.+)$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const rest = prefixMatch[2];
      const item2 = parseItem(rest);
      item2.prefix = prefix;
      spec.items.push(item2);
      stack.length = 0;
      continue;
    }
    if (trimmed.startsWith("* ")) {
      const rest = trimmed.slice(2).trim();
      const item2 = parseItem(rest);
      item2.isMilestone = true;
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      if (stack.length === 0) {
        spec.items.push(item2);
      } else {
        stack[stack.length - 1].item.children.push(item2);
      }
      stack.push({ item: item2, depth });
      continue;
    }
    if (trimmed.startsWith("- ")) {
      const rest = trimmed.slice(2).trim();
      if ((spec.type === "swot" || spec.type === "pros-cons") && depth === 0) {
        const item3 = parseItem(rest);
        item3.prefix = "-";
        spec.items.push(item3);
        stack.length = 0;
        continue;
      }
      const item2 = parseItem(rest);
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      if (stack.length === 0) {
        spec.items.push(item2);
      } else {
        stack[stack.length - 1].item.children.push(item2);
        stack[stack.length - 1].item.flowChildren.push(item2);
      }
      stack.push({ item: item2, depth });
      continue;
    }
    const item = parseItem(trimmed);
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      spec.items.push(item);
    } else {
      stack[stack.length - 1].item.children.push(item);
    }
    stack.push({ item, depth });
  }
  if (nodes.length > 0) spec.nodes = nodes;
  if (edges.length > 0) spec.edges = edges;
  return spec;
}

// src/theme.ts
var SEM = { danger: "#f87171", warning: "#fbbf24", palette: ["#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6"] };
var SEM_LIGHT = { danger: "#dc2626", warning: "#d97706", palette: ["#d97706", "#db2777", "#0891b2", "#7c3aed"] };
var CATEGORY_THEMES = {
  list: { primary: "#06b6d4", secondary: "#0891b2", accent: "#22d3ee", muted: "#164e63", bg: "#080f18", surface: "#0a1a20", border: "#0e3040", text: "#e2e8f0", textMuted: "#67e8f9", ...SEM },
  process: { primary: "#10b981", secondary: "#059669", accent: "#34d399", muted: "#064e3b", bg: "#080f10", surface: "#0a1a14", border: "#0e3020", text: "#e2e8f0", textMuted: "#6ee7b7", ...SEM },
  cycle: { primary: "#8b5cf6", secondary: "#7c3aed", accent: "#a78bfa", muted: "#4c1d95", bg: "#0e0a1a", surface: "#130f20", border: "#2d1f50", text: "#e2e8f0", textMuted: "#c4b5fd", ...SEM },
  hierarchy: { primary: "#f59e0b", secondary: "#d97706", accent: "#fbbf24", muted: "#78350f", bg: "#14100a", surface: "#1a1408", border: "#3a2800", text: "#e2e8f0", textMuted: "#fde68a", ...SEM },
  relationship: { primary: "#f43f5e", secondary: "#e11d48", accent: "#fb7185", muted: "#9f1239", bg: "#180a0e", surface: "#1a0d12", border: "#3a1020", text: "#e2e8f0", textMuted: "#fda4af", ...SEM },
  matrix: { primary: "#3b82f6", secondary: "#2563eb", accent: "#60a5fa", muted: "#1e3a8a", bg: "#080f18", surface: "#0d1828", border: "#1e3050", text: "#e2e8f0", textMuted: "#93c5fd", ...SEM },
  pyramid: { primary: "#d97706", secondary: "#b45309", accent: "#fbbf24", muted: "#78350f", bg: "#100a04", surface: "#161008", border: "#3a2000", text: "#e2e8f0", textMuted: "#fcd34d", ...SEM },
  statistical: { primary: "#10b981", secondary: "#059669", accent: "#34d399", muted: "#064e3b", bg: "#080f10", surface: "#0a1a14", border: "#0e3020", text: "#e2e8f0", textMuted: "#6ee7b7", ...SEM },
  planning: { primary: "#a78bfa", secondary: "#8b5cf6", accent: "#c4b5fd", muted: "#4c1d95", bg: "#0e0a1a", surface: "#13101e", border: "#2d1f50", text: "#e2e8f0", textMuted: "#ddd6fe", ...SEM },
  technical: { primary: "#0ea5e9", secondary: "#0284c7", accent: "#38bdf8", muted: "#0c4a6e", bg: "#080f18", surface: "#091520", border: "#0e3050", text: "#e2e8f0", textMuted: "#7dd3fc", ...SEM }
};
var CATEGORY_THEMES_LIGHT = {
  list: { primary: "#0891b2", secondary: "#0e7490", accent: "#06b6d4", muted: "#cffafe", bg: "#f0fdff", surface: "#ffffff", border: "#a5f3fc", text: "#083344", textMuted: "#0e7490", ...SEM_LIGHT },
  process: { primary: "#059669", secondary: "#047857", accent: "#10b981", muted: "#d1fae5", bg: "#f0fdf4", surface: "#ffffff", border: "#bbf7d0", text: "#052e16", textMuted: "#059669", ...SEM_LIGHT },
  cycle: { primary: "#7c3aed", secondary: "#6d28d9", accent: "#8b5cf6", muted: "#ede9fe", bg: "#faf5ff", surface: "#ffffff", border: "#ddd6fe", text: "#2e1065", textMuted: "#6d28d9", ...SEM_LIGHT },
  hierarchy: { primary: "#d97706", secondary: "#b45309", accent: "#f59e0b", muted: "#fef3c7", bg: "#fffbeb", surface: "#ffffff", border: "#fde68a", text: "#451a03", textMuted: "#b45309", ...SEM_LIGHT },
  relationship: { primary: "#e11d48", secondary: "#be123c", accent: "#f43f5e", muted: "#ffe4e6", bg: "#fff1f2", surface: "#ffffff", border: "#fecdd3", text: "#4c0519", textMuted: "#be123c", ...SEM_LIGHT },
  matrix: { primary: "#2563eb", secondary: "#1d4ed8", accent: "#3b82f6", muted: "#dbeafe", bg: "#eff6ff", surface: "#ffffff", border: "#bfdbfe", text: "#172554", textMuted: "#1e40af", ...SEM_LIGHT },
  pyramid: { primary: "#b45309", secondary: "#92400e", accent: "#d97706", muted: "#ffedd5", bg: "#fff7ed", surface: "#ffffff", border: "#fed7aa", text: "#431407", textMuted: "#9a3412", ...SEM_LIGHT },
  statistical: { primary: "#059669", secondary: "#047857", accent: "#10b981", muted: "#d1fae5", bg: "#f0fdf4", surface: "#ffffff", border: "#bbf7d0", text: "#052e16", textMuted: "#059669", ...SEM_LIGHT },
  planning: { primary: "#8b5cf6", secondary: "#7c3aed", accent: "#a78bfa", muted: "#ede9fe", bg: "#f5f3ff", surface: "#ffffff", border: "#ddd6fe", text: "#2e1065", textMuted: "#7c3aed", ...SEM_LIGHT },
  technical: { primary: "#0284c7", secondary: "#0369a1", accent: "#0ea5e9", muted: "#e0f2fe", bg: "#f0f9ff", surface: "#ffffff", border: "#bae6fd", text: "#082f49", textMuted: "#0369a1", ...SEM_LIGHT }
};
var NAMED_THEMES = {
  // Neutral / monochromatic
  "mono-light": { primary: "#374151", secondary: "#1f2937", accent: "#6b7280", muted: "#d1d5db", bg: "#ffffff", surface: "#f9fafb", border: "#e5e7eb", text: "#111827", textMuted: "#6b7280", ...SEM_LIGHT },
  "mono-dark": { primary: "#9ca3af", secondary: "#6b7280", accent: "#d1d5db", muted: "#374151", bg: "#111827", surface: "#1f2937", border: "#374151", text: "#f9fafb", textMuted: "#9ca3af", ...SEM }
};
var THEME_ALIAS_TO_CATEGORY = {
  "cyan": "list",
  "emerald": "process",
  // also covers statistical
  "violet": "cycle",
  "lavender": "planning",
  "amber": "hierarchy",
  "orange": "pyramid",
  "rose": "relationship",
  "blue": "matrix",
  "sky": "technical"
};
var LAYOUT_CATEGORY = {
  // list
  "bullet-list": "list",
  "numbered-list": "list",
  "icon-list": "list",
  "two-column-list": "list",
  "checklist": "list",
  "timeline-list": "list",
  // process
  "process": "process",
  "chevron-process": "process",
  "arrow-process": "process",
  "circular-process": "process",
  "funnel": "process",
  "roadmap": "process",
  "swimlane": "process",
  "waterfall": "process",
  "snake-process": "process",
  // cycle
  "cycle": "cycle",
  "gear-cycle": "cycle",
  "donut-cycle": "cycle",
  "figure-eight": "cycle",
  "spiral": "cycle",
  "block-cycle": "cycle",
  "segmented-cycle": "cycle",
  "nondirectional-cycle": "cycle",
  "multidirectional-cycle": "cycle",
  "loop": "cycle",
  // hierarchy
  "org-chart": "hierarchy",
  "mind-map": "hierarchy",
  "tree": "hierarchy",
  "bracket": "hierarchy",
  "decision-tree": "hierarchy",
  "h-org-chart": "hierarchy",
  "hierarchy-list": "hierarchy",
  "radial-tree": "hierarchy",
  "sitemap": "hierarchy",
  "bracket-tree": "hierarchy",
  // relationship
  "venn": "relationship",
  "venn-3": "relationship",
  "venn-4": "relationship",
  "concentric": "relationship",
  "balance": "relationship",
  "counterbalance": "relationship",
  "opposing-arrows": "relationship",
  "web": "relationship",
  "cluster": "relationship",
  "target": "relationship",
  "radial": "relationship",
  "converging": "relationship",
  "diverging": "relationship",
  "plus": "relationship",
  // matrix
  "matrix-2x2": "matrix",
  "matrix-nxm": "matrix",
  "swot": "matrix",
  "bcg": "matrix",
  "ansoff": "matrix",
  "comparison": "matrix",
  "pros-cons": "matrix",
  // pyramid
  "pyramid": "pyramid",
  "inverted-pyramid": "pyramid",
  "pyramid-list": "pyramid",
  "segmented-pyramid": "pyramid",
  "diamond-pyramid": "pyramid",
  // statistical
  "treemap": "statistical",
  "sankey": "statistical",
  "bullet-chart": "statistical",
  "progress-list": "statistical",
  "scorecard": "statistical",
  "waffle": "statistical",
  "gauge": "statistical",
  "radar": "statistical",
  "heatmap": "statistical",
  // planning
  "kanban": "planning",
  "gantt": "planning",
  "gantt-lite": "planning",
  "sprint-board": "planning",
  "timeline": "planning",
  "milestone": "planning",
  "wbs": "planning",
  // technical
  "network": "technical",
  "layered-arch": "technical",
  "pipeline": "technical",
  "entity": "technical",
  "sequence": "technical",
  "state-machine": "technical",
  "class": "technical"
};
function getTheme(type, override, mode = "dark") {
  const pick = (category2) => (mode === "light" ? CATEGORY_THEMES_LIGHT[category2] : CATEGORY_THEMES[category2]) ?? CATEGORY_THEMES[category2];
  if (override) {
    if (NAMED_THEMES[override]) return NAMED_THEMES[override];
    if (CATEGORY_THEMES[override]) return pick(override);
    const aliasCategory = THEME_ALIAS_TO_CATEGORY[override];
    if (aliasCategory) return pick(aliasCategory);
  }
  const category = LAYOUT_CATEGORY[type] ?? "process";
  return pick(category);
}

// src/config.ts
var _config = {};
function configureMdArt(config) {
  _config = { ...config };
}
function resetMdArtConfig() {
  _config = {};
}
function getGlobalConfig() {
  return _config;
}

// src/layouts/shared.ts
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
function tt(s, max) {
  const tr = truncate(s, max);
  if (tr === s) return escapeXml(s);
  return `<title>${escapeXml(s)}</title>${escapeXml(tr)}`;
}
function getCaption(item, maxChildren = 3, sep = " \xB7 ") {
  if (item.value) return item.value;
  if (!item.children || item.children.length === 0) return null;
  return item.children.slice(0, maxChildren).map((c) => c.label).join(sep);
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function lerpColor(c1, c2, t) {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  return "#" + [lerp(r1, r2), lerp(g1, g2), lerp(b1, b2)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function renderEmpty(theme) {
  return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
    <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
  </svg>`;
}
function svgWrap(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function titleEl(W, title, theme) {
  return `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>`;
}
function renderStaircase(spec, theme, ascending) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 560;
  const GAP_X = 6, GAP_Y = 6;
  const BOX_W2 = Math.min(110, Math.floor((W - 16 - (n - 1) * GAP_X) / n));
  const BOX_H2 = 36;
  const titleH = spec.title ? 28 : 8;
  const totalDiagH = (n - 1) * (BOX_H2 + GAP_Y) + BOX_H2;
  const H = titleH + totalDiagH + 16;
  const startX = 8;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<defs><marker id="step-arr" markerWidth="5" markerHeight="5" refX="4.5" refY="2.5" orient="auto"><polygon points="0,0 5,2.5 0,5" fill="${theme.accent}"/></marker></defs>`);
  items.forEach((item, i) => {
    const x = startX + i * (BOX_W2 + GAP_X);
    const y = ascending ? titleH + 4 + (n - 1 - i) * (BOX_H2 + GAP_Y) : titleH + 4 + i * (BOX_H2 + GAP_Y);
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BOX_W2}" height="${BOX_H2}" rx="5" fill="${fill}33" stroke="${fill}" stroke-width="1.2"/>`);
    parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${(y + BOX_H2 / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, Math.floor(BOX_W2 / 6))}</text>`);
    const caption = getCaption(item);
    if (caption) parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${(y + BOX_H2 / 2 + 16).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(caption, Math.floor(BOX_W2 / 5))}</text>`);
    if (i < n - 1) {
      const nextY = ascending ? titleH + 4 + (n - 2 - i) * (BOX_H2 + GAP_Y) : titleH + 4 + (i + 1) * (BOX_H2 + GAP_Y);
      const x1 = x + BOX_W2;
      const y1 = ascending ? y : y + BOX_H2;
      const x2 = x + BOX_W2 + GAP_X;
      const y2 = ascending ? nextY + BOX_H2 : nextY;
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${theme.accent}cc" stroke-width="2.5" marker-end="url(#step-arr)"/>`);
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}

// src/layouts/process/process.ts
function wrapText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
function renderVerticalProcess(spec, theme) {
  const items = spec.items;
  const n = items.length;
  const W = 400;
  const ROW_H = 54;
  const PAD = 16;
  const NODE_W = 280;
  const ARROW_H = 16;
  const titleH = spec.title ? 30 : 0;
  const H = PAD + titleH + n * ROW_H + (n - 1) * ARROW_H + PAD;
  const nodeX = (W - NODE_W) / 2;
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const t = n > 1 ? i / (n - 1) : 0.5;
    const fill = lerpColor(theme.secondary, theme.primary, t);
    const y = PAD + titleH + i * (ROW_H + ARROW_H);
    const label = escapeXml(item.label);
    const cy = y + ROW_H / 2;
    svgContent += `<rect x="${nodeX}" y="${y}" width="${NODE_W}" height="${ROW_H}" rx="6" fill="${fill}" />`;
    svgContent += `<text x="${W / 2}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${label}</text>`;
    if (i < n - 1) {
      const ay = y + ROW_H + 2;
      svgContent += `<polygon points="${W / 2 - 8},${ay} ${W / 2 + 8},${ay} ${W / 2},${ay + ARROW_H - 2}" fill="${fill}" />`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}
function render(spec, theme) {
  const items = spec.items;
  if (items.length === 0) {
    return `<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="80" fill="${theme.bg}" rx="6"/>
      <text x="200" y="44" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
    </svg>`;
  }
  const n = items.length;
  const W = 700;
  const PAD = 20;
  const ARROW_W = 18;
  const nodeW = Math.min(130, Math.floor((W - PAD * 2 - ARROW_W * (n - 1)) / n));
  const nodeH = 60;
  const titleH = spec.title ? 30 : 0;
  const H = nodeH + PAD * 2 + titleH;
  if (n > 5) return renderVerticalProcess(spec, theme);
  const totalContentW = n * nodeW + (n - 1) * ARROW_W;
  const startX = (W - totalContentW) / 2;
  const cy = PAD + titleH + nodeH / 2;
  let svgContent = "";
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const x = startX + i * (nodeW + ARROW_W);
    const y = cy - nodeH / 2;
    const t = n > 1 ? i / (n - 1) : 0.5;
    const fill = lerpColor(theme.secondary, theme.primary, t);
    const label = escapeXml(item.label);
    const lines = wrapText(item.label, Math.floor(nodeW / 7));
    svgContent += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="6" fill="${fill}" />`;
    const hasValue = !!item.value;
    const textY = cy + (hasValue ? -6 : 4);
    if (lines.length === 1) {
      svgContent += `<text x="${x + nodeW / 2}" y="${textY}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${label}</text>`;
    } else {
      lines.forEach((line, li) => {
        const ly = textY + (li - (lines.length - 1) / 2) * 14;
        svgContent += `<text x="${x + nodeW / 2}" y="${ly}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`;
      });
    }
    if (hasValue) {
      svgContent += `<text x="${x + nodeW / 2}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`;
    }
    if (i < n - 1) {
      const ax = x + nodeW + 2;
      const ay = cy;
      svgContent += `<polygon points="${ax},${ay - 7} ${ax + ARROW_W - 2},${ay} ${ax},${ay + 7}" fill="${fill}" />`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${spec.title ? `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>` : ""}
    ${svgContent}
  </svg>`;
}

// src/layouts/process/chevron-process.ts
function wrapText2(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
function svgWrapProcess(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render2(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  if (n > 8) return render(spec, theme);
  const W = 600;
  const titleH = spec.title ? 28 : 8;
  const chevH = 54;
  const H = chevH + titleH + 28;
  const P = 20;
  const GAP = 4;
  const chevW = Math.floor((W - 20 - (n - 1) * GAP) / n);
  const startX = Math.floor((W - (n * chevW + (n - 1) * GAP)) / 2);
  const y = titleH + 10;
  const cy = y + chevH / 2;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  items.forEach((item, i) => {
    const x = startX + i * (chevW + GAP);
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const isFirst = i === 0;
    const isLast = i === n - 1;
    let pts;
    if (n === 1) {
      pts = `${x},${y} ${x + chevW},${y} ${x + chevW},${y + chevH} ${x},${y + chevH}`;
    } else if (isFirst) {
      pts = `${x},${y} ${x + chevW - P},${y} ${x + chevW},${cy} ${x + chevW - P},${y + chevH} ${x},${y + chevH}`;
    } else if (isLast) {
      pts = `${x},${y} ${x + chevW},${y} ${x + chevW},${y + chevH} ${x},${y + chevH} ${x + P},${cy}`;
    } else {
      pts = `${x},${y} ${x + chevW - P},${y} ${x + chevW},${cy} ${x + chevW - P},${y + chevH} ${x},${y + chevH} ${x + P},${cy}`;
    }
    parts.push(`<polygon points="${pts}" fill="${fill}ee" stroke="${theme.bg}" stroke-width="2.5"/>`);
    const bodyX = x + (isFirst ? 0 : P / 2);
    const bodyW = chevW - (isFirst ? P : 0) - (isLast ? 0 : P);
    const tx = bodyX + bodyW / 2;
    const hasValue = !!item.value;
    const lines = wrapText2(item.label, Math.max(4, Math.floor(bodyW / 7)));
    const labelLines = hasValue ? lines.slice(0, 1) : lines.slice(0, 2);
    if (hasValue) {
      parts.push(`<text x="${tx.toFixed(1)}" y="${cy - 3}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(labelLines[0])}</text>`);
      parts.push(`<text x="${tx.toFixed(1)}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="${theme.text}" fill-opacity="0.72" font-family="system-ui,sans-serif">${tt(item.value, Math.max(4, Math.floor(bodyW / 6)))}</text>`);
    } else {
      labelLines.forEach((line, li) => {
        const ty = labelLines.length === 1 ? cy + 4 : cy + (li === 0 ? -5 : 9);
        parts.push(`<text x="${tx.toFixed(1)}" y="${ty}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`);
      });
    }
  });
  return svgWrapProcess(W, H, theme, parts);
}

// src/layouts/process/arrow-process.ts
function wrapText3(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
function svgWrapProcess2(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render3(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  if (n > 6) return render(spec, theme);
  const W = 600;
  const titleH = spec.title ? 28 : 8;
  const ARROW_W = 38;
  const BOX_H2 = 70;
  const BOX_W2 = Math.min(116, Math.floor((W - 20 - (n - 1) * ARROW_W) / n));
  const H = BOX_H2 + titleH + 32;
  const totalW = n * BOX_W2 + (n - 1) * ARROW_W;
  const startX = (W - totalW) / 2;
  const bY = titleH + 14;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  items.forEach((item, i) => {
    const x = startX + i * (BOX_W2 + ARROW_W);
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${x.toFixed(1)}" y="${bY}" width="${BOX_W2}" height="${BOX_H2}" rx="7" fill="${fill}28" stroke="${fill}" stroke-width="2"/>`);
    const cy = bY + BOX_H2 / 2;
    const hasValue = !!item.value;
    const lines = wrapText3(item.label, Math.floor(BOX_W2 / 7));
    const labelLines = lines.slice(0, hasValue ? 2 : 3);
    const totalRows = labelLines.length + (hasValue ? 1 : 0);
    const rowH = 14;
    labelLines.forEach((line, li) => {
      const ty = cy + (li - (totalRows - 1) / 2) * rowH + 4;
      parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`);
    });
    if (hasValue) {
      const ty = cy + (labelLines.length - (totalRows - 1) / 2) * rowH + 4;
      parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.text}" fill-opacity="0.72" font-family="system-ui,sans-serif">${tt(item.value, Math.floor(BOX_W2 / 6))}</text>`);
    }
    if (i < n - 1) {
      const ax = x + BOX_W2 + 4;
      const arrowH = 30;
      const shaftH = Math.round(arrowH * 0.46);
      const headBase = ax + ARROW_W - 14;
      parts.push(`<polygon points="${ax},${(cy - shaftH).toFixed(1)} ${headBase},${(cy - shaftH).toFixed(1)} ${headBase},${(cy - arrowH).toFixed(1)} ${(ax + ARROW_W - 2).toFixed(1)},${cy.toFixed(1)} ${headBase},${(cy + arrowH).toFixed(1)} ${headBase},${(cy + shaftH).toFixed(1)} ${ax},${(cy + shaftH).toFixed(1)}" fill="${fill}99"/>`);
    }
  });
  return svgWrapProcess2(W, H, theme, parts);
}

// src/layouts/process/circular-process.ts
function wrapText4(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
function boxRadius(hw, hh, a) {
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  if (cos < 1e-9) return hh;
  if (sin < 1e-9) return hw;
  return Math.min(hw / cos, hh / sin);
}
function render4(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 500, H = 440;
  const titleH = spec.title ? 36 : 8;
  const cx = W / 2, cy = titleH + (H - titleH) / 2;
  const R = Math.min(160, (H - titleH - 48) / 2);
  const BOX_W2 = Math.min(104, Math.floor(2 * Math.PI * R / n * 0.7));
  const BOX_H2 = 36;
  const hw = BOX_W2 / 2, hh = BOX_H2 / 2;
  const GAP = 6;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<defs><marker id="cp-arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,1 L7,4 L0,7 Z" fill="${theme.accent}cc"/></marker></defs>`);
  for (let i = 0; i < n; i++) {
    const aFrom = 2 * Math.PI * i / n - Math.PI / 2;
    const aTo = 2 * Math.PI * ((i + 1) % n) / n - Math.PI / 2;
    const offFrom = (boxRadius(hw, hh, aFrom + Math.PI / 2) + GAP) / R;
    const offTo = (boxRadius(hw, hh, aTo + Math.PI / 2) + GAP) / R;
    const sa = aFrom + offFrom;
    const ea = aTo - offTo;
    const arcLen = (ea - sa + 4 * Math.PI) % (2 * Math.PI);
    if (arcLen < 0.05) continue;
    const x1 = cx + R * Math.cos(sa), y1 = cy + R * Math.sin(sa);
    const x2 = cx + R * Math.cos(ea), y2 = cy + R * Math.sin(ea);
    const largeArc = arcLen > Math.PI ? 1 : 0;
    parts.push(`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${largeArc},1 ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${theme.accent}55" stroke-width="2" marker-end="url(#cp-arr)"/>`);
  }
  items.forEach((item, i) => {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    const bx = cx + R * Math.cos(angle);
    const by = cy + R * Math.sin(angle);
    const t = n > 1 ? i / n : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const rx = (bx - hw).toFixed(1), ry = (by - hh).toFixed(1);
    parts.push(`<rect x="${rx}" y="${ry}" width="${BOX_W2}" height="${BOX_H2}" rx="7" fill="${fill}28" stroke="${fill}" stroke-width="1.8"/>`);
    const badgeX = (bx - hw + 5).toFixed(1);
    const badgeY = (by - hh + 9).toFixed(1);
    parts.push(`<text x="${badgeX}" y="${badgeY}" font-size="8" fill="${fill}" font-family="system-ui,sans-serif" font-weight="800" opacity="0.85">${i + 1}</text>`);
    const lines = wrapText4(item.label, Math.floor(BOX_W2 / 6.8));
    const lineH = 11;
    const totalH = lines.length * lineH;
    lines.slice(0, 2).forEach((line, li) => {
      const ty = (by - totalH / 2 + lineH * li + lineH * 0.8).toFixed(1);
      parts.push(`<text x="${bx.toFixed(1)}" y="${ty}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`);
    });
  });
  return svgWrap(W, H, theme, void 0, parts);
}

// src/layouts/process/funnel.ts
function parseNum(s) {
  const m = s.replace(/[,_\s]/g, "").match(/^-?\d+(\.\d+)?$/);
  return m ? parseFloat(m[0]) : null;
}
function deriveMetric(it) {
  if (it.value) return { num: parseNum(it.value), raw: it.value };
  if (it.children[0]) {
    const n = parseNum(it.children[0].label);
    if (n !== null) return { num: n, raw: it.children[0].label };
  }
  return { num: null, raw: null };
}
function fmtNum(n) {
  return Math.abs(n) >= 1e3 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
function render5(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 500;
  const STEP_H = 60;
  const PAD = 20;
  const titleH = spec.title ? 30 : 0;
  const H = titleH + PAD + n * STEP_H + PAD;
  const maxW = 440;
  const minW = 130;
  const metrics = items.map(deriveMetric);
  let svg30 = "";
  if (spec.title) {
    svg30 += `<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const t = i / (n - 1 || 1);
    const w = maxW - (maxW - minW) * t;
    const x = (W - w) / 2;
    const y = titleH + PAD + i * STEP_H;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const nextT = i < n - 1 ? (i + 1) / (n - 1 || 1) : t;
    const nextW = maxW - (maxW - minW) * nextT;
    const nextX = (W - nextW) / 2;
    const points = `${x},${y} ${x + w},${y} ${nextX + nextW},${y + STEP_H} ${nextX},${y + STEP_H}`;
    svg30 += `<polygon points="${points}" fill="${fill}"/>`;
    const m = metrics[i];
    const bandCx = W / 2;
    if (m.raw !== null) {
      svg30 += `<text x="${bandCx}" y="${y + 24}" text-anchor="middle" font-size="10" fill="#fff" fill-opacity="0.85" font-family="system-ui,sans-serif" font-weight="700" letter-spacing="0.08em">${escapeXml(item.label.toUpperCase())}</text>`;
      const metricText = m.num !== null ? fmtNum(m.num) : m.raw;
      svg30 += `<text x="${bandCx}" y="${y + 46}" text-anchor="middle" font-size="19" fill="#fff" font-family="system-ui,sans-serif" font-weight="800" letter-spacing="0.02em">${escapeXml(metricText)}</text>`;
    } else {
      svg30 += `<text x="${bandCx}" y="${y + STEP_H / 2 + 5}" text-anchor="middle" font-size="13" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(item.label)}</text>`;
    }
    if (i > 0) {
      const prev = metrics[i - 1];
      if (prev.num !== null && m.num !== null && prev.num > 0) {
        const pct = m.num / prev.num * 100;
        const pctText = pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
        const dropText = `\u2193 ${pctText}`;
        svg30 += `<text x="${W - 8}" y="${(y + STEP_H / 2 + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="700">${dropText}</text>`;
      }
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svg30}
  </svg>`;
}

// src/layouts/process/roadmap.ts
function wrapText5(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
function render6(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = Math.max(500, n * 100 + 80);
  const H = 140;
  const LINE_Y = 80;
  const DOT_R = 8;
  const PAD = 50;
  const spacing = (W - PAD * 2) / (n - 1 || 1);
  let svgContent = "";
  svgContent += `<line x1="${PAD}" y1="${LINE_Y}" x2="${W - PAD}" y2="${LINE_Y}" stroke="${theme.border}" stroke-width="3" />`;
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const x = PAD + i * spacing;
    const t = n > 1 ? i / (n - 1) : 0.5;
    const fill = lerpColor(theme.secondary, theme.primary, t);
    const above = i % 2 === 0;
    const labelY = above ? LINE_Y - 22 : LINE_Y + 36;
    svgContent += `<circle cx="${x}" cy="${LINE_Y}" r="${DOT_R}" fill="${fill}" />`;
    svgContent += `<circle cx="${x}" cy="${LINE_Y}" r="${DOT_R - 3}" fill="${theme.bg}" />`;
    const lineEndY = above ? LINE_Y - 14 : LINE_Y + 14;
    svgContent += `<line x1="${x}" y1="${LINE_Y}" x2="${x}" y2="${lineEndY}" stroke="${fill}" stroke-width="1.5" stroke-dasharray="3,2" />`;
    const lines = wrapText5(item.label, 12);
    lines.forEach((line, li) => {
      const ly = labelY + li * 13;
      svgContent += `<text x="${x}" y="${ly}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`;
    });
    if (item.value) {
      svgContent += `<text x="${x}" y="${labelY + lines.length * 13}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${spec.title ? `<text x="${W / 2}" y="16" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(spec.title)}</text>` : ""}
    ${svgContent}
  </svg>`;
}

// src/layouts/process/waterfall.ts
function wrapText6(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
function svgWrapProcess3(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render7(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const BOX_H2 = 40;
  const STEP_Y = 24;
  const titleH = spec.title ? 28 : 8;
  const BOX_W2 = Math.min(110, Math.floor((520 - (n - 1) * 8) / Math.max(n, 1)));
  const STEP_X = BOX_W2 + 8;
  const totalH = STEP_Y * (n - 1) + BOX_H2;
  const diagW = (n - 1) * STEP_X + BOX_W2 + 40;
  const W = Math.max(560, diagW);
  const H = totalH + titleH + 36;
  const startX = (W - (STEP_X * (n - 1) + BOX_W2)) / 2;
  const startY = titleH + 14;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  for (let i = 0; i < n - 1; i++) {
    const x1 = startX + i * STEP_X + BOX_W2;
    const y1 = startY + i * STEP_Y + BOX_H2 / 2;
    const x2 = startX + (i + 1) * STEP_X;
    const y2 = startY + (i + 1) * STEP_Y + BOX_H2 / 2;
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x1 + 4).toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${fill}99" stroke-width="1.5"/>`);
    parts.push(`<line x1="${(x1 + 4).toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x1 + 4).toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${fill}55" stroke-width="1.5" stroke-dasharray="3,3"/>`);
    parts.push(`<line x1="${(x1 + 4).toFixed(1)}" y1="${y2.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${fill}99" stroke-width="1.5"/>`);
  }
  items.forEach((item, i) => {
    const x = startX + i * STEP_X;
    const y = startY + i * STEP_Y;
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BOX_W2}" height="${BOX_H2}" rx="5" fill="${fill}33" stroke="${fill}" stroke-width="1.5"/>`);
    const lines = wrapText6(item.label, Math.floor(BOX_W2 / 7));
    const cy = y + BOX_H2 / 2;
    lines.slice(0, 2).forEach((line, li) => {
      const ty = lines.length === 1 ? cy + 4 : cy + (li === 0 ? -5 : 8);
      parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(line)}</text>`);
    });
  });
  return svgWrapProcess3(W, H, theme, parts);
}

// src/layouts/process/bending-process.ts
function svgWrapProcess4(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render8(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const COLS = Math.ceil(Math.sqrt(n * 1.5));
  const TURN_EXT = 32;
  const BASE_W = 560;
  const W = BASE_W + TURN_EXT * 2;
  const anyValue = items.some((it) => !!it.value);
  const BOX_W2 = (BASE_W - 16) / COLS - 6, BOX_H2 = anyValue ? 44 : 36, ROW_GAP = 24;
  const rows = Math.ceil(n / COLS);
  const titleH = spec.title ? 28 : 8;
  const H = titleH + rows * (BOX_H2 + ROW_GAP) + 8;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<defs>
    <marker id="bp-r" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><polygon points="0,0 8,4 0,8" fill="${theme.accent}"/></marker>
  </defs>`);
  const positions = items.map((_, i) => {
    const row = Math.floor(i / COLS);
    const col = row % 2 === 0 ? i % COLS : COLS - 1 - i % COLS;
    const x = TURN_EXT + 8 + col * (BOX_W2 + 6);
    const y = titleH + 4 + row * (BOX_H2 + ROW_GAP);
    return { x, y };
  });
  items.forEach((item, i) => {
    const { x, y } = positions[i];
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const isLast = i === n - 1;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BOX_W2.toFixed(1)}" height="${BOX_H2}" rx="5" fill="${isLast ? theme.accent + "33" : fill + "33"}" stroke="${isLast ? theme.accent : fill}" stroke-width="1.2"/>`);
    if (item.value) {
      parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${(y + 17).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, Math.floor(BOX_W2 / 6))}</text>`);
      parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${(y + 32).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.value, Math.floor(BOX_W2 / 5))}</text>`);
    } else {
      parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${(y + BOX_H2 / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, Math.floor(BOX_W2 / 6))}</text>`);
    }
    if (i < n - 1) {
      const next = positions[i + 1];
      const sameRow = Math.floor(i / COLS) === Math.floor((i + 1) / COLS);
      if (sameRow) {
        const row = Math.floor(i / COLS);
        const goRight = row % 2 === 0;
        const x1 = goRight ? x + BOX_W2 + 1 : x - 1;
        const x2 = goRight ? next.x - 1 : next.x + BOX_W2 + 1;
        parts.push(`<line x1="${x1.toFixed(1)}" y1="${(y + BOX_H2 / 2).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y + BOX_H2 / 2).toFixed(1)}" stroke="${theme.accent}99" stroke-width="1.5" marker-end="url(#bp-r)"/>`);
      } else {
        const row = Math.floor(i / COLS);
        const goRight = row % 2 === 0;
        const xPivot = x + (goRight ? BOX_W2 : 0);
        const yMid1 = y + BOX_H2 / 2;
        const yMid2 = next.y + BOX_H2 / 2;
        const ext = Math.round(TURN_EXT * 0.5);
        const r = Math.round(ROW_GAP / 3);
        const d = goRight ? 1 : -1;
        const sw = goRight ? 1 : 0;
        const xA = xPivot + d * ext;
        const xB = xPivot + d * (ext + r);
        const path = [
          `M${xPivot},${yMid1.toFixed(1)}`,
          `H${xA}`,
          `A${r},${r} 0 0,${sw} ${xB},${(yMid1 + r).toFixed(1)}`,
          `V${(yMid2 - r).toFixed(1)}`,
          `A${r},${r} 0 0,${sw} ${xA},${yMid2.toFixed(1)}`,
          `H${xPivot}`
        ].join(" ");
        parts.push(`<path d="${path}" fill="none" stroke="${theme.accent}88" stroke-width="2" marker-end="url(#bp-r)"/>`);
      }
    }
  });
  return svgWrapProcess4(W, H, theme, parts);
}

// src/layouts/process/snake-process.ts
function render9(spec, theme) {
  return render8(spec, theme);
}

// src/layouts/process/step-down.ts
function render10(spec, theme) {
  return renderStaircase(spec, theme, false);
}

// src/layouts/process/step-up.ts
function render11(spec, theme) {
  return renderStaircase(spec, theme, true);
}

// src/layouts/process/circle-process.ts
function svgWrapProcess5(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render12(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 560;
  const R = Math.min(40, (W - 16) / n / 2 - 10);
  const titleH = spec.title ? 28 : 8;
  const H = titleH + R * 2 + 20;
  const spacing = (W - 16) / n;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<defs><marker id="cp-arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><polygon points="0,0 7,3.5 0,7" fill="${theme.muted}"/></marker></defs>`);
  items.forEach((item, i) => {
    const cx = 16 + i * spacing + spacing / 2;
    const cy = titleH + R + 6;
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R}" fill="${fill}33" stroke="${fill}" stroke-width="1.5"/>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - (item.value ? 5 : 0)).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, Math.floor(R / 4))}</text>`);
    if (item.value) parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 10).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.value, Math.floor(R / 3.5))}</text>`);
    if (i < n - 1) {
      const x1 = cx + R + 2, x2 = cx + spacing - R - 6;
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${theme.muted}" stroke-width="1.5" marker-end="url(#cp-arr)"/>`);
    }
  });
  return svgWrapProcess5(W, H, theme, parts);
}

// src/layouts/process/equation.ts
function svgWrapProcess6(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render13(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 560;
  const CARD_H = 100, CARD_W = Math.min(110, (W - 16 - 24 * (n - 1)) / n);
  const titleH = spec.title ? 28 : 8;
  const H = titleH + CARD_H + 16;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  const opW = 24;
  const total = n * CARD_W + (n - 1) * opW;
  const startX = (W - total) / 2;
  const cardY = titleH + 8;
  items.forEach((item, i) => {
    const x = startX + i * (CARD_W + opW);
    const isResult = i === n - 1;
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = isResult ? theme.accent : lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${x.toFixed(1)}" y="${cardY.toFixed(1)}" width="${CARD_W.toFixed(1)}" height="${CARD_H}" rx="7" fill="${fill}22" stroke="${fill}88" stroke-width="1.5"/>`);
    parts.push(`<rect x="${x.toFixed(1)}" y="${cardY.toFixed(1)}" width="${CARD_W.toFixed(1)}" height="22" rx="7" fill="${fill}"/>`);
    parts.push(`<rect x="${x.toFixed(1)}" y="${(cardY + 14).toFixed(1)}" width="${CARD_W.toFixed(1)}" height="8" fill="${fill}"/>`);
    parts.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(cardY + 14).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, 14)}</text>`);
    const subs = item.children.length ? item.children.map((c) => c.label) : item.value ? [item.value] : [];
    const visible = subs.slice(0, 4);
    const bodyCy = cardY + 22 + (CARD_H - 22) / 2;
    const rowH = 16;
    visible.forEach((s, si) => {
      const ty = bodyCy + (si - (visible.length - 1) / 2) * rowH + 4;
      parts.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(s, 14)}</text>`);
    });
    if (i < n - 1) {
      const op = i === n - 2 ? "=" : "+";
      const opX = x + CARD_W + opW / 2;
      parts.push(`<text x="${opX.toFixed(1)}" y="${(cardY + CARD_H / 2 + 8).toFixed(1)}" text-anchor="middle" font-size="20" fill="${theme.muted}" font-family="system-ui,sans-serif" font-weight="300">${op}</text>`);
    }
  });
  return svgWrapProcess6(W, H, theme, parts);
}

// src/layouts/process/segmented-bar.ts
function svgWrapProcess7(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render14(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 560, BAR_H = 32, LABEL_H = 22;
  const titleH = spec.title ? 28 : 8;
  const H = titleH + BAR_H + LABEL_H + 20;
  const BAR_Y = titleH + 12, PAD = 8;
  const BAR_W = W - PAD * 2;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  const weights = items.map((it) => parseFloat(it.value ?? "") || 1);
  const total = weights.reduce((s, w) => s + w, 0);
  const segPath = (x, y, w, h, rl, rr) => [
    `M${(x + rl).toFixed(1)},${y}`,
    `H${(x + w - rr).toFixed(1)}`,
    rr ? `A${rr},${rr} 0 0,1 ${(x + w).toFixed(1)},${(y + rr).toFixed(1)}` : "",
    `V${(y + h - rr).toFixed(1)}`,
    rr ? `A${rr},${rr} 0 0,1 ${(x + w - rr).toFixed(1)},${(y + h).toFixed(1)}` : "",
    `H${(x + rl).toFixed(1)}`,
    rl ? `A${rl},${rl} 0 0,1 ${x},${(y + h - rl).toFixed(1)}` : "",
    `V${(y + rl).toFixed(1)}`,
    rl ? `A${rl},${rl} 0 0,1 ${(x + rl).toFixed(1)},${y}` : "",
    "Z"
  ].filter(Boolean).join(" ");
  let curX = PAD;
  items.forEach((item, i) => {
    const segW = weights[i] / total * BAR_W;
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const isFirst = i === 0, isLast = i === items.length - 1;
    const rl = isFirst ? 5 : 0, rr = isLast ? 5 : 0;
    parts.push(`<path d="${segPath(curX, BAR_Y, segW, BAR_H, rl, rr)}" fill="${fill}"/>`);
    const lx = curX + segW / 2;
    parts.push(`<text x="${lx.toFixed(1)}" y="${(BAR_Y + BAR_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, Math.floor(segW / 7))}</text>`);
    parts.push(`<text x="${lx.toFixed(1)}" y="${(BAR_Y + BAR_H + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${fill}" font-family="system-ui,sans-serif">${item.value ?? Math.round(weights[i] / total * 100) + "%"}</text>`);
    curX += segW;
  });
  return svgWrapProcess7(W, H, theme, parts);
}

// src/layouts/process/phase-process.ts
function svgWrapProcess8(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render15(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = Math.min(items.length, 4);
  const W = 560, GAP = 6, HEADER_H = 24, ROW_H = 20;
  const maxChildren = Math.max(...items.slice(0, n).map((it) => it.children.length), 2);
  const COL_H = HEADER_H + maxChildren * ROW_H + 12;
  const COL_W = (W - (n - 1) * GAP) / n;
  const titleH = spec.title ? 28 : 8;
  const H = titleH + COL_H + 8;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  items.slice(0, n).forEach((item, i) => {
    const x = i * (COL_W + GAP), y = titleH;
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${COL_W.toFixed(1)}" height="${COL_H}" rx="6" fill="${theme.surface}" stroke="${fill}55" stroke-width="1"/>`);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${COL_W.toFixed(1)}" height="${HEADER_H}" rx="6" fill="${fill}"/>`);
    parts.push(`<rect x="${x.toFixed(1)}" y="${(y + HEADER_H - 6).toFixed(1)}" width="${COL_W.toFixed(1)}" height="6" fill="${fill}"/>`);
    parts.push(`<text x="${(x + COL_W / 2).toFixed(1)}" y="${(y + HEADER_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, Math.floor(COL_W / 6))}</text>`);
    item.children.slice(0, maxChildren).forEach((child, ci) => {
      const ry = y + HEADER_H + ci * ROW_H + 6;
      parts.push(`<rect x="${(x + 4).toFixed(1)}" y="${ry.toFixed(1)}" width="${(COL_W - 8).toFixed(1)}" height="${ROW_H - 2}" rx="3" fill="${fill}22"/>`);
      parts.push(`<text x="${(x + COL_W / 2).toFixed(1)}" y="${(ry + ROW_H / 2 + 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(child.label, Math.floor(COL_W / 5.5))}</text>`);
    });
  });
  return svgWrapProcess8(W, H, theme, parts);
}

// src/layouts/process/timeline-h.ts
function wrapText7(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
function svgWrapProcess9(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render16(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 600;
  const PAD = 34;
  const spacing = (W - PAD * 2) / Math.max(n - 1, 1);
  const maxChars = Math.max(8, Math.floor(spacing / 5.2) - 1);
  const titleH = spec.title ? 30 : 8;
  const sideH = 60;
  const SPINE_Y = titleH + sideH;
  const H = titleH + sideH * 2;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<line x1="${PAD}" y1="${SPINE_Y}" x2="${W - PAD}" y2="${SPINE_Y}" stroke="${theme.border}" stroke-width="2"/>`);
  parts.push(`<polygon points="${(W - PAD - 2).toFixed(1)},${(SPINE_Y - 5).toFixed(1)} ${(W - PAD + 6).toFixed(1)},${SPINE_Y} ${(W - PAD - 2).toFixed(1)},${(SPINE_Y + 5).toFixed(1)}" fill="${theme.border}"/>`);
  items.forEach((item, i) => {
    const x = n === 1 ? W / 2 : PAD + i * spacing;
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = i === n - 1 ? theme.accent : lerpColor(theme.primary, theme.secondary, t);
    const above = i % 2 === 0;
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${SPINE_Y}" r="6" fill="${fill}"/>`);
    const tickStart = above ? SPINE_Y - 6 : SPINE_Y + 6;
    const tickEnd = above ? SPINE_Y - 18 : SPINE_Y + 18;
    parts.push(`<line x1="${x.toFixed(1)}" y1="${tickStart}" x2="${x.toFixed(1)}" y2="${tickEnd}" stroke="${fill}" stroke-width="1"/>`);
    const valueLines = item.value ? wrapText7(item.value, maxChars).slice(0, 2) : [];
    if (above) {
      const labelY = tickEnd - 4;
      parts.push(`<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="10" fill="${fill}" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, maxChars)}</text>`);
      const L = valueLines.length;
      valueLines.forEach((line, j) => {
        const vy = labelY - 11 - (L - 1 - j) * 10;
        parts.push(`<text x="${x.toFixed(1)}" y="${vy.toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(line, maxChars)}</text>`);
      });
    } else {
      const labelY = tickEnd + 12;
      parts.push(`<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="10" fill="${fill}" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, maxChars)}</text>`);
      valueLines.forEach((line, j) => {
        const vy = labelY + 11 + j * 10;
        parts.push(`<text x="${x.toFixed(1)}" y="${vy.toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(line, maxChars)}</text>`);
      });
    }
  });
  return svgWrapProcess9(W, H, theme, parts);
}

// src/layouts/process/timeline-v.ts
function svgWrapProcess10(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render17(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 560, ROW_H = 48, SPINE_X = 72, DOT_R = 7;
  const titleH = spec.title ? 28 : 8;
  const H = titleH + n * ROW_H + 8;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<line x1="${SPINE_X}" y1="${titleH + DOT_R}" x2="${SPINE_X}" y2="${titleH + (n - 1) * ROW_H + ROW_H / 2}" stroke="${theme.border}" stroke-width="2"/>`);
  parts.push(`<polygon points="${(SPINE_X - 5).toFixed(1)},${(titleH + (n - 1) * ROW_H + ROW_H / 2 - 2).toFixed(1)} ${(SPINE_X + 5).toFixed(1)},${(titleH + (n - 1) * ROW_H + ROW_H / 2 - 2).toFixed(1)} ${SPINE_X},${(titleH + (n - 1) * ROW_H + ROW_H / 2 + 6).toFixed(1)}" fill="${theme.border}"/>`);
  items.forEach((item, i) => {
    const cy = titleH + i * ROW_H + ROW_H / 2;
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = i === n - 1 ? theme.accent : lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<circle cx="${SPINE_X}" cy="${cy.toFixed(1)}" r="${DOT_R}" fill="${fill}"/>`);
    if (item.value) parts.push(`<text x="${(SPINE_X - DOT_R - 4).toFixed(1)}" y="${(cy + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`);
    parts.push(`<text x="${(SPINE_X + DOT_R + 8).toFixed(1)}" y="${(cy - 4).toFixed(1)}" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 36)}</text>`);
    const detail = item.children.map((c) => c.label).join(" \xB7 ");
    if (detail) parts.push(`<text x="${(SPINE_X + DOT_R + 8).toFixed(1)}" y="${(cy + 11).toFixed(1)}" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(detail, 48)}</text>`);
  });
  return svgWrapProcess10(W, H, theme, parts);
}

// src/layouts/process/swimlane.ts
function svgWrapProcess11(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render18(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 560;
  const LABEL_W = 56, LANE_H = 44, GAP = 1;
  const titleH = spec.title ? 28 : 8;
  const H = titleH + items.length * (LANE_H + GAP) + 8;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<defs><marker id="sl-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="${theme.muted}"/></marker></defs>`);
  items.forEach((item, i) => {
    const y = titleH + i * (LANE_H + GAP);
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${LANE_H}" fill="${fill}0a"/>`);
    if (i > 0) parts.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="${theme.border}" stroke-width="0.5"/>`);
    parts.push(`<rect x="2" y="${(y + 2).toFixed(1)}" width="${LABEL_W - 4}" height="${LANE_H - 4}" rx="4" fill="${fill}33" stroke="${fill}66" stroke-width="1"/>`);
    parts.push(`<text x="${(LABEL_W / 2).toFixed(1)}" y="${(y + LANE_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, 9)}</text>`);
    const steps = item.children;
    const stepW = steps.length > 0 ? Math.min(90, (W - LABEL_W - 8) / steps.length - 6) : 0;
    const stepGap = steps.length > 1 ? (W - LABEL_W - 8 - steps.length * stepW) / (steps.length - 1) : 0;
    steps.forEach((step, si) => {
      const sx = LABEL_W + 4 + si * (stepW + stepGap);
      const sy = y + (LANE_H - 28) / 2;
      const isDone2 = step.attrs.includes("done");
      const stepFill = isDone2 ? theme.accent : fill;
      parts.push(`<rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${stepW.toFixed(1)}" height="28" rx="4" fill="${stepFill}${isDone2 ? "44" : "22"}" stroke="${stepFill}${isDone2 ? "99" : "66"}" stroke-width="1"/>`);
      parts.push(`<text x="${(sx + stepW / 2).toFixed(1)}" y="${(sy + 17).toFixed(1)}" text-anchor="middle" font-size="9" fill="${isDone2 ? theme.text : theme.textMuted}" font-family="system-ui,sans-serif" font-weight="${isDone2 ? "600" : "400"}">${tt(step.label, Math.floor(stepW / 5))}</text>`);
      if (si < steps.length - 1) {
        const ax1 = sx + stepW + 2, ax2 = sx + stepW + stepGap - 4;
        parts.push(`<line x1="${ax1.toFixed(1)}" y1="${(sy + 14).toFixed(1)}" x2="${ax2.toFixed(1)}" y2="${(sy + 14).toFixed(1)}" stroke="${theme.muted}" stroke-width="1" marker-end="url(#sl-arr)"/>`);
      }
    });
  });
  return svgWrapProcess11(W, H, theme, parts);
}

// src/layouts/list/bullet-list.ts
function render19(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 460;
  const PAD = 16;
  const titleH = spec.title ? 28 : 0;
  const firstChildGap = (hasValue) => hasValue ? 20 : 26;
  const heights = items.map((item) => {
    const hasValue = !!item.value;
    const nCh = item.children.length;
    const topBL = hasValue ? 38 : 22;
    const lastBL = nCh > 0 ? topBL + firstChildGap(hasValue) + (nCh - 1) * 17 : topBL;
    return lastBL + 10;
  });
  const H = PAD + titleH + heights.reduce((s, h) => s + h, 0) + PAD;
  const mainMarkerX = PAD + 8;
  const mainTextStart = PAD + 22;
  const subMarkerX = PAD + 28;
  const subTextStart = PAD + 38;
  const mainLabelMax = Math.floor((W - PAD - mainTextStart - 4) / 5.8);
  const valueMax = Math.floor((W - PAD - mainTextStart - 4) / 5);
  const childLabelMax = Math.floor((W - PAD - subTextStart - 4) / 5.3);
  let svg30 = "";
  if (spec.title) {
    svg30 += `<text x="${PAD}" y="${PAD + 16}" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  let y = PAD + titleH;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemH = heights[i];
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.secondary, theme.primary, t);
    const labelBL = y + 22;
    const markerCy = labelBL - 4;
    svg30 += `<circle cx="${mainMarkerX}" cy="${markerCy}" r="5" fill="${fill}" />`;
    svg30 += `<text x="${mainTextStart}" y="${labelBL}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, mainLabelMax)}</text>`;
    let anchorBL = labelBL;
    if (item.value) {
      const valueBL = y + 38;
      svg30 += `<text x="${mainTextStart}" y="${valueBL}" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-style="italic">${tt(item.value, valueMax)}</text>`;
      anchorBL = valueBL;
    }
    const gap = firstChildGap(!!item.value);
    item.children.forEach((child, j) => {
      const childBL = anchorBL + gap + j * 17;
      const childMarkerCy = childBL - 4;
      svg30 += `<circle cx="${subMarkerX}" cy="${childMarkerCy}" r="3" fill="${fill}" fill-opacity="0.7" />`;
      svg30 += `<text x="${subTextStart}" y="${childBL}" font-size="11" fill="${theme.text}" fill-opacity="0.85" font-family="system-ui,sans-serif">${tt(child.label, childLabelMax)}</text>`;
    });
    if (i < items.length - 1) {
      svg30 += `<line x1="${PAD}" y1="${y + itemH}" x2="${W - PAD}" y2="${y + itemH}" stroke="${theme.border}" stroke-width="0.5" />`;
    }
    y += itemH;
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svg30}
  </svg>`;
}

// src/layouts/list/numbered-list.ts
function render20(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 460;
  const PAD = 16;
  const titleH = spec.title ? 28 : 0;
  const firstChildGap = (hasValue) => hasValue ? 20 : 26;
  const heights = items.map((item) => {
    const hasValue = !!item.value;
    const nCh = item.children.length;
    const topBL = hasValue ? 38 : 22;
    const lastBL = nCh > 0 ? topBL + firstChildGap(hasValue) + (nCh - 1) * 17 : topBL;
    return lastBL + 10;
  });
  const H = PAD + titleH + heights.reduce((s, h) => s + h, 0) + PAD;
  const BADGE_W = 22, BADGE_H = 22;
  const SUB_W = 14, SUB_H = 14;
  const mainBadgeX = PAD;
  const mainTextStart = PAD + BADGE_W + 8;
  const subBadgeX = PAD + 16;
  const subTextStart = subBadgeX + SUB_W + 6;
  const mainLabelMax = Math.floor((W - PAD - mainTextStart - 4) / 5.8);
  const valueMax = Math.floor((W - PAD - mainTextStart - 4) / 5);
  const childLabelMax = Math.floor((W - PAD - subTextStart - 4) / 5.3);
  const subLetter = (j) => j < 26 ? String.fromCharCode(97 + j) : String(j + 1);
  let svg30 = "";
  if (spec.title) {
    svg30 += `<text x="${PAD}" y="${PAD + 16}" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  let y = PAD + titleH;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemH = heights[i];
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.secondary, theme.primary, t);
    const labelBL = y + 22;
    const badgeCy = labelBL - 4;
    svg30 += `<rect x="${mainBadgeX}" y="${badgeCy - BADGE_H / 2}" width="${BADGE_W}" height="${BADGE_H}" rx="4" fill="${fill}" />`;
    svg30 += `<text x="${mainBadgeX + BADGE_W / 2}" y="${badgeCy + 4}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${i + 1}</text>`;
    svg30 += `<text x="${mainTextStart}" y="${labelBL}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, mainLabelMax)}</text>`;
    let anchorBL = labelBL;
    if (item.value) {
      const valueBL = y + 38;
      svg30 += `<text x="${mainTextStart}" y="${valueBL}" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-style="italic">${tt(item.value, valueMax)}</text>`;
      anchorBL = valueBL;
    }
    const gap = firstChildGap(!!item.value);
    item.children.forEach((child, j) => {
      const childBL = anchorBL + gap + j * 17;
      const subCy = childBL - 4;
      svg30 += `<rect x="${subBadgeX}" y="${subCy - SUB_H / 2}" width="${SUB_W}" height="${SUB_H}" rx="3" fill="${fill}" fill-opacity="0.6" />`;
      svg30 += `<text x="${subBadgeX + SUB_W / 2}" y="${subCy + 3}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${subLetter(j)}</text>`;
      svg30 += `<text x="${subTextStart}" y="${childBL}" font-size="11" fill="${theme.text}" fill-opacity="0.85" font-family="system-ui,sans-serif">${tt(child.label, childLabelMax)}</text>`;
    });
    if (i < items.length - 1) {
      svg30 += `<line x1="${PAD}" y1="${y + itemH}" x2="${W - PAD}" y2="${y + itemH}" stroke="${theme.border}" stroke-width="0.5" />`;
    }
    y += itemH;
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svg30}
  </svg>`;
}

// src/layouts/list/checklist.ts
var DONE_ATTRS = ["done", "\u2713", "complete"];
var isDone = (it) => it.attrs.some((a) => DONE_ATTRS.includes(a));
function render21(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 480;
  const PAD = 16;
  const titleH = spec.title ? 28 : 0;
  const TOP_PAD = 8;
  const LABEL_BOTTOM = 23;
  const VALUE_STEP = 14;
  const GAP_BEFORE_SUBS = 8;
  const SUB_BOX = 12;
  const SUB_GAP = 4;
  const BOTTOM_PAD = 8;
  const ITEM_GAP = 6;
  const contentBottom = (item) => {
    let y = item.value ? LABEL_BOTTOM + VALUE_STEP : LABEL_BOTTOM;
    if (item.children.length > 0) {
      y += GAP_BEFORE_SUBS;
      y += SUB_BOX + (item.children.length - 1) * (SUB_BOX + SUB_GAP);
    }
    return y;
  };
  const itemHeights = items.map((it) => contentBottom(it) + BOTTOM_PAD);
  const totalContent = itemHeights.reduce((a, b) => a + b, 0) + ITEM_GAP * Math.max(0, items.length - 1);
  const H = PAD + titleH + totalContent + PAD;
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${PAD}" y="${PAD + 16}" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  let yCur = PAD + titleH;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemH = itemHeights[i];
    const done = isDone(item);
    const extraAttrs = item.attrs.filter((a) => !DONE_ATTRS.includes(a));
    const labelRight = W - PAD - (extraAttrs.length > 0 ? Math.min(200, 28 + extraAttrs.join(", ").length * 5.5) : 8);
    const labelMax = Math.max(12, Math.floor((labelRight - (PAD + 26)) / 4.8));
    const boxY = yCur + TOP_PAD;
    const labelY = yCur + 20;
    svgContent += `<rect x="${PAD}" y="${boxY}" width="18" height="18" rx="3" fill="none" stroke="${theme.primary}" stroke-width="1.5" />`;
    if (done) {
      const cy = boxY + 9;
      svgContent += `<polyline points="${PAD + 4},${cy} ${PAD + 8},${cy + 4} ${PAD + 14},${cy - 4}" fill="none" stroke="${theme.accent}" stroke-width="2" stroke-linecap="round" />`;
    }
    const labelStyle = done ? `fill="${theme.text}" fill-opacity="0.62" font-style="italic"` : `fill="${theme.text}"`;
    svgContent += `<text x="${PAD + 26}" y="${labelY}" font-size="12" font-family="system-ui,sans-serif" ${labelStyle}>${tt(item.label, labelMax)}</text>`;
    if (extraAttrs.length > 0) {
      svgContent += `<text x="${W - PAD}" y="${labelY}" text-anchor="end" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">[${extraAttrs.join(", ")}]</text>`;
    }
    const valueW = W - 2 * PAD - 26;
    const valueMax = Math.max(16, Math.floor(valueW / 4));
    let labelZoneBottom = yCur + LABEL_BOTTOM;
    if (item.value) {
      const vy = labelY + VALUE_STEP;
      svgContent += `<text x="${PAD + 26}" y="${vy}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.value, valueMax)}</text>`;
      labelZoneBottom = yCur + LABEL_BOTTOM + VALUE_STEP;
    }
    const subX = PAD + 32;
    let subTop = labelZoneBottom + GAP_BEFORE_SUBS;
    const cTextX = subX + SUB_BOX + 6;
    const subLabelMax = Math.max(12, Math.floor((W - PAD - cTextX) / 4.2));
    for (const child of item.children) {
      const childDone = done || isDone(child);
      const cy = subTop + SUB_BOX / 2;
      const cLabelY = subTop + 10;
      svgContent += `<rect x="${subX}" y="${subTop}" width="${SUB_BOX}" height="${SUB_BOX}" rx="2" fill="none" stroke="${theme.primary}" stroke-width="1.2" opacity="0.85" />`;
      if (childDone) {
        svgContent += `<polyline points="${subX + 3},${cy} ${subX + 6},${cy + 2.5} ${subX + 10},${cy - 3}" fill="none" stroke="${theme.accent}" stroke-width="1.5" stroke-linecap="round" />`;
      }
      const cStyle = childDone ? `fill="${theme.text}" fill-opacity="0.55" font-style="italic"` : `fill="${theme.text}" fill-opacity="0.85"`;
      svgContent += `<text x="${cTextX}" y="${cLabelY}" font-size="10.5" font-family="system-ui,sans-serif" ${cStyle}>${tt(child.label, subLabelMax)}</text>`;
      subTop += SUB_BOX + SUB_GAP;
    }
    if (i < items.length - 1) {
      const sepY = yCur + itemH + ITEM_GAP / 2;
      svgContent += `<line x1="${PAD}" y1="${sepY.toFixed(1)}" x2="${W - PAD}" y2="${sepY.toFixed(1)}" stroke="${theme.border}" stroke-width="0.5" />`;
    }
    yCur += itemH + ITEM_GAP;
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/list/two-column-list.ts
function render22(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);
  const maxRows = Math.max(left.length, right.length);
  const W = 500;
  const PAD = 16;
  const titleH = spec.title ? 28 : 0;
  const captions = items.map((it) => getCaption(it));
  const hasAnyCaption = captions.some((c) => c !== null);
  const ROW_H = hasAnyCaption ? 44 : 36;
  const H = PAD + titleH + maxRows * ROW_H + PAD;
  const textPx = (W - PAD * 2) / 2 - 22;
  const labelMax = Math.floor(textPx / 5.6);
  const valueMax = Math.floor(textPx / 5);
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  svgContent += `<line x1="${W / 2}" y1="${PAD + titleH}" x2="${W / 2}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="1" />`;
  const renderCol = (colItems, startX) => {
    for (let i = 0; i < colItems.length; i++) {
      const item = colItems[i];
      const cy = PAD + titleH + i * ROW_H + ROW_H / 2;
      const t = items.length > 1 ? items.indexOf(item) / (items.length - 1) : 0;
      const fill = lerpColor(theme.secondary, theme.primary, t);
      const caption = captions[items.indexOf(item)];
      if (caption) {
        const labelY = cy - 5;
        const valueY = cy + 10;
        svgContent += `<circle cx="${startX + 8}" cy="${labelY}" r="4" fill="${fill}" />`;
        svgContent += `<text x="${startX + 18}" y="${labelY + 4}" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, labelMax)}</text>`;
        svgContent += `<text x="${startX + 18}" y="${valueY + 4}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(caption, valueMax)}</text>`;
      } else {
        svgContent += `<circle cx="${startX + 8}" cy="${cy}" r="4" fill="${fill}" />`;
        svgContent += `<text x="${startX + 18}" y="${cy + 4}" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, labelMax)}</text>`;
      }
    }
  };
  renderCol(left, PAD);
  renderCol(right, W / 2 + PAD);
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/list/timeline-list.ts
function render23(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const CARD_H = 54;
  const PAD = 20;
  const LINE_X = W / 2;
  const CARD_W = 180;
  const ROW_H = CARD_H + 20;
  const titleH = spec.title ? 28 : 0;
  const H = PAD + titleH + items.length * ROW_H + PAD;
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  svgContent += `<line x1="${LINE_X}" y1="${PAD + titleH}" x2="${LINE_X}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="2" />`;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const cy = PAD + titleH + i * ROW_H + CARD_H / 2;
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.secondary, theme.primary, t);
    const left = i % 2 === 0;
    const cardX = left ? LINE_X - 14 - CARD_W : LINE_X + 14;
    const cardY = cy - CARD_H / 2;
    svgContent += `<rect x="${cardX}" y="${cardY}" width="${CARD_W}" height="${CARD_H}" rx="6" fill="${theme.surface}" stroke="${fill}" stroke-width="1.5" />`;
    svgContent += `<circle cx="${LINE_X}" cy="${cy}" r="7" fill="${fill}" />`;
    svgContent += `<text x="${cardX + CARD_W / 2}" y="${cy - 6}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(item.label)}</text>`;
    const caption = getCaption(item);
    if (caption) {
      svgContent += `<text x="${cardX + CARD_W / 2}" y="${cy + 10}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(caption)}</text>`;
    }
    if (item.attrs.length > 0) {
      svgContent += `<text x="${cardX + CARD_W / 2}" y="${cy + 22}" text-anchor="middle" font-size="9" fill="${theme.accent}" font-family="system-ui,sans-serif">${escapeXml(item.attrs.join(", "))}</text>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/list/block-list.ts
function svg(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render24(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const COLS = 2;
  const GAP = 8;
  const CELL_W = (W - (COLS - 1) * GAP) / COLS;
  const CELL_H = 80;
  const labelMax = Math.max(8, Math.floor((CELL_W - 24) / 5));
  const valueMax = Math.max(10, Math.floor((CELL_W - 24) / 4.2));
  const childMax = Math.max(8, Math.floor((CELL_W - 30) / 4.4));
  const rows = Math.ceil(items.length / COLS);
  const titleH = spec.title ? 30 : 8;
  const H = titleH + rows * (CELL_H + GAP) + 8;
  const parts = [];
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  items.forEach((item, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = col * (CELL_W + GAP), y = titleH + row * (CELL_H + GAP);
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CELL_W.toFixed(1)}" height="${CELL_H}" rx="8" fill="${fill}33" stroke="${fill}88" stroke-width="1.5"/>`);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="6" height="${CELL_H}" rx="3" fill="${fill}"/>`);
    parts.push(`<text x="${(x + 16).toFixed(1)}" y="${(y + 22).toFixed(1)}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, labelMax)}</text>`);
    if (item.value) parts.push(`<text x="${(x + 16).toFixed(1)}" y="${(y + 38).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-style="italic" font-family="system-ui,sans-serif">${tt(item.value, valueMax)}</text>`);
    item.children.slice(0, 2).forEach((child, ci) => {
      const cy = y + (item.value ? 54 : 42) + ci * 14;
      const op = ci === 0 ? "1" : "0.7";
      parts.push(`<text x="${(x + 16).toFixed(1)}" y="${cy.toFixed(1)}" font-size="10" fill="${theme.textMuted}" fill-opacity="${op}" font-family="system-ui,sans-serif">\xB7 ${tt(child.label, childMax)}</text>`);
    });
  });
  return svg(W, H, theme, parts);
}

// src/layouts/list/chevron-list.ts
function svg2(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render25(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const ROW_H = 32, GAP = 4, NOTCH = 14;
  const titleH = spec.title ? 30 : 8;
  const H = titleH + items.length * (ROW_H + GAP) + 8;
  const parts = [];
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  items.forEach((item, i) => {
    const y = titleH + i * (ROW_H + GAP);
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const x0 = i === 0 ? 0 : NOTCH, x1 = W - NOTCH, mid = y + ROW_H / 2;
    const d = i === 0 ? `M0,${y} L${x1},${y} L${W},${mid} L${x1},${y + ROW_H} L0,${y + ROW_H} Z` : `M0,${y} L${x1},${y} L${W},${mid} L${x1},${y + ROW_H} L0,${y + ROW_H} L${NOTCH},${mid} Z`;
    parts.push(`<path d="${d}" fill="${fill}33" stroke="${fill}" stroke-width="1"/>`);
    const caption = getCaption(item);
    const rightRes = caption ? 96 : 0;
    const labelMax = Math.floor((W - NOTCH - rightRes - 16) / 6.2);
    parts.push(`<text x="${(x0 + x1) / 2 + NOTCH / 2}" y="${(mid + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, labelMax)}</text>`);
    if (caption) parts.push(`<text x="${W - NOTCH - 6}" y="${(mid + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(caption, 16)}</text>`);
  });
  return svg2(W, H, theme, parts);
}

// src/layouts/list/card-list.ts
function svg3(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render26(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const n = Math.min(items.length, 4);
  const GAP = 8;
  const HEADER_H = 32;
  const ROW_H = 20;
  const VALUE_H = 18;
  const slice = items.slice(0, n);
  const anyVal = slice.some((it) => it.value);
  const valueH = anyVal ? VALUE_H : 0;
  const maxChildren = Math.max(...slice.map((it) => it.children.length), 2);
  const CARD_H = HEADER_H + valueH + maxChildren * ROW_H + 16;
  const CARD_W = (W - (n - 1) * GAP) / n;
  const titleH = spec.title ? 30 : 8;
  const H = titleH + CARD_H + 8;
  const parts = [];
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  slice.forEach((item, i) => {
    const x = i * (CARD_W + GAP), y = titleH;
    const t = n > 1 ? i / (n - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CARD_W.toFixed(1)}" height="${CARD_H}" rx="7" fill="${theme.surface}" stroke="${fill}66" stroke-width="1.2"/>`);
    parts.push(`<path d="M${(x + 7).toFixed(1)},${y.toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${(y + 7).toFixed(1)} L${x.toFixed(1)},${(y + HEADER_H).toFixed(1)} L${(x + CARD_W).toFixed(1)},${(y + HEADER_H).toFixed(1)} L${(x + CARD_W).toFixed(1)},${(y + 7).toFixed(1)} Q${(x + CARD_W).toFixed(1)},${y.toFixed(1)} ${(x + CARD_W - 7).toFixed(1)},${y.toFixed(1)} Z" fill="${fill}"/>`);
    const innerW = Math.max(40, CARD_W - 12);
    const headerMax = Math.max(4, Math.floor(innerW / 5));
    const valueMax = Math.max(6, Math.floor(innerW / 4.2));
    const childMax = Math.max(4, Math.floor(innerW / 4.4));
    parts.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(y + HEADER_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, headerMax)}</text>`);
    if (anyVal && item.value) {
      const vy = y + HEADER_H + 13;
      parts.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${vy.toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" fill-opacity="0.85" font-family="system-ui,sans-serif" font-style="italic">${tt(item.value, valueMax)}</text>`);
    }
    const childStart = y + HEADER_H + valueH;
    item.children.slice(0, maxChildren).forEach((child, ci) => {
      const cy = childStart + ci * ROW_H + ROW_H;
      parts.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(child.label, childMax)}</text>`);
    });
  });
  return svg3(W, H, theme, parts);
}

// src/layouts/list/zigzag-list.ts
function svg4(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render27(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const ROW_H = 38, BOX_W2 = 190, BOX_H2 = 30;
  const SPINE_X = W / 2;
  const titleH = spec.title ? 30 : 8;
  const H = titleH + items.length * ROW_H + 10;
  const parts = [];
  parts.push(`<line x1="${SPINE_X}" y1="${titleH}" x2="${SPINE_X}" y2="${H - 8}" stroke="${theme.border}" stroke-width="2"/>`);
  if (spec.title) parts.push(`<text x="${SPINE_X}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  items.forEach((item, i) => {
    const cy = titleH + i * ROW_H + ROW_H / 2;
    const left = i % 2 === 0;
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const bx = left ? SPINE_X - 8 - BOX_W2 : SPINE_X + 8;
    parts.push(`<rect x="${bx.toFixed(1)}" y="${(cy - BOX_H2 / 2).toFixed(1)}" width="${BOX_W2}" height="${BOX_H2}" rx="6" fill="${fill}22" stroke="${fill}" stroke-width="1.2"/>`);
    parts.push(`<text x="${(bx + BOX_W2 / 2).toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 22)}</text>`);
    const caption = getCaption(item);
    if (caption) parts.push(`<text x="${(bx + BOX_W2 / 2).toFixed(1)}" y="${(cy + 16).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(caption, 26)}</text>`);
    parts.push(`<circle cx="${SPINE_X}" cy="${cy}" r="4" fill="${fill}"/>`);
    const lineX = left ? SPINE_X - 8 : SPINE_X + 8;
    parts.push(`<line x1="${SPINE_X}" y1="${cy}" x2="${lineX}" y2="${cy}" stroke="${fill}" stroke-width="1.2"/>`);
  });
  return svg4(W, H, theme, parts);
}

// src/layouts/list/ribbon-list.ts
function svg5(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render28(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const RIB_H = 26, GAP = 6, FOLD = 10, TAIL = 14;
  const ribLabelMax = Math.max(8, Math.floor((W - FOLD - TAIL - 20) / 5.5));
  const captionMax = Math.max(40, Math.floor((W - 32) / 3.6));
  const titleH = spec.title ? 30 : 8;
  const rowH = RIB_H + 12;
  const H = titleH + items.length * (rowH + GAP) + 8;
  const parts = [];
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  items.forEach((item, i) => {
    const y = titleH + i * (rowH + GAP);
    const mid = y + RIB_H / 2;
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const dark = lerpColor(theme.primary, theme.secondary, Math.min(1, t + 0.15));
    parts.push(`<polygon points="0,${y} ${FOLD},${mid} 0,${y + RIB_H}" fill="${dark}"/>`);
    parts.push(`<rect x="${FOLD}" y="${y}" width="${W - FOLD - TAIL}" height="${RIB_H}" fill="${fill}"/>`);
    parts.push(`<polygon points="${W - TAIL},${y} ${W},${y} ${W - TAIL / 2},${mid} ${W},${y + RIB_H} ${W - TAIL},${y + RIB_H}" fill="${fill}"/>`);
    parts.push(`<polygon points="${W - TAIL / 2},${mid} ${W},${y} ${W},${y + RIB_H}" fill="${dark}"/>`);
    parts.push(`<text x="${FOLD + 10}" y="${(mid + 4).toFixed(1)}" font-size="11" fill="#fff" font-family="system-ui,sans-serif" font-weight="700" letter-spacing="0.06em">${tt(item.label.toUpperCase(), ribLabelMax)}</text>`);
    const caption = getCaption(item);
    if (caption) parts.push(`<text x="${W / 2}" y="${(y + RIB_H + 12).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(caption, captionMax)}</text>`);
  });
  return svg5(W, H, theme, parts);
}

// src/layouts/list/hexagon-list.ts
function svg6(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render29(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const R = 50;
  const HEX_W = R * Math.sqrt(3), HEX_H = R * 2;
  const COL_W = HEX_W + 6, ROW_H = HEX_H * 0.75 + 4;
  const COLS = Math.min(items.length, 4);
  const rows = Math.ceil(items.length / COLS);
  const totalW = COLS * COL_W - 6;
  const startX = (W - totalW) / 2 + HEX_W / 2;
  const titleH = spec.title ? 30 : 8;
  const H = titleH + rows * ROW_H + R * 0.25 + 8;
  const hexPoints = (cx, cy) => Array.from({ length: 6 }, (_, k) => {
    const a = Math.PI / 6 + k * Math.PI / 3;
    return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  const MAX_CHARS = 12;
  const VALUE_MAX_CHARS = 14;
  const trunc = (s, max) => s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
  function wrapLabel(label) {
    if (label.length <= MAX_CHARS) return [label, null];
    const words = label.split(" ");
    let line1 = "";
    for (let i = 0; i < words.length; i++) {
      const attempt = line1 ? line1 + " " + words[i] : words[i];
      if (attempt.length <= MAX_CHARS) {
        line1 = attempt;
        continue;
      }
      const rest = (line1 ? words.slice(i) : words.slice(i + 1)).join(" ");
      return [line1 || trunc(words[i], MAX_CHARS), rest ? trunc(rest, MAX_CHARS) : null];
    }
    return [line1, null];
  }
  const parts = [];
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  items.forEach((item, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const cx = startX + col * COL_W + (row % 2 === 1 ? COL_W / 2 : 0);
    const cy = titleH + R + row * ROW_H;
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<polygon points="${hexPoints(cx, cy)}" fill="${fill}33" stroke="${fill}" stroke-width="1.5"/>`);
    const [line1, line2] = wrapLabel(item.label);
    const caption = getCaption(item);
    if (line2 && caption) {
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 13).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(line1)}</text>`);
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 1).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(line2)}</text>`);
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 15).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(trunc(caption, VALUE_MAX_CHARS))}</text>`);
    } else if (line2) {
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 7).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(line1)}</text>`);
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 7).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(line2)}</text>`);
    } else {
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(line1)}</text>`);
      if (caption) parts.push(`<text x="${cx.toFixed(1)}" y="${(cy + 8).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(trunc(caption, VALUE_MAX_CHARS))}</text>`);
    }
  });
  return svg6(W, H, theme, parts);
}

// src/layouts/list/trapezoid-list.ts
function svg7(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render30(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const GAP = 3;
  const captions = items.map((it) => getCaption(it));
  const hasAnyCaption = captions.some((c) => c !== null);
  const BAND_H = hasAnyCaption ? 40 : 28;
  const titleH = spec.title ? 30 : 8;
  const H = titleH + items.length * (BAND_H + GAP) + 8;
  const parts = [];
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  const maxInset = W * 0.18;
  items.forEach((item, i) => {
    const y = titleH + i * (BAND_H + GAP);
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const topInset = maxInset * (1 - t);
    const botInset = items.length > 1 ? maxInset * (1 - (i + 1) / (items.length - 1 || 1)) : 0;
    const clampedBotInset = Math.max(0, botInset);
    const d = `M${topInset.toFixed(1)},${y} L${(W - topInset).toFixed(1)},${y} L${(W - clampedBotInset).toFixed(1)},${y + BAND_H} L${clampedBotInset.toFixed(1)},${y + BAND_H} Z`;
    parts.push(`<path d="${d}" fill="${fill}33" stroke="${fill}" stroke-width="1"/>`);
    const innerW = W - topInset * 2 - 16;
    const labelMax = Math.floor(innerW / 6.2);
    const valueMax = Math.floor(innerW / 5.2);
    const caption = captions[i];
    if (hasAnyCaption && caption) {
      parts.push(`<text x="${W / 2}" y="${(y + BAND_H / 2 - 3).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, labelMax)}</text>`);
      parts.push(`<text x="${W / 2}" y="${(y + BAND_H / 2 + 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(caption, valueMax)}</text>`);
    } else {
      parts.push(`<text x="${W / 2}" y="${(y + BAND_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, labelMax)}</text>`);
    }
  });
  return svg7(W, H, theme, parts);
}

// src/layouts/list/tab-list.ts
function svg8(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function tabPanelContentParts(item, theme, panelY, W) {
  const cx = W / 2;
  const hPad = 20;
  const maxTitle = Math.max(10, Math.floor((W - 2 * hPad) / 5));
  const maxValue = Math.max(16, Math.floor((W - 2 * hPad) / 4));
  const maxChild = Math.max(30, Math.floor((W - 2 * hPad) / 4));
  const maxSub = Math.max(36, Math.floor((W - 2 * hPad) / 3.6));
  const parts = [];
  parts.push(`<text x="${cx}" y="${panelY + 26}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, maxTitle)}</text>`);
  if (item.value) {
    parts.push(`<text x="${cx}" y="${panelY + 44}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.value, maxValue)}</text>`);
  }
  const childRow = item.children.map((c) => c.label).join("  \xB7  ");
  if (childRow) {
    parts.push(`<text x="${cx}" y="${panelY + 62}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(childRow, maxChild)}</text>`);
  }
  const subRow = item.children.flatMap((c) => c.children).map((c) => c.label).join("  \xB7  ");
  if (subRow) {
    parts.push(`<text x="${cx}" y="${panelY + 78}" text-anchor="middle" font-size="9" fill="${theme.muted}" font-family="system-ui,sans-serif">${tt(subRow, maxSub)}</text>`);
  }
  return parts;
}
function render31(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const n = items.length;
  const TAB_H = 28, CONTENT_H = 100;
  const TAB_W = Math.min(160, (W - 8) / n);
  const titleH = spec.title ? 30 : 8;
  const H = titleH + TAB_H + CONTENT_H + 8;
  const activeFill = lerpColor(theme.primary, theme.secondary, 0);
  const parts = [];
  if (spec.title) {
    parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  }
  parts.push(`<g class="mdart-tab-root" data-text-muted="${escapeXml(theme.textMuted)}">`);
  items.forEach((item, i) => {
    const tx = 4 + i * (TAB_W + 2);
    const ty = titleH;
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const isActive = i === 0;
    const tabLabelMax = Math.max(3, Math.floor((TAB_W - 6) / 5));
    parts.push(
      `<g class="mdart-tab-hit" data-tab="${i}" data-color="${fill}" style="cursor:pointer"><rect class="mdart-tab-rect" x="${tx}" y="${ty}" width="${TAB_W}" height="${TAB_H}" rx="5" fill="${isActive ? fill : `${fill}22`}" ${isActive ? "" : `stroke="${fill}55" stroke-width="1"`}/><text class="mdart-tab-label" x="${(tx + TAB_W / 2).toFixed(1)}" y="${(ty + TAB_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${isActive ? "#ffffff" : theme.textMuted}" font-family="system-ui,sans-serif" font-weight="${isActive ? "700" : "400"}">${tt(item.label, tabLabelMax)}</text></g>`
    );
  });
  const panelY = titleH + TAB_H;
  parts.push(
    `<rect class="mdart-tab-content-bg" x="0" y="${panelY}" width="${W}" height="${CONTENT_H}" rx="6" fill="${activeFill}11" stroke="${activeFill}44" stroke-width="1.2"/>`
  );
  items.forEach((item, i) => {
    const vis = i === 0 ? "visible" : "hidden";
    parts.push(`<g class="mdart-tab-panel" data-tab="${i}" visibility="${vis}">`);
    parts.push(...tabPanelContentParts(item, theme, panelY, W));
    parts.push("</g>");
  });
  parts.push("</g>");
  return svg8(W, H, theme, parts);
}

// src/layouts/list/circle-list.ts
function svg9(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render32(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const ROW_H = 44, R = 16, LEFT = 28;
  const textX = LEFT + R + 10;
  const rightM = 16;
  const labelMax = Math.max(18, Math.floor((W - textX - rightM) / 5));
  const capMax = Math.max(24, Math.floor((W - textX - rightM) / 4.2));
  const titleH = spec.title ? 30 : 8;
  const H = titleH + items.length * ROW_H + 8;
  const parts = [];
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  parts.push(`<line x1="${LEFT}" y1="${titleH + ROW_H / 2}" x2="${LEFT}" y2="${titleH + (items.length - 1) * ROW_H + ROW_H / 2}" stroke="${theme.border}" stroke-width="2" stroke-dasharray="4,4"/>`);
  items.forEach((item, i) => {
    const cy = titleH + i * ROW_H + ROW_H / 2;
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<circle cx="${LEFT}" cy="${cy}" r="${R}" fill="${fill}"/>`);
    parts.push(`<text x="${LEFT}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff" font-family="system-ui,sans-serif" font-weight="700">${i + 1}</text>`);
    parts.push(`<text x="${textX}" y="${(cy - 4).toFixed(1)}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, labelMax)}</text>`);
    const caption = getCaption(item);
    if (caption) parts.push(`<text x="${textX}" y="${(cy + 12).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(caption, capMax)}</text>`);
  });
  return svg9(W, H, theme, parts);
}

// src/layouts/list/icon-list.ts
function svg10(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render33(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 500;
  const ROW_H = 44, CIRCLE_R = 18, LEFT = 24;
  const textX = LEFT + CIRCLE_R + 10;
  const rightM = 16;
  const labelMax = Math.max(20, Math.floor((W - textX - rightM) / 5));
  const capMax = Math.max(24, Math.floor((W - textX - rightM) / 4.2));
  const titleH = spec.title ? 30 : 8;
  const H = titleH + items.length * ROW_H + 8;
  const parts = [];
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`);
  items.forEach((item, i) => {
    const cy = titleH + i * ROW_H + ROW_H / 2;
    const t = items.length > 1 ? i / (items.length - 1) : 0;
    const fill = lerpColor(theme.primary, theme.secondary, t);
    const emojiMatch = item.label.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u);
    const icon = emojiMatch ? emojiMatch[1] : item.attrs[0] ?? "";
    const displayLabel = emojiMatch ? item.label.slice(emojiMatch[0].length) : item.label;
    parts.push(`<circle cx="${LEFT}" cy="${cy}" r="${CIRCLE_R}" fill="${fill}"/>`);
    if (icon) {
      parts.push(`<text x="${LEFT}" y="${(cy + 5).toFixed(1)}" text-anchor="middle" font-size="14" font-family="system-ui,sans-serif">${escapeXml(icon)}</text>`);
    }
    parts.push(`<text x="${textX}" y="${(cy - 4).toFixed(1)}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(displayLabel, labelMax)}</text>`);
    const caption = getCaption(item);
    if (caption) parts.push(`<text x="${textX}" y="${(cy + 12).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(caption, capMax)}</text>`);
    if (i < items.length - 1) parts.push(`<line x1="${LEFT + CIRCLE_R + 10}" y1="${cy + ROW_H / 2}" x2="${W - 16}" y2="${cy + ROW_H / 2}" stroke="${theme.border}" stroke-width="0.5"/>`);
  });
  return svg10(W, H, theme, parts);
}

// src/layouts/cycle/cycle.ts
function render34(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const NODE_W = 100;
  const NODE_H = 44;
  const hw = NODE_W / 2, hh = NODE_H / 2;
  const GAP = 6;
  const angularStep = 2 * Math.PI / n;
  const R = Math.max(140, Math.ceil(2 * (hw + GAP) / (angularStep * 0.6)));
  const W = Math.max(500, R * 2 + NODE_W + 40);
  const H = Math.max(400, R * 2 + NODE_H + 40);
  const cx = W / 2;
  const cy = H / 2;
  let svgContent = `<defs>
    <marker id="cycle-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="${theme.muted}"/>
    </marker>
  </defs>`;
  const rectEdge = (dx, dy) => {
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 1e-9) return hh;
    if (ady < 1e-9) return hw;
    return Math.min(hw / adx, hh / ady);
  };
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    const nextAngle = 2 * Math.PI * ((i + 1) % n) / n - Math.PI / 2;
    const t1x = -Math.sin(angle), t1y = Math.cos(angle);
    const t2x = -Math.sin(nextAngle), t2y = Math.cos(nextAngle);
    const clearFrom = (rectEdge(t1x, t1y) + GAP) / R;
    const clearTo = (rectEdge(t2x, t2y) + GAP) / R;
    const sa = angle + clearFrom;
    const ea = nextAngle - clearTo;
    const span = (ea - sa + 4 * Math.PI) % (2 * Math.PI);
    if (span < 0.02) continue;
    const ax1 = cx + R * Math.cos(sa), ay1 = cy + R * Math.sin(sa);
    const ax2 = cx + R * Math.cos(ea), ay2 = cy + R * Math.sin(ea);
    const largeArc = span > Math.PI ? 1 : 0;
    const t = i / (n - 1 || 1);
    const stroke = lerpColor(theme.secondary, theme.primary, t);
    svgContent += `<path d="M${ax1.toFixed(1)},${ay1.toFixed(1)} A${R},${R} 0 ${largeArc},1 ${ax2.toFixed(1)},${ay2.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,2" marker-end="url(#cycle-arr)"/>`;
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    const nx = cx + R * Math.cos(angle);
    const ny = cy + R * Math.sin(angle);
    const t = i / (n - 1 || 1);
    const fill = lerpColor(theme.secondary, theme.primary, t);
    svgContent += `<rect x="${(nx - hw).toFixed(1)}" y="${(ny - hh).toFixed(1)}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fill}"/>`;
    svgContent += `<text x="${nx.toFixed(1)}" y="${(ny + 5).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 14)}</text>`;
  }
  if (spec.title) {
    svgContent += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(spec.title)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/cycle/donut-cycle.ts
function render35(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 400;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2;
  const outerR = 140;
  const innerR = 70;
  const GAP_ANGLE = 0.03;
  let svgContent = "";
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const startAngle = 2 * Math.PI * i / n - Math.PI / 2 + GAP_ANGLE / 2;
    const endAngle = 2 * Math.PI * (i + 1) / n - Math.PI / 2 - GAP_ANGLE / 2;
    const t = i / (n - 1 || 1);
    const fill = lerpColor(theme.secondary, theme.primary, t);
    const x1 = cx + innerR * Math.cos(startAngle);
    const y1 = cy + innerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(startAngle);
    const y2 = cy + outerR * Math.sin(startAngle);
    const x3 = cx + outerR * Math.cos(endAngle);
    const y3 = cy + outerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(endAngle);
    const y4 = cy + innerR * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const path = `M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1} ${y1} Z`;
    svgContent += `<path d="${path}" fill="${fill}" />`;
    const midAngle = (startAngle + endAngle) / 2;
    const labelR = (outerR + innerR) / 2;
    const lx = cx + labelR * Math.cos(midAngle);
    const ly = cy + labelR * Math.sin(midAngle);
    svgContent += `<text x="${lx}" y="${ly + 4}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 10)}</text>`;
  }
  if (spec.title) {
    svgContent += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/cycle/gear-cycle.ts
function gearPath(cx, cy, outerR, innerR, teeth, phase) {
  const points = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = phase + Math.PI / teeth * i;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return "M " + points.join(" L ") + " Z";
}
function wrapGearText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) return [tt(text, maxChars)];
  if (lines.length === 1) return lines;
  return [lines[0], tt(lines.slice(1).join(" "), maxChars)];
}
function renderGearLabel(parts, gx, gy, label, value, fontSize, maxChars, labelFill, theme) {
  const lines = wrapGearText(label, maxChars);
  const lineH = fontSize + 2;
  const valueFontSize = Math.max(fontSize - 2, 8);
  const valueLineH = valueFontSize + 2;
  const blockH = lines.length * lineH + (value ? valueLineH : 0);
  let y = gy - blockH / 2 + lineH * 0.72;
  for (const line of lines) {
    parts.push(
      `<text x="${gx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="${fontSize}" fill="${labelFill}" font-family="system-ui,sans-serif" font-weight="600">${line}</text>`
    );
    y += lineH;
  }
  if (value) {
    parts.push(
      `<text x="${gx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="${valueFontSize}" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(value, maxChars)}</text>`
    );
  }
}
function render36(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 500;
  const titleH = spec.title ? 34 : 0;
  const H = 380 + titleH;
  const cx = W / 2;
  const cy = titleH + 190;
  const parts = [];
  parts.push(`<defs><marker id="gear-arr" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto"><path d="M0,0.5 L6,3.5 L0,6.5 Z" fill="${theme.muted}dd"/></marker></defs>`);
  if (n === 1) {
    const item = items[0];
    const fill = theme.primary;
    parts.push(`<path d="${gearPath(cx, cy, 90, 68, 12, 0)}" fill="${fill}" opacity="0.8"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="52" fill="${theme.bg}"/>`);
    renderGearLabel(parts, cx, cy, item.label, item.value, 12, 12, theme.text, theme);
  } else if (n === 2) {
    const outerR = 90, innerR = 68, teeth = 12;
    const gapX = outerR * 1.85;
    const positions = [cx - gapX / 2, cx + gapX / 2];
    positions.forEach((gx, i) => {
      const item = items[i];
      const t = i / (n - 1 || 1);
      const fill = lerpColor(theme.primary, theme.secondary, t);
      const phase = i * (Math.PI / teeth);
      parts.push(`<path d="${gearPath(gx, cy, outerR, innerR, teeth, phase)}" fill="${fill}" opacity="0.8"/>`);
      parts.push(`<circle cx="${gx}" cy="${cy}" r="52" fill="${theme.bg}"/>`);
      renderGearLabel(parts, gx, cy, item.label, item.value, 11, 12, theme.text, theme);
    });
  } else if (n === 3) {
    const centerFill = theme.primary;
    parts.push(`<path d="${gearPath(cx, cy, 80, 60, 12, 0)}" fill="${centerFill}" opacity="0.8"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="46" fill="${theme.bg}"/>`);
    renderGearLabel(parts, cx, cy, items[0].label, items[0].value, 11, 12, theme.text, theme);
    const sideAngles = [-Math.PI / 3, Math.PI / 3];
    const dist = 80 + 55 - 5;
    [1, 2].forEach((idx, si) => {
      const item = items[idx];
      const t = idx / (n - 1);
      const fill = lerpColor(theme.primary, theme.secondary, t);
      const angle = sideAngles[si];
      const gx = cx + dist * Math.cos(angle);
      const gy = cy + dist * Math.sin(angle);
      const phase = Math.PI / 8;
      parts.push(`<path d="${gearPath(gx, gy, 55, 40, 8, phase)}" fill="${fill}" opacity="0.8"/>`);
      parts.push(`<circle cx="${gx}" cy="${gy}" r="32" fill="${theme.bg}"/>`);
      renderGearLabel(parts, gx, gy, item.label, item.value, 10, 9, theme.text, theme);
    });
  } else {
    const R = 130;
    const outerR = 44, innerR = 32, teeth = 8;
    for (let i = 0; i < n; i++) {
      const a1 = 2 * Math.PI * i / n - Math.PI / 2;
      const a2 = 2 * Math.PI * ((i + 1) % n) / n - Math.PI / 2;
      const arcR = R + outerR * 0.55;
      const angOffset = outerR / R * 0.9;
      const startA = a1 + angOffset;
      const endA = a2 - angOffset;
      const x1 = cx + arcR * Math.cos(startA), y1 = cy + arcR * Math.sin(startA);
      const x2 = cx + arcR * Math.cos(endA), y2 = cy + arcR * Math.sin(endA);
      const sweep = (endA - startA + 2 * Math.PI) % (2 * Math.PI) > Math.PI ? 1 : 0;
      parts.push(`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${arcR.toFixed(1)},${arcR.toFixed(1)} 0 ${sweep},1 ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${theme.muted}bb" stroke-width="1.8" marker-end="url(#gear-arr)"/>`);
    }
    for (let i = 0; i < n; i++) {
      const item = items[i];
      const angle = 2 * Math.PI * i / n - Math.PI / 2;
      const gx = cx + R * Math.cos(angle);
      const gy = cy + R * Math.sin(angle);
      const t = i / (n - 1 || 1);
      const fill = lerpColor(theme.primary, theme.secondary, t);
      const phase = i * (Math.PI / (teeth * n));
      parts.push(`<path d="${gearPath(gx, gy, outerR, innerR, teeth, phase)}" fill="${fill}" opacity="0.8"/>`);
      parts.push(`<circle cx="${gx}" cy="${gy}" r="24" fill="${theme.bg}"/>`);
      renderGearLabel(parts, gx, gy, item.label, item.value, 9, 7, theme.text, theme);
    }
  }
  return svgWrap(W, H, theme, spec.title, parts);
}

// src/layouts/cycle/spiral.ts
function svgWrap2(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render37(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 500;
  const H = 420;
  const cx = W / 2;
  const cy = H / 2 + 10;
  const innerR = 20;
  const outerR = 170;
  const turns = n <= 4 ? 2 : 2.5;
  const SAMPLES = 200;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  const spiralPoints = [];
  for (let s = 0; s <= SAMPLES; s++) {
    const theta = s / SAMPLES * turns * 2 * Math.PI;
    const r = innerR + (outerR - innerR) * theta / (turns * 2 * Math.PI);
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    spiralPoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  parts.push(`<polyline points="${spiralPoints.join(" ")}" fill="none" stroke="${theme.textMuted}" stroke-width="2" opacity="0.7"/>`);
  for (let k = 0; k < n; k++) {
    const theta = n > 1 ? k * (turns * 2 * Math.PI) / (n - 1) : 0;
    const r = innerR + (outerR - innerR) * theta / (turns * 2 * Math.PI);
    const mx = cx + r * Math.cos(theta);
    const my = cy + r * Math.sin(theta);
    const t = k / (n - 1 || 1);
    const isLast = k === n - 1;
    const dotR = isLast ? 9 : 7;
    const fill = isLast ? theme.accent : lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${dotR}" fill="${fill}"/>`);
    const cosTheta = Math.cos(theta);
    const labelX = cosTheta >= 0 ? mx + dotR + 4 : mx - dotR - 4;
    const anchor = cosTheta >= 0 ? "start" : "end";
    parts.push(`<text x="${labelX.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(items[k].label, 14)}</text>`);
  }
  return svgWrap2(W, H, theme, parts);
}

// src/layouts/cycle/block-cycle.ts
function svgWrap3(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render38(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  if (n % 2 !== 0) return render34(spec, theme);
  const W = 560;
  const topN = n / 2;
  const COLS = topN;
  const GAP_X = 10;
  const BOX_W2 = Math.floor((W - 16 - (COLS - 1) * GAP_X) / COLS);
  const BOX_H2 = 68;
  const HEADER_H = 20;
  const GAP_Y = 28;
  const titleH = spec.title ? 28 : 8;
  const H = titleH + 2 * BOX_H2 + GAP_Y + 8;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<defs>
    <marker id="bc-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="${theme.primary}"/>
    </marker>
  </defs>`);
  const rowY = [titleH, titleH + BOX_H2 + GAP_Y];
  const boxPos = [];
  for (let col = 0; col < COLS; col++) {
    const x = 8 + col * (BOX_W2 + GAP_X);
    boxPos.push({ x, y: rowY[0], col, row: 0 });
  }
  for (let col = COLS - 1; col >= 0; col--) {
    const x = 8 + col * (BOX_W2 + GAP_X);
    boxPos.push({ x, y: rowY[1], col, row: 1 });
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const { x, y } = boxPos[i];
    const t = i / (n - 1 || 1);
    const headerFill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${x}" y="${y}" width="${BOX_W2}" height="${BOX_H2}" rx="5" fill="${theme.surface}" stroke="${headerFill}" stroke-opacity="0.55" stroke-width="1"/>`);
    parts.push(`<path d="M ${x + 5} ${y} L ${x + BOX_W2 - 5} ${y} Q ${x + BOX_W2} ${y} ${x + BOX_W2} ${y + 5} L ${x + BOX_W2} ${y + HEADER_H} L ${x} ${y + HEADER_H} L ${x} ${y + 5} Q ${x} ${y} ${x + 5} ${y} Z" fill="${headerFill}"/>`);
    const headerMaxChars = Math.max(6, Math.floor((BOX_W2 - 8) / 5));
    parts.push(`<text x="${x + BOX_W2 / 2}" y="${y + HEADER_H - 5}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, headerMaxChars)}</text>`);
    const bodyMaxChars = Math.max(8, Math.floor((BOX_W2 - 12) / 4.4));
    const bodyLines = item.children.length > 0 ? item.children.slice(0, 2).map((c) => truncate(c.label, bodyMaxChars)) : item.value ? [truncate(item.value, bodyMaxChars)] : [];
    const lineH = 13;
    const bodyMidY = y + HEADER_H + (BOX_H2 - HEADER_H) / 2;
    const firstBaselineY = bodyMidY - bodyLines.length * lineH / 2 + 9 * 0.75;
    bodyLines.forEach((line, li) => {
      parts.push(`<text x="${x + 6}" y="${(firstBaselineY + li * lineH).toFixed(1)}" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(line)}</text>`);
    });
  }
  for (let i = 0; i < n; i++) {
    const from = boxPos[i];
    const to = boxPos[(i + 1) % n];
    if (from.row === to.row) {
      let x1, x2, arrowY;
      if (from.x < to.x) {
        x1 = from.x + BOX_W2 + 2;
        x2 = to.x - 6;
        arrowY = from.y + BOX_H2 / 2;
      } else {
        x1 = from.x - 2;
        x2 = to.x + BOX_W2 + 6;
        arrowY = from.y + BOX_H2 / 2;
      }
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${arrowY.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${arrowY.toFixed(1)}" stroke="${theme.primary}" stroke-width="1.5" marker-end="url(#bc-arr)"/>`);
    } else {
      const colCenter = from.x + BOX_W2 / 2;
      let y1, y2;
      if (from.row === 0) {
        y1 = from.y + BOX_H2 + 2;
        y2 = to.y - 6;
      } else {
        y1 = from.y - 2;
        y2 = to.y + BOX_H2 + 6;
      }
      parts.push(`<line x1="${colCenter.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${colCenter.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${theme.primary}" stroke-width="1.5" marker-end="url(#bc-arr)"/>`);
    }
  }
  return svgWrap3(W, H, theme, parts);
}

// src/layouts/cycle/segmented-cycle.ts
function svgWrap4(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render39(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 440;
  const H = 380;
  const cx = W / 2;
  const cy = H / 2;
  const outerR = 120;
  const innerR = 60;
  const labelR = outerR + 20;
  const connectorR = outerR + 5;
  const GAP_ANGLE = 0.03;
  const parts = [];
  if (spec.title) {
    parts.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`);
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const startAngle = 2 * Math.PI * i / n - Math.PI / 2 + GAP_ANGLE / 2;
    const endAngle = 2 * Math.PI * (i + 1) / n - Math.PI / 2 - GAP_ANGLE / 2;
    const t = i / (n - 1 || 1);
    const fill = lerpColor(theme.secondary, theme.primary, t);
    const x1 = cx + innerR * Math.cos(startAngle);
    const y1 = cy + innerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(startAngle);
    const y2 = cy + outerR * Math.sin(startAngle);
    const x3 = cx + outerR * Math.cos(endAngle);
    const y3 = cy + outerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(endAngle);
    const y4 = cy + innerR * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const path = `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x3.toFixed(1)} ${y3.toFixed(1)} L ${x4.toFixed(1)} ${y4.toFixed(1)} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
    parts.push(`<path d="${path}" fill="${fill}" />`);
    const midAngle = (startAngle + endAngle) / 2;
    const lx = cx + labelR * Math.cos(midAngle);
    const ly = cy + labelR * Math.sin(midAngle);
    const cosA = Math.cos(midAngle);
    const anchor = cosA > 0.3 ? "start" : cosA < -0.3 ? "end" : "middle";
    const labelText = truncate(item.label, 14);
    const cx1 = cx + connectorR * Math.cos(midAngle);
    const cy1 = cy + connectorR * Math.sin(midAngle);
    parts.push(`<line x1="${cx1.toFixed(1)}" y1="${cy1.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${fill}" stroke-width="1" opacity="0.7"/>`);
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(labelText)}</text>`);
  }
  return svgWrap4(W, H, theme, parts);
}

// src/layouts/cycle/nondirectional-cycle.ts
function svgWrap5(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render40(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 440;
  const H = 400;
  const cx = W / 2;
  const cy = H / 2;
  const R = 145;
  const nodeR = 22;
  const parts = [];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${theme.textMuted}" stroke-width="14" opacity="0.45"/>`);
  if (spec.title) {
    parts.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(spec.title)}</text>`);
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    const nx = cx + R * Math.cos(angle);
    const ny = cy + R * Math.sin(angle);
    const t = i / (n - 1 || 1);
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${nodeR}" fill="${fill}"/>`);
    parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + (item.value ? -3 : 4)).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 10)}</text>`);
    if (item.value) {
      parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + 9).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.bg}" font-family="system-ui,sans-serif">${tt(item.value, 10)}</text>`);
    }
  }
  return svgWrap5(W, H, theme, parts);
}

// src/layouts/cycle/multidirectional-cycle.ts
function svgWrap6(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render41(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 440;
  const H = 400;
  const cx = W / 2;
  const cy = H / 2;
  const R = 150;
  const nodeR = 20;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  const positions = [];
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    positions.push({ x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) });
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = positions[i];
      const b = positions[j];
      parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${theme.textMuted}" stroke-width="1" opacity="0.55"/>`);
    }
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const { x, y } = positions[i];
    const t = i / (n - 1 || 1);
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${nodeR}" fill="${fill}" stroke="${theme.bg}" stroke-width="2"/>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 10)}</text>`);
  }
  return svgWrap6(W, H, theme, parts);
}

// src/layouts/cycle/loop.ts
function svgWrap7(W, H, theme, parts) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${parts.join("\n    ")}
  </svg>`;
}
function render42(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 520;
  const padX = 48;
  const nodeR = n <= 4 ? 22 : n <= 6 ? 18 : n <= 8 ? 15 : 12;
  const fontSize = nodeR >= 18 ? 10 : 9;
  const titleH = spec.title ? 36 : 10;
  const rowY = titleH + nodeR + 16;
  const dipAmt = nodeR * 2.2 + 20;
  const H = rowY + nodeR + dipAmt + 28;
  const spacing = n > 1 ? (W - padX * 2) / (n - 1) : 0;
  const nx = (i) => n === 1 ? W / 2 : padX + i * spacing;
  const parts = [];
  if (spec.title) parts.push(titleEl(W, spec.title, theme));
  parts.push(`<defs>
    <marker id="lp-fwd" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L7,4 L0,8 Z" fill="${theme.primary}"/>
    </marker>
    <marker id="lp-ret" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L7,4 L0,8 Z" fill="${theme.accent}bb"/>
    </marker>
  </defs>`);
  for (let i = 0; i < n - 1; i++) {
    const x1 = nx(i) + nodeR + 2;
    const x2 = nx(i + 1) - nodeR - 2;
    if (x2 > x1) {
      const t = i / Math.max(n - 1, 1);
      const col = lerpColor(theme.primary, theme.secondary, t);
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${rowY}" x2="${x2.toFixed(1)}" y2="${rowY}" stroke="${col}" stroke-width="2" marker-end="url(#lp-fwd)"/>`);
    }
  }
  if (n === 1) {
    const cx = W / 2;
    const loopTop = rowY - nodeR - 4;
    parts.push(`<path d="M${cx - nodeR + 4},${loopTop} a22,16 0 1 1 ${nodeR * 2 - 8},0" fill="none" stroke="${theme.accent}" stroke-width="1.8" stroke-dasharray="5,4" opacity="0.75" marker-end="url(#lp-ret)"/>`);
  } else {
    const x1 = nx(n - 1);
    const x0 = nx(0);
    const sy = rowY + nodeR + 2;
    const ey = sy;
    const dip = rowY + nodeR + dipAmt;
    parts.push(`<path d="M${x1.toFixed(1)},${sy} C${x1.toFixed(1)},${dip.toFixed(1)} ${x0.toFixed(1)},${dip.toFixed(1)} ${x0.toFixed(1)},${ey}" fill="none" stroke="${theme.accent}" stroke-width="1.8" stroke-dasharray="5,4" opacity="0.7" marker-end="url(#lp-ret)"/>`);
    const labelY = dip + 13;
    parts.push(`<text x="${(W / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-style="italic" opacity="0.85">&#x21BA; loop</text>`);
  }
  items.forEach((item, i) => {
    const x = nx(i);
    const t = i / Math.max(n - 1, 1);
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${rowY}" r="${nodeR}" fill="${fill}" stroke="${theme.bg}" stroke-width="2.5"/>`);
    const words = item.label.split(" ");
    if (words.length <= 1) {
      parts.push(`<text x="${x.toFixed(1)}" y="${(rowY + fontSize * 0.38).toFixed(1)}" text-anchor="middle" font-size="${fontSize}" font-weight="700" font-family="system-ui,sans-serif" fill="${theme.bg}">${tt(item.label, 11)}</text>`);
    } else {
      const mid = Math.ceil(words.length / 2);
      const l1 = words.slice(0, mid).join(" ");
      const l2 = words.slice(mid).join(" ");
      const fh = fontSize - 1;
      parts.push(`<text x="${x.toFixed(1)}" y="${(rowY - fh * 0.4).toFixed(1)}" text-anchor="middle" font-size="${fh}" font-weight="700" font-family="system-ui,sans-serif" fill="${theme.bg}">${tt(l1, 11)}</text>`);
      parts.push(`<text x="${x.toFixed(1)}" y="${(rowY + fh * 1.1).toFixed(1)}" text-anchor="middle" font-size="${fh}" font-weight="700" font-family="system-ui,sans-serif" fill="${theme.bg}">${tt(l2, 11)}</text>`);
    }
    const bx = x + nodeR - 4;
    const by = rowY - nodeR + 4;
    parts.push(`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="7" fill="${theme.bg}" stroke="${fill}" stroke-width="1.5"/>`);
    parts.push(`<text x="${bx.toFixed(1)}" y="${(by + 3.5).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" font-family="system-ui,sans-serif" fill="${fill}">${i + 1}</text>`);
  });
  return svgWrap7(W, H, theme, parts);
}

// src/layouts/matrix/swot.ts
function render43(spec, theme) {
  const quadrantMap = {
    S: { label: "Strengths", items: [], fill: "#065f46", textColor: "#34d399" },
    // emerald-800/400
    W: { label: "Weaknesses", items: [], fill: "#9f1239", textColor: "#fb7185" },
    // rose-800/400
    O: { label: "Opportunities", items: [], fill: "#3730a3", textColor: "#818cf8" },
    // indigo-800/400
    T: { label: "Threats", items: [], fill: "#92400e", textColor: "#fbbf24" }
    // amber-800/400
  };
  for (const item of spec.items) {
    if (item.prefix === "+") quadrantMap.S.items.push(item.label);
    else if (item.prefix === "-") quadrantMap.W.items.push(item.label);
    else if (item.prefix === "?") quadrantMap.O.items.push(item.label);
    else if (item.prefix === "!") quadrantMap.T.items.push(item.label);
    else {
      const lower = item.label.toLowerCase();
      let key = null;
      if (lower.startsWith("strength")) key = "S";
      else if (lower.startsWith("weakness")) key = "W";
      else if (lower.startsWith("opportunit")) key = "O";
      else if (lower.startsWith("threat")) key = "T";
      if (key) {
        quadrantMap[key].items.push(...item.children.map((c) => c.label));
      }
    }
  }
  const W = 500;
  const H = 400;
  const PAD = 16;
  const titleH = spec.title ? 28 : 0;
  const contentTop = spec.title ? PAD + titleH : 0;
  const CELL_W = W / 2;
  const CELL_H = (H - contentTop) / 2;
  const bulletMax = Math.max(10, Math.floor((CELL_W - 20) / 4.3));
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  const quadrants = [
    { key: "S", col: 0, row: 0 },
    { key: "W", col: 1, row: 0 },
    { key: "O", col: 0, row: 1 },
    { key: "T", col: 1, row: 1 }
  ];
  for (const { key, col, row } of quadrants) {
    const q = quadrantMap[key];
    const x = col * CELL_W;
    const y = contentTop + row * CELL_H;
    svgContent += `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${q.fill}" />`;
    svgContent += `<text x="${x + CELL_W / 2}" y="${y + 22}" text-anchor="middle" font-size="12" fill="${q.textColor}" font-family="system-ui,sans-serif" font-weight="700">${q.label}</text>`;
    const maxItems = Math.min(q.items.length, 5);
    for (let i = 0; i < maxItems; i++) {
      const itemY = y + 38 + i * 16;
      svgContent += `<text x="${x + 10}" y="${itemY}" font-size="10" fill="${q.textColor}" font-family="system-ui,sans-serif" opacity="0.85">\u2022 ${tt(q.items[i], bulletMax)}</text>`;
    }
    if (q.items.length > 5) {
      svgContent += `<text x="${x + 10}" y="${y + 38 + 5 * 16}" font-size="9" fill="${q.textColor}" font-family="system-ui,sans-serif" opacity="0.6">+${q.items.length - 5} more</text>`;
    }
  }
  svgContent += `<line x1="${W / 2}" y1="${contentTop}" x2="${W / 2}" y2="${H}" stroke="${theme.bg}" stroke-width="2" />`;
  svgContent += `<line x1="0" y1="${contentTop + CELL_H}" x2="${W}" y2="${contentTop + CELL_H}" stroke="${theme.bg}" stroke-width="2" />`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/matrix/pros-cons.ts
function render44(spec, theme) {
  let pros = [];
  let cons = [];
  let currentSection = null;
  for (const item of spec.items) {
    const lower = item.label.toLowerCase();
    const isProsHeader = lower.includes("pro") || lower.includes("advantage") || lower.includes("benefit");
    const isConsHeader = lower.includes("con") || lower.includes("disadvantage") || lower.includes("risk");
    if (isProsHeader) {
      currentSection = "pros";
      if (item.children.length) {
        pros.push(...item.children);
        currentSection = null;
      }
      continue;
    }
    if (isConsHeader) {
      currentSection = "cons";
      if (item.children.length) {
        cons.push(...item.children);
        currentSection = null;
      }
      continue;
    }
    if (item.prefix === "+") {
      pros.push(item);
      continue;
    }
    if (currentSection === "pros") {
      pros.push(item);
      continue;
    }
    if (currentSection === "cons") {
      cons.push(item);
      continue;
    }
    if (item.prefix === "-") cons.push(item);
  }
  const maxRows = Math.max(pros.length, cons.length, 1);
  const W = 500;
  const ROW_H = 36;
  const HEADER_H = 40;
  const PAD = 16;
  const titleH = spec.title ? 28 : 0;
  const H = PAD + titleH + HEADER_H + maxRows * ROW_H + PAD;
  const HALF = W / 2;
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  const baseY = PAD + titleH;
  svgContent += `<rect x="0" y="${baseY}" width="${HALF}" height="${HEADER_H}" fill="#064e3b" />`;
  svgContent += `<text x="${HALF / 2}" y="${baseY + 25}" text-anchor="middle" font-size="13" fill="#6ee7b7" font-family="system-ui,sans-serif" font-weight="700">Pros</text>`;
  svgContent += `<rect x="${HALF}" y="${baseY}" width="${HALF}" height="${HEADER_H}" fill="#4c0519" />`;
  svgContent += `<text x="${HALF + HALF / 2}" y="${baseY + 25}" text-anchor="middle" font-size="13" fill="#fda4af" font-family="system-ui,sans-serif" font-weight="700">Cons</text>`;
  const itemsY = baseY + HEADER_H;
  for (let i = 0; i < maxRows; i++) {
    const rowY = itemsY + i * ROW_H;
    const rowBg = i % 2 === 0 ? theme.surface : theme.bg;
    svgContent += `<rect x="0" y="${rowY}" width="${HALF}" height="${ROW_H}" fill="${rowBg}" />`;
    svgContent += `<rect x="${HALF}" y="${rowY}" width="${HALF}" height="${ROW_H}" fill="${rowBg}" />`;
    const colMaxChars = Math.floor((HALF - PAD - 14 - 6) / 5.8);
    if (i < pros.length) {
      svgContent += `<text x="${PAD}" y="${rowY + 23}" font-size="11" fill="#6ee7b7" font-family="system-ui,sans-serif">\u2713 ${tt(pros[i].label, colMaxChars)}</text>`;
    }
    if (i < cons.length) {
      svgContent += `<text x="${HALF + PAD}" y="${rowY + 23}" font-size="11" fill="#fda4af" font-family="system-ui,sans-serif">\u2717 ${tt(cons[i].label, colMaxChars)}</text>`;
    }
    if (i < maxRows - 1) {
      svgContent += `<line x1="0" y1="${rowY + ROW_H}" x2="${W}" y2="${rowY + ROW_H}" stroke="${theme.border}" stroke-width="0.5" />`;
    }
  }
  svgContent += `<line x1="${HALF}" y1="${baseY}" x2="${HALF}" y2="${H}" stroke="${theme.bg}" stroke-width="2" />`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/matrix/comparison.ts
function lerpColorLocal(c1, c2, t) {
  const hexToRgb2 = (hex) => {
    const n = parseInt(hex.replace("#", ""), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const [r1, g1, b1] = hexToRgb2(c1);
  const [r2, g2, b2] = hexToRgb2(c2);
  const lerp = (a, b) => Math.round(a + (b - a) * t);
  return "#" + [lerp(r1, r2), lerp(g1, g2), lerp(b1, b2)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function render45(spec, theme) {
  return spec.direction === "LR" ? renderLR(spec, theme) : renderTB(spec, theme);
}
function renderLR(spec, theme) {
  const cols = spec.items;
  if (cols.length === 0) return renderEmpty(theme);
  const allChildrenPositional = cols.every((col) => col.children.every((ch) => !ch.value));
  const isPositional = allChildrenPositional && cols.length >= 2;
  const rowLabelColHeader = isPositional ? cols[0].label : "Feature";
  const rowLabels = isPositional ? cols[0].children.map((ch) => ch.label) : Array.from(new Set(cols.flatMap((c) => c.children.map((ch) => ch.label))));
  const dataCols = isPositional ? cols.slice(1) : cols;
  const LABEL_W = 120;
  const ROW_H = 34;
  const HEADER_H = 44;
  const PAD = 12;
  const titleH = spec.title ? 28 : 0;
  const W = Math.max(400, dataCols.length * 140 + LABEL_W);
  const COL_W = Math.floor((W - LABEL_W) / dataCols.length);
  const H = PAD + titleH + HEADER_H + rowLabels.length * ROW_H + PAD;
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  const baseY = PAD + titleH;
  svgContent += `<rect x="0" y="${baseY}" width="${LABEL_W}" height="${HEADER_H}" fill="${theme.surface}" />`;
  svgContent += `<text x="${LABEL_W / 2}" y="${baseY + 27}" text-anchor="middle" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${tt(rowLabelColHeader, 16)}</text>`;
  for (let ci = 0; ci < dataCols.length; ci++) {
    const col = dataCols[ci];
    const colX = LABEL_W + ci * COL_W;
    const t = dataCols.length > 1 ? ci / (dataCols.length - 1) : 0.5;
    const fill = lerpColorLocal("#1e3a8a", "#1d4ed8", t);
    svgContent += `<rect x="${colX}" y="${baseY}" width="${COL_W}" height="${HEADER_H}" fill="${fill}" />`;
    svgContent += `<text x="${colX + COL_W / 2}" y="${baseY + 27}" text-anchor="middle" font-size="12" fill="#bfdbfe" font-family="system-ui,sans-serif" font-weight="700">${tt(col.label, Math.floor(COL_W / 7))}</text>`;
  }
  for (let ri = 0; ri < rowLabels.length; ri++) {
    const rowLabel = rowLabels[ri];
    const rowY = baseY + HEADER_H + ri * ROW_H;
    const rowBg = ri % 2 === 0 ? theme.surface : theme.bg;
    svgContent += `<rect x="0" y="${rowY}" width="${W}" height="${ROW_H}" fill="${rowBg}" />`;
    svgContent += `<text x="${PAD}" y="${rowY + 22}" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(rowLabel, 16)}</text>`;
    for (let ci = 0; ci < dataCols.length; ci++) {
      const col = dataCols[ci];
      const colX = LABEL_W + ci * COL_W;
      let val;
      if (isPositional) {
        val = col.children[ri]?.label ?? "\u2014";
      } else {
        const child = col.children.find((ch) => ch.label === rowLabel);
        val = child?.value ?? (child ? "\u2713" : "\u2014");
      }
      svgContent += `<text x="${colX + COL_W / 2}" y="${rowY + 22}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(val, Math.floor(COL_W / 7))}</text>`;
    }
    svgContent += `<line x1="0" y1="${rowY + ROW_H}" x2="${W}" y2="${rowY + ROW_H}" stroke="${theme.border}" stroke-width="0.5" />`;
  }
  for (let ci = 0; ci <= dataCols.length; ci++) {
    const lx = LABEL_W + ci * COL_W;
    svgContent += `<line x1="${lx}" y1="${baseY}" x2="${lx}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="0.5" />`;
  }
  svgContent += `<line x1="${LABEL_W}" y1="${baseY}" x2="${LABEL_W}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="1" />`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}
function renderTB(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const allChildrenPositional = items.every((it) => it.children.every((ch) => !ch.value));
  const useFirstRowHeaders = allChildrenPositional && items.length >= 2 && !spec.columns;
  let colLabels;
  let dataRows;
  let topLeftHeader;
  if (spec.columns && spec.columns.length > 0) {
    colLabels = spec.columns;
    dataRows = items;
    topLeftHeader = "";
  } else if (useFirstRowHeaders) {
    colLabels = items[0].children.map((ch) => ch.label);
    dataRows = items.slice(1);
    topLeftHeader = items[0].label;
  } else if (allChildrenPositional) {
    const numCols2 = items[0]?.children.length ?? 0;
    colLabels = Array.from({ length: numCols2 }, (_, i) => String.fromCharCode(65 + i));
    dataRows = items;
    topLeftHeader = "";
  } else {
    colLabels = Array.from(new Set(items.flatMap((it) => it.children.map((ch) => ch.label))));
    dataRows = items;
    topLeftHeader = "Field";
  }
  const numCols = colLabels.length || 1;
  const LABEL_W = 130;
  const ROW_H = 36;
  const HEADER_H = 32;
  const PAD = 12;
  const titleH = spec.title ? 28 : 0;
  const W = Math.max(400, numCols * 130 + LABEL_W);
  const COL_W = Math.floor((W - LABEL_W) / numCols);
  const H = PAD + titleH + HEADER_H + dataRows.length * ROW_H + PAD;
  let svg30 = "";
  if (spec.title) {
    svg30 += `<text x="${W / 2}" y="${PAD + 16}" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  const baseY = PAD + titleH;
  svg30 += `<rect x="0" y="${baseY}" width="${LABEL_W}" height="${HEADER_H}" fill="${theme.surface}" />`;
  if (topLeftHeader) {
    svg30 += `<text x="${LABEL_W / 2}" y="${baseY + 21}" text-anchor="middle" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${tt(topLeftHeader, 18)}</text>`;
  }
  for (let ci = 0; ci < numCols; ci++) {
    const colX = LABEL_W + ci * COL_W;
    svg30 += `<rect x="${colX}" y="${baseY}" width="${COL_W}" height="${HEADER_H}" fill="${theme.surface}" />`;
    svg30 += `<text x="${colX + COL_W / 2}" y="${baseY + 21}" text-anchor="middle" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${tt(colLabels[ci], Math.floor(COL_W / 7))}</text>`;
  }
  for (let ri = 0; ri < dataRows.length; ri++) {
    const row = dataRows[ri];
    const rowY = baseY + HEADER_H + ri * ROW_H;
    const t = dataRows.length > 1 ? ri / (dataRows.length - 1) : 0.5;
    const fill = lerpColorLocal("#1e3a8a", "#1d4ed8", t);
    svg30 += `<rect x="0" y="${rowY}" width="${LABEL_W}" height="${ROW_H}" fill="${fill}" />`;
    svg30 += `<text x="${LABEL_W / 2}" y="${rowY + 23}" text-anchor="middle" font-size="12" fill="#bfdbfe" font-family="system-ui,sans-serif" font-weight="700">${tt(row.label, 16)}</text>`;
    const rowBg = ri % 2 === 0 ? theme.surface : theme.bg;
    svg30 += `<rect x="${LABEL_W}" y="${rowY}" width="${W - LABEL_W}" height="${ROW_H}" fill="${rowBg}" />`;
    for (let ci = 0; ci < numCols; ci++) {
      const colX = LABEL_W + ci * COL_W;
      let val;
      const kvChild = row.children.find((ch) => ch.label === colLabels[ci]);
      if (kvChild) {
        val = kvChild.value ?? "\u2713";
      } else {
        val = row.children[ci]?.label ?? "\u2014";
      }
      svg30 += `<text x="${colX + COL_W / 2}" y="${rowY + 23}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(val, Math.floor(COL_W / 7))}</text>`;
    }
    svg30 += `<line x1="0" y1="${rowY + ROW_H}" x2="${W}" y2="${rowY + ROW_H}" stroke="${theme.border}" stroke-width="0.5" />`;
  }
  for (let ci = 0; ci <= numCols; ci++) {
    const lx = LABEL_W + ci * COL_W;
    svg30 += `<line x1="${lx}" y1="${baseY}" x2="${lx}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="0.5" />`;
  }
  svg30 += `<line x1="${LABEL_W}" y1="${baseY}" x2="${LABEL_W}" y2="${H - PAD}" stroke="${theme.border}" stroke-width="1" />`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svg30}
  </svg>`;
}

// src/layouts/matrix/matrix-2x2.ts
function render46(spec, theme) {
  const items = spec.items.slice(0, 4);
  const W = 500;
  const TITLE_H = spec.title ? 28 : 0;
  const CELL_W = W / 2;
  const CELL_H = 168;
  const H = TITLE_H + CELL_H * 2;
  const headerMax = Math.max(8, Math.floor((CELL_W - 24) / 5));
  const bulletMax = Math.max(8, Math.floor((CELL_W - 28) / 4.3));
  const fills = [`${theme.primary}22`, `${theme.secondary}1a`, `${theme.accent}1a`, `${theme.secondary}22`];
  const strokes = [theme.primary, theme.secondary, theme.accent, theme.secondary];
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`;
  }
  const positions = [[0, 0], [1, 0], [0, 1], [1, 1]];
  items.forEach((item, i) => {
    const [col, row] = positions[i];
    const x = col * CELL_W, y = TITLE_H + row * CELL_H;
    svgContent += `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${fills[i]}" stroke="${theme.border}" stroke-width="0.5"/>`;
    svgContent += `<text x="${x + CELL_W / 2}" y="${y + 26}" text-anchor="middle" font-size="12" fill="${strokes[i]}" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, headerMax)}</text>`;
    item.children.slice(0, 5).forEach((ch, j) => {
      svgContent += `<text x="${x + 12}" y="${y + 46 + j * 19}" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" opacity="0.85">\u2022 ${tt(ch.label, bulletMax)}</text>`;
    });
  });
  svgContent += `<line x1="${W / 2}" y1="${TITLE_H}" x2="${W / 2}" y2="${H}" stroke="${theme.border}" stroke-width="1.5"/>`;
  svgContent += `<line x1="0" y1="${TITLE_H + CELL_H}" x2="${W}" y2="${TITLE_H + CELL_H}" stroke="${theme.border}" stroke-width="1.5"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/matrix/bcg.ts
var BCG_QUADS = [
  { key: "stars", keywords: ["star"], label: "\u2605 Stars", sub: "High growth \xB7 High share", fill: "#3730a3", text: "#a5b4fc" },
  // indigo-800/300
  { key: "questions", keywords: ["question", "mark"], label: "? Question Marks", sub: "High growth \xB7 Low share", fill: "#92400e", text: "#fcd34d" },
  // amber-800/300
  { key: "cash", keywords: ["cash", "cow"], label: "$ Cash Cows", sub: "Low growth \xB7 High share", fill: "#065f46", text: "#6ee7b7" },
  // emerald-800/300
  { key: "dogs", keywords: ["dog"], label: "\u2715 Dogs", sub: "Low growth \xB7 Low share", fill: "#9f1239", text: "#fda4af" }
  // rose-800/300
];
function render47(spec, theme) {
  const buckets = Object.fromEntries(BCG_QUADS.map((q) => [q.key, []]));
  let slotIdx = 0;
  for (const item of spec.items) {
    const lower = item.label.toLowerCase();
    const matched = BCG_QUADS.find((q) => q.keywords.some((kw) => lower.includes(kw)));
    if (matched) {
      buckets[matched.key].push(...item.children.length ? item.children.map((c) => c.label) : []);
    } else {
      const slot = BCG_QUADS[slotIdx % 4];
      buckets[slot.key].push(item.label);
      slotIdx++;
    }
  }
  const W = 520, TITLE_H = spec.title ? 28 : 0, CELL_W = W / 2, CELL_H = 168;
  const AX = 20, H = TITLE_H + CELL_H * 2 + AX;
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`;
  }
  const positions = [[0, 0], [1, 0], [0, 1], [1, 1]];
  BCG_QUADS.forEach((q, i) => {
    const [col, row] = positions[i];
    const x = col * CELL_W, y = TITLE_H + row * CELL_H;
    svgContent += `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${q.fill}"/>`;
    svgContent += `<text x="${x + CELL_W / 2}" y="${y + 24}" text-anchor="middle" font-size="12" fill="${q.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(q.label)}</text>`;
    svgContent += `<text x="${x + CELL_W / 2}" y="${y + 38}" text-anchor="middle" font-size="8" fill="${q.text}" font-family="system-ui,sans-serif" opacity="0.65">${q.sub}</text>`;
    buckets[q.key].slice(0, 4).forEach((label, j) => {
      svgContent += `<text x="${x + 10}" y="${y + 56 + j * 18}" font-size="10" fill="${q.text}" font-family="system-ui,sans-serif" opacity="0.9">\u2022 ${tt(label, 22)}</text>`;
    });
  });
  svgContent += `<line x1="${W / 2}" y1="${TITLE_H}" x2="${W / 2}" y2="${TITLE_H + CELL_H * 2}" stroke="${theme.bg}" stroke-width="2"/>`;
  svgContent += `<line x1="0" y1="${TITLE_H + CELL_H}" x2="${W}" y2="${TITLE_H + CELL_H}" stroke="${theme.bg}" stroke-width="2"/>`;
  const axY = TITLE_H + CELL_H * 2 + 14;
  svgContent += `<text x="${CELL_W / 2}" y="${axY}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">\u2190 High Market Share</text>`;
  svgContent += `<text x="${CELL_W + CELL_W / 2}" y="${axY}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">Low Market Share \u2192</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/matrix/ansoff.ts
var ANSOFF_QUADS = [
  { key: "penetration", keywords: ["penetrat"], label: "Market Penetration", sub: "Existing product \xB7 Existing market", fill: "#065f46", text: "#6ee7b7" },
  // emerald-800/300
  { key: "product-dev", keywords: ["product dev", "product d", "new product"], label: "Product Development", sub: "New product \xB7 Existing market", fill: "#3730a3", text: "#a5b4fc" },
  // indigo-800/300
  { key: "market-dev", keywords: ["market dev", "market d", "new market"], label: "Market Development", sub: "Existing product \xB7 New market", fill: "#92400e", text: "#fcd34d" },
  // amber-800/300
  { key: "diversification", keywords: ["divers"], label: "Diversification", sub: "New product \xB7 New market", fill: "#9f1239", text: "#fda4af" }
  // rose-800/300
];
function render48(spec, theme) {
  const buckets = Object.fromEntries(ANSOFF_QUADS.map((q) => [q.key, []]));
  let slotIdx = 0;
  for (const item of spec.items) {
    const lower = item.label.toLowerCase();
    const matched = ANSOFF_QUADS.find((q) => q.keywords.some((kw) => lower.includes(kw)));
    if (matched) {
      buckets[matched.key].push(...item.children.length ? item.children.map((c) => c.label) : []);
    } else {
      const slot = ANSOFF_QUADS[slotIdx % 4];
      buckets[slot.key].push(item.label);
      slotIdx++;
    }
  }
  const W = 520, TITLE_H = spec.title ? 28 : 0, CELL_W = W / 2, CELL_H = 168;
  const AX = 20, H = TITLE_H + CELL_H * 2 + AX;
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`;
  }
  const positions = [[0, 0], [1, 0], [0, 1], [1, 1]];
  ANSOFF_QUADS.forEach((q, i) => {
    const [col, row] = positions[i];
    const x = col * CELL_W, y = TITLE_H + row * CELL_H;
    svgContent += `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${q.fill}"/>`;
    svgContent += `<text x="${x + CELL_W / 2}" y="${y + 24}" text-anchor="middle" font-size="11.5" fill="${q.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(q.label)}</text>`;
    svgContent += `<text x="${x + CELL_W / 2}" y="${y + 38}" text-anchor="middle" font-size="7.5" fill="${q.text}" font-family="system-ui,sans-serif" opacity="0.65">${q.sub}</text>`;
    buckets[q.key].slice(0, 4).forEach((label, j) => {
      svgContent += `<text x="${x + 10}" y="${y + 56 + j * 18}" font-size="10" fill="${q.text}" font-family="system-ui,sans-serif" opacity="0.9">\u2022 ${tt(label, 22)}</text>`;
    });
  });
  svgContent += `<line x1="${W / 2}" y1="${TITLE_H}" x2="${W / 2}" y2="${TITLE_H + CELL_H * 2}" stroke="${theme.bg}" stroke-width="2"/>`;
  svgContent += `<line x1="0" y1="${TITLE_H + CELL_H}" x2="${W}" y2="${TITLE_H + CELL_H}" stroke="${theme.bg}" stroke-width="2"/>`;
  const axY = TITLE_H + CELL_H * 2 + 14;
  svgContent += `<text x="${CELL_W / 2}" y="${axY}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">Existing Products</text>`;
  svgContent += `<text x="${CELL_W + CELL_W / 2}" y="${axY}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">New Products \u2192</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/matrix/matrix-nxm.ts
function render49(spec, theme) {
  const rows = spec.items;
  if (rows.length === 0) return renderEmpty(theme);
  const numCols = Math.max(...rows.map((r) => r.children.length), 1);
  const COL_W = Math.min(160, Math.max(90, 520 / numCols));
  const LABEL_W = 110, ROW_H = 36, HEADER_H = 36;
  const TITLE_H = spec.title ? 28 : 0;
  const W = LABEL_W + numCols * COL_W;
  const H = TITLE_H + HEADER_H + rows.length * ROW_H + 8;
  let svgContent = "";
  if (spec.title) {
    svgContent += `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(spec.title)}</text>`;
  }
  const colHeaders = Array.from(
    { length: numCols },
    (_, c) => spec.columns?.[c] ?? String.fromCharCode(65 + c)
  );
  const colHeaderMax = Math.floor(COL_W / 7);
  svgContent += `<rect x="0" y="${TITLE_H}" width="${LABEL_W}" height="${HEADER_H}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="0.5"/>`;
  for (let c = 0; c < numCols; c++) {
    const colX = LABEL_W + c * COL_W;
    svgContent += `<rect x="${colX}" y="${TITLE_H}" width="${COL_W}" height="${HEADER_H}" fill="${theme.primary}28" stroke="${theme.border}" stroke-width="0.5"/>`;
    svgContent += `<text x="${colX + COL_W / 2}" y="${TITLE_H + 23}" text-anchor="middle" font-size="11" fill="${theme.primary}" font-family="system-ui,sans-serif" font-weight="700">${tt(colHeaders[c], colHeaderMax)}</text>`;
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowY = TITLE_H + HEADER_H + r * ROW_H;
    const rowBg = r % 2 === 0 ? theme.surface : theme.bg;
    svgContent += `<rect x="0" y="${rowY}" width="${LABEL_W}" height="${ROW_H}" fill="${rowBg}" stroke="${theme.border}" stroke-width="0.5"/>`;
    svgContent += `<text x="8" y="${rowY + 23}" font-size="10.5" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${tt(row.label, 13)}</text>`;
    for (let c = 0; c < numCols; c++) {
      const colX = LABEL_W + c * COL_W;
      const cell = row.children[c];
      svgContent += `<rect x="${colX}" y="${rowY}" width="${COL_W}" height="${ROW_H}" fill="${rowBg}" stroke="${theme.border}" stroke-width="0.5"/>`;
      if (cell) {
        svgContent += `<text x="${colX + COL_W / 2}" y="${rowY + 23}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(cell.label, 16)}</text>`;
      }
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8"/>
    ${svgContent}
  </svg>`;
}

// src/layouts/hierarchy/shared.ts
function countLeaves(item) {
  if (item.children.length === 0) return 1;
  return item.children.reduce((s, c) => s + countLeaves(c), 0);
}
function maxDepth(items) {
  if (items.length === 0) return 0;
  return 1 + Math.max(...items.map((i) => maxDepth(i.children)));
}
function layoutNodes(items, startX, y, totalW, levelH, parentCx, parentCy) {
  const totalLeaves = items.reduce((s, i) => s + countLeaves(i), 0) || 1;
  let cx = startX;
  return items.map((item) => {
    const myLeaves = countLeaves(item);
    const myW = myLeaves / totalLeaves * totalW;
    const nx = cx + myW / 2;
    const node = {
      label: item.label,
      x: nx,
      y,
      parentX: parentCx,
      parentY: parentCy,
      children: layoutNodes(item.children, cx, y + levelH, myW, levelH, nx, y)
    };
    cx += myW;
    return node;
  });
}
function flatNodes(nodes) {
  return nodes.flatMap((n) => [n, ...flatNodes(n.children)]);
}

// src/layouts/hierarchy/org-chart.ts
var BOX_W = 110;
var BOX_H = 30;
function render50(spec, theme) {
  if (spec.items.length === 0) return renderEmpty2(theme);
  const depth = maxDepth(spec.items);
  const totalLeaves = spec.items.reduce((s, i) => s + countLeaves(i), 0) || 1;
  const W = Math.max(640, totalLeaves * (BOX_W + 8) + 80);
  const levelH = spec.type === "tree" ? 68 : 86;
  const TITLE_H = spec.title ? 28 : 10;
  const H = Math.max(160, depth * levelH + TITLE_H + 30);
  const startY = TITLE_H + BOX_H / 2;
  const HPAD = BOX_W / 2 + 4;
  const nodes = layoutNodes(spec.items, HPAD, startY, W - HPAD * 2, levelH);
  const flat = flatNodes(nodes);
  const lines = [];
  const boxes = [];
  for (const n of flat) {
    if (n.parentX !== void 0 && n.parentY !== void 0) {
      const x1 = n.parentX, y1 = n.parentY + BOX_H / 2;
      const x2 = n.x, y2 = n.y - BOX_H / 2;
      const mid = (y1 + y2) / 2;
      lines.push(
        `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${theme.textMuted}cc" stroke-width="1.5"/>`
      );
    }
    const bx = n.x - BOX_W / 2;
    const by = n.y - BOX_H / 2;
    boxes.push(
      `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${BOX_W}" height="${BOX_H}" rx="6" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1.2"/>`,
      `<text x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(n.label, 15)}</text>`
    );
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${(W / 2).toFixed(1)}" y="18" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ""}
  ${lines.join("\n  ")}
  ${boxes.join("\n  ")}
</svg>`;
}
function renderEmpty2(theme) {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`;
}

// src/layouts/hierarchy/tree.ts
function render51(spec, theme) {
  return render50(spec, theme);
}

// src/layouts/hierarchy/h-org-chart.ts
function render52(spec, theme) {
  if (spec.items.length === 0) return renderEmpty3(theme);
  const depth = maxDepth(spec.items);
  const totalLeaves = spec.items.reduce((s, i) => s + countLeaves(i), 0) || 1;
  const ROW_H = 40, COL_W = 140, NODE_W = 110, NODE_H = 28;
  const TITLE_H = spec.title ? 28 : 8;
  const W = depth * COL_W + NODE_W + 20;
  const H = Math.max(100, totalLeaves * ROW_H + TITLE_H + 20);
  const hnodes = [];
  function layoutH(items, level, leafStart, totalH, px, py) {
    const tot = items.reduce((s, i) => s + countLeaves(i), 0) || 1;
    let leafY = leafStart;
    for (const item of items) {
      const leaves = countLeaves(item);
      const span = leaves / tot * totalH;
      const ny = leafY + span / 2;
      const nx = 10 + level * COL_W + NODE_W / 2;
      hnodes.push({ label: item.label, x: nx, y: ny, parentX: px, parentY: py });
      layoutH(item.children, level + 1, leafY, span, nx + NODE_W / 2, ny);
      leafY += span;
    }
  }
  layoutH(spec.items, 0, TITLE_H + 10, H - TITLE_H - 20);
  const lines = [], boxes = [];
  for (const n of hnodes) {
    if (n.parentX !== void 0 && n.parentY !== void 0) {
      const mid = (n.parentX + n.x - NODE_W / 2) / 2;
      lines.push(`<path d="M${n.parentX.toFixed(1)},${n.parentY.toFixed(1)} H${mid.toFixed(1)} V${n.y.toFixed(1)} H${(n.x - NODE_W / 2).toFixed(1)}" fill="none" stroke="${theme.border}" stroke-width="1.5"/>`);
    }
    const bx = n.x - NODE_W / 2, by = n.y - NODE_H / 2;
    boxes.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${NODE_W}" height="${NODE_H}" rx="5" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1.2"/>`);
    boxes.push(`<text x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(n.label, 14)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${(W / 2).toFixed(1)}" y="18" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ""}
  ${lines.join("\n  ")}
  ${boxes.join("\n  ")}
</svg>`;
}
function renderEmpty3(theme) {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`;
}

// src/layouts/hierarchy/hierarchy-list.ts
function render53(spec, theme) {
  const rows = [];
  function flatten(items, depth, phs) {
    items.forEach((item, i) => {
      const isLast = i === items.length - 1;
      rows.push({ label: item.label, depth, isLast, parentHasSibling: [...phs] });
      flatten(item.children, depth + 1, [...phs, !isLast]);
    });
  }
  flatten(spec.items, 0, []);
  const W = 560, ROW_H = 23, INDENT = 18, PAD = 14;
  const TITLE_H = spec.title ? 28 : 8;
  const H = TITLE_H + rows.length * ROW_H + 12;
  const parts = [];
  if (spec.title) parts.push(`<text x="${PAD}" y="20" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`);
  rows.forEach((row) => {
    const y = TITLE_H + rows.indexOf(row) * ROW_H + ROW_H / 2;
    const bulletX = PAD + row.depth * INDENT;
    if (row.depth > 0) {
      for (let d = 0; d < row.depth - 1; d++) {
        if (row.parentHasSibling[d]) {
          const lx = PAD + d * INDENT + INDENT - 4;
          parts.push(`<line x1="${lx}" y1="${(y - ROW_H / 2).toFixed(1)}" x2="${lx}" y2="${(y + ROW_H / 2).toFixed(1)}" stroke="${theme.border}35" stroke-width="1"/>`);
        }
      }
      const px = PAD + (row.depth - 1) * INDENT + INDENT - 4;
      parts.push(`<line x1="${px}" y1="${(y - ROW_H / 2).toFixed(1)}" x2="${px}" y2="${y.toFixed(1)}" stroke="${theme.border}35" stroke-width="1"/>`);
      if (!row.isLast) parts.push(`<line x1="${px}" y1="${y.toFixed(1)}" x2="${px}" y2="${(y + ROW_H / 2).toFixed(1)}" stroke="${theme.border}35" stroke-width="1"/>`);
      parts.push(`<line x1="${px}" y1="${y.toFixed(1)}" x2="${(bulletX - 2).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${theme.border}35" stroke-width="1"/>`);
    }
    const bR = row.depth === 0 ? 5 : row.depth === 1 ? 3.5 : 2.5;
    const bFill = row.depth === 0 ? theme.accent : row.depth === 1 ? theme.primary : theme.secondary;
    parts.push(`<circle cx="${(bulletX + bR).toFixed(1)}" cy="${y.toFixed(1)}" r="${bR}" fill="${bFill}"/>`);
    const textX = bulletX + bR * 2 + 4;
    const fs = row.depth === 0 ? 12 : row.depth === 1 ? 11 : 10;
    const fw = row.depth === 0 ? "700" : "400";
    const tf = row.depth === 0 ? theme.text : row.depth === 1 ? theme.text : theme.textMuted;
    parts.push(`<text x="${textX.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="${fs}" fill="${tf}" font-family="system-ui,sans-serif" font-weight="${fw}">${tt(row.label, 40)}</text>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join("\n  ")}
</svg>`;
}

// src/layouts/hierarchy/radial-tree.ts
function render54(spec, theme) {
  const W = 600, H = 500;
  const cx = W / 2, cy = H / 2;
  let centerLabel, branches;
  if (spec.title) {
    centerLabel = spec.title;
    branches = spec.items;
  } else if (spec.items.length === 1) {
    centerLabel = spec.items[0].label;
    branches = spec.items[0].children;
  } else {
    centerLabel = "Root";
    branches = spec.items;
  }
  const n = branches.length || 1;
  const R1 = 150, R2 = 72;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    const bx = cx + R1 * Math.cos(angle), by = cy + R1 * Math.sin(angle);
    const branch = branches[i];
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${theme.accent}50" stroke-width="2.5"/>`);
    const subs = branch.children, ns = subs.length;
    for (let j = 0; j < ns; j++) {
      const spread = Math.min(Math.PI * 0.5, Math.max(0.4, (ns - 1) * 0.38));
      const sa = ns <= 1 ? angle : angle + (j - (ns - 1) / 2) * (spread / Math.max(ns - 1, 1));
      const sx = bx + R2 * Math.cos(sa), sy = by + R2 * Math.sin(sa);
      parts.push(`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${theme.border}88" stroke-width="1.5"/>`);
      parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="14" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`);
      parts.push(`<text x="${sx.toFixed(1)}" y="${(sy + 3.5).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(subs[j].label, 9)}</text>`);
    }
    parts.push(`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="22" fill="${theme.primary}" stroke="${theme.bg}" stroke-width="2"/>`);
    const ws = branch.label.split(" ");
    if (ws.length === 1) {
      parts.push(`<text x="${bx.toFixed(1)}" y="${(by + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${tt(branch.label, 9)}</text>`);
    } else {
      const m = Math.ceil(ws.length / 2);
      parts.push(`<text x="${bx.toFixed(1)}" y="${(by - 1).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${tt(ws.slice(0, m).join(" "), 9)}</text>`);
      parts.push(`<text x="${bx.toFixed(1)}" y="${(by + 9).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${tt(ws.slice(m).join(" "), 9)}</text>`);
    }
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="32" fill="${theme.accent}" stroke="${theme.bg}" stroke-width="2"/>`);
  const cw = centerLabel.split(" ");
  if (cw.length === 1) {
    parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${tt(centerLabel, 12)}</text>`);
  } else {
    const m = Math.ceil(cw.length / 2);
    parts.push(`<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="10" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${tt(cw.slice(0, m).join(" "), 12)}</text>`);
    parts.push(`<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="10" fill="${theme.bg}" font-weight="700" font-family="system-ui,sans-serif">${tt(cw.slice(m).join(" "), 12)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join("\n  ")}
</svg>`;
}

// src/layouts/hierarchy/decision-tree.ts
function render55(spec, theme) {
  if (spec.items.length === 0) return renderEmpty4(theme);
  const W = 640;
  const depth = maxDepth(spec.items);
  const levelH = 80;
  const TITLE_H = spec.title ? 28 : 10;
  const H = Math.max(160, depth * levelH + TITLE_H + 40);
  const DW = 54, DH = 18;
  const LW = 90, LH = 26;
  const startY = TITLE_H + DH;
  const nodes = layoutNodes(spec.items, 0, startY, W, levelH);
  const flat = flatNodes(nodes);
  const lines = [], shapes = [];
  for (const n of flat) {
    if (n.parentX !== void 0 && n.parentY !== void 0) {
      const isLeaf = n.children.length === 0;
      const x1 = n.parentX, y1 = n.parentY + DH;
      const x2 = n.x, y2 = isLeaf ? n.y - LH / 2 : n.y - DH;
      const mid = (y1 + y2) / 2;
      lines.push(`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${mid.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${theme.textMuted}cc" stroke-width="1.5"/>`);
      const siblings = n.parentX !== void 0 ? flat.filter((s) => s.parentX === n.parentX && s.parentY === n.parentY) : [];
      if (siblings.length === 2) {
        const isFirst = siblings[0] === n;
        const lx = (x1 + x2) / 2 + (isFirst ? -18 : 12);
        const ly = (y1 + y2) / 2;
        const lbl = isFirst ? "Yes" : "No";
        const lcolor = isFirst ? theme.primary : theme.secondary;
        lines.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="9" fill="${lcolor}" font-family="system-ui,sans-serif" font-weight="700">${lbl}</text>`);
      }
    }
    const { x, y } = n;
    if (n.children.length > 0) {
      shapes.push(`<polygon points="${x},${(y - DH).toFixed(1)} ${(x + DW).toFixed(1)},${y} ${x},${(y + DH).toFixed(1)} ${(x - DW).toFixed(1)},${y}" fill="${theme.surface}" stroke="${theme.primary}aa" stroke-width="1.5"/>`);
      shapes.push(`<text x="${x}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(n.label, 10)}</text>`);
    } else {
      const bx = x - LW / 2, by = y - LH / 2;
      shapes.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${LW}" height="${LH}" rx="5" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1.2"/>`);
      shapes.push(`<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(n.label, 13)}</text>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${W / 2}" y="18" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ""}
  ${lines.join("\n  ")}
  ${shapes.join("\n  ")}
</svg>`;
}
function renderEmpty4(theme) {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`;
}

// src/layouts/hierarchy/sitemap.ts
function render56(spec, theme) {
  if (spec.items.length === 0) return renderEmpty5(theme);
  const snodes = [];
  const W = 640, levelH = 52, TITLE_H = spec.title ? 28 : 10;
  const depth = maxDepth(spec.items);
  const H = Math.max(120, depth * levelH + TITLE_H + 30);
  const BW = [90, 76, 64], BH = [26, 22, 18];
  function bw(l) {
    return BW[Math.min(l, 2)];
  }
  function bh(l) {
    return BH[Math.min(l, 2)];
  }
  function layout(items, level, x0, x1, px, py) {
    const tot = items.reduce((s, i) => s + countLeaves(i), 0) || 1;
    let cx2 = x0;
    for (const item of items) {
      const leaves = countLeaves(item);
      const myW = leaves / tot * (x1 - x0);
      const nx = cx2 + myW / 2;
      const ny = TITLE_H + level * levelH + bh(level) / 2;
      snodes.push({ label: item.label, level, x: nx, y: ny, parentX: px, parentY: py });
      layout(item.children, level + 1, cx2, cx2 + myW, nx, ny);
      cx2 += myW;
    }
  }
  layout(spec.items, 0, 0, W);
  const lines = [], boxes = [];
  for (const n of snodes) {
    if (n.parentX !== void 0 && n.parentY !== void 0) {
      const py = n.parentY + bh(n.level - 1) / 2;
      const cy = n.y - bh(n.level) / 2;
      lines.push(`<line x1="${n.parentX.toFixed(1)}" y1="${py.toFixed(1)}" x2="${n.x.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${theme.textMuted}aa" stroke-width="1.2"/>`);
    }
    const fill = n.level === 0 ? theme.accent : n.level === 1 ? theme.primary : theme.secondary;
    boxes.push(`<rect x="${(n.x - bw(n.level) / 2).toFixed(1)}" y="${(n.y - bh(n.level) / 2).toFixed(1)}" width="${bw(n.level)}" height="${bh(n.level)}" rx="4" fill="${fill}" stroke="${theme.bg}" stroke-width="1.5"/>`);
    const fs = n.level === 0 ? 10 : n.level === 1 ? 9 : 8;
    boxes.push(`<text x="${n.x.toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${theme.bg}" font-family="system-ui,sans-serif" font-weight="600">${tt(n.label, 12)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${W / 2}" y="18" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ""}
  ${lines.join("\n  ")}
  ${boxes.join("\n  ")}
</svg>`;
}
function renderEmpty5(theme) {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`;
}

// src/layouts/hierarchy/bracket.ts
function render57(spec, theme) {
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(spec.items.length, 2))));
  const slots = Math.pow(2, rounds);
  const STAGE = { champion: rounds, final: rounds - 1, semi: rounds - 2 };
  const countWins = (attrs) => {
    let n = 0;
    for (const raw of attrs) {
      const a = raw.toLowerCase();
      if (a === "w" || a === "win" || a === "winner") {
        n += 1;
        continue;
      }
      const compact = a.match(/^w(\d+)$/);
      if (compact) {
        n += parseInt(compact[1], 10) || 0;
        continue;
      }
      if (a in STAGE) {
        n = Math.max(n, STAGE[a]);
        continue;
      }
    }
    return n;
  };
  const contestants = spec.items.map((i) => ({ label: i.label, wins: countWins(i.attrs) }));
  if (contestants.length === 0) contestants.push({ label: "TBD", wins: 0 });
  const leaves = [...contestants];
  while (leaves.length < slots) leaves.push(null);
  const allRounds = [leaves];
  for (let r = 1; r <= rounds; r++) {
    const prev = allRounds[r - 1], curr = [];
    for (let i = 0; i < prev.length; i += 2) {
      const a = prev[i], b = prev[i + 1];
      if (!a && !b) {
        curr.push(null);
        continue;
      }
      if (!a) {
        curr.push(b);
        continue;
      }
      if (!b) {
        curr.push(a);
        continue;
      }
      const aQual = a.wins >= r, bQual = b.wins >= r;
      if (aQual && bQual) curr.push(a.wins >= b.wins ? a : b);
      else if (aQual) curr.push(a);
      else if (bQual) curr.push(b);
      else curr.push(null);
    }
    allRounds.push(curr);
  }
  const lostAt = (r, sIdx, slot) => {
    if (!slot || r >= allRounds.length - 1) return false;
    const pairIdx = Math.floor(sIdx / 2);
    const nextSlot = allRounds[r + 1][pairIdx];
    if (nextSlot === null) return false;
    return nextSlot !== slot;
  };
  const TITLE_H = spec.title ? 28 : 8;
  const ROW_H = Math.max(20, Math.min(34, 240 / slots));
  const BOX_W2 = 98, BOX_H2 = Math.max(16, ROW_H - 8);
  const GAP = 10, COL_W = BOX_W2 + GAP + 30;
  const W = allRounds.length * COL_W + 20;
  const leafH = slots * ROW_H;
  const H = TITLE_H + leafH + 22;
  const parts = [];
  if (spec.title) parts.push(`<text x="${(W / 2).toFixed(1)}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`);
  for (let r = 0; r < allRounds.length; r++) {
    const round = allRounds[r], x = 10 + r * COL_W;
    const slotH = leafH / round.length;
    const isWinner = r === allRounds.length - 1;
    for (let s = 0; s < round.length; s++) {
      const slot = round[s], nodeY = TITLE_H + s * slotH + slotH / 2, boxY = nodeY - BOX_H2 / 2;
      if (slot !== null) {
        const lost = lostAt(r, s, slot);
        const fill = isWinner ? theme.accent : theme.surface;
        const stroke = isWinner ? theme.accent : theme.textMuted;
        const fw = isWinner ? "700" : r === 0 ? "400" : "600";
        const op = lost ? "0.45" : "1";
        parts.push(`<rect x="${x}" y="${boxY.toFixed(1)}" width="${BOX_W2}" height="${BOX_H2}" rx="3" fill="${fill}" stroke="${stroke}${isWinner ? "" : "cc"}" stroke-width="1.2" opacity="${op}"/>`);
        parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${(nodeY + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${isWinner ? theme.bg : theme.text}" font-family="system-ui,sans-serif" font-weight="${fw}" opacity="${op}">${tt(slot.label, 13)}</text>`);
      } else {
        const placeholder = r === 0 ? "bye" : "TBD";
        parts.push(`<rect x="${x}" y="${boxY.toFixed(1)}" width="${BOX_W2}" height="${BOX_H2}" rx="3" fill="none" stroke="${theme.textMuted}55" stroke-width="1" stroke-dasharray="3,2"/>`);
        parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${(nodeY + 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}77" font-family="system-ui,sans-serif">${placeholder}</text>`);
      }
      if (!isWinner && s % 2 === 0 && s + 1 < round.length) {
        const yA = nodeY, yB = TITLE_H + (s + 1) * slotH + slotH / 2, yMid = (yA + yB) / 2;
        const armX = x + BOX_W2 + GAP, nextX = x + COL_W;
        parts.push(`<polyline points="${x + BOX_W2},${yA.toFixed(1)} ${armX},${yA.toFixed(1)} ${armX},${yMid.toFixed(1)}" fill="none" stroke="${theme.textMuted}aa" stroke-width="1.5"/>`);
        parts.push(`<polyline points="${x + BOX_W2},${yB.toFixed(1)} ${armX},${yB.toFixed(1)} ${armX},${yMid.toFixed(1)}" fill="none" stroke="${theme.textMuted}aa" stroke-width="1.5"/>`);
        parts.push(`<line x1="${armX}" y1="${yMid.toFixed(1)}" x2="${nextX}" y2="${yMid.toFixed(1)}" stroke="${theme.textMuted}aa" stroke-width="1.5"/>`);
      }
    }
    const tot = allRounds.length - 1;
    const champCrowned = isWinner && round[0] !== null;
    const lbl = isWinner ? champCrowned ? "\u{1F3C6} Champion" : "Champion" : r === tot - 1 ? "Final" : r === tot - 2 && tot >= 3 ? "Semi" : `Round ${r + 1}`;
    parts.push(`<text x="${(x + BOX_W2 / 2).toFixed(1)}" y="${(TITLE_H + leafH + 16).toFixed(1)}" text-anchor="middle" font-size="8" fill="${champCrowned ? theme.accent : theme.textMuted}" font-family="system-ui,sans-serif">${lbl}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join("\n  ")}
</svg>`;
}

// src/layouts/hierarchy/bracket-tree.ts
function render58(spec, theme) {
  return render57(spec, theme);
}

// src/layouts/hierarchy/mind-map.ts
function render59(spec, theme) {
  const W = 640, H = 520;
  const cx = W / 2, cy = H / 2;
  let centerLabel;
  let branches;
  if (spec.title) {
    centerLabel = spec.title;
    branches = spec.items;
  } else if (spec.items.length === 1) {
    centerLabel = spec.items[0].label;
    branches = spec.items[0].children;
  } else {
    centerLabel = "Topic";
    branches = spec.items;
  }
  const n = branches.length;
  const R1 = 155;
  const R2 = 78;
  const lines = [];
  const shapes = [];
  const texts = [];
  shapes.push(`<ellipse cx="${cx}" cy="${cy}" rx="64" ry="24" fill="${theme.surface}" stroke="${theme.accent}" stroke-width="1.5"/>`);
  texts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(centerLabel, 16)}</text>`);
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    const bx = cx + R1 * Math.cos(angle);
    const by = cy + R1 * Math.sin(angle);
    const branch = branches[i];
    lines.push(`<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${theme.accent}99" stroke-width="2"/>`);
    shapes.push(`<ellipse cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" rx="50" ry="20" fill="${theme.surface}" stroke="${theme.accent}cc" stroke-width="1"/>`);
    texts.push(`<text x="${bx.toFixed(1)}" y="${(by + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(branch.label, 13)}</text>`);
    const subs = branch.children;
    const ns = subs.length;
    for (let j = 0; j < ns; j++) {
      const spread = Math.min(Math.PI * 0.7, Math.max(0.45, (ns - 1) * 0.5));
      const subAngle = ns <= 1 ? angle : angle + (j - (ns - 1) / 2) * (spread / Math.max(ns - 1, 1));
      const sx = bx + R2 * Math.cos(subAngle);
      const sy = by + R2 * Math.sin(subAngle);
      lines.push(`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${theme.textMuted}" stroke-width="1" opacity="0.7"/>`);
      shapes.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="20" fill="${theme.surface}" stroke="${theme.textMuted}aa" stroke-width="1"/>`);
      texts.push(`<text x="${sx.toFixed(1)}" y="${(sy + 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(subs[j].label, 11)}</text>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${[...lines, ...shapes, ...texts].join("\n  ")}
</svg>`;
}

// src/layouts/pyramid/pyramid.ts
function render60(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty6(theme);
  const inverted = spec.type === "inverted-pyramid" || spec.type === "inverted";
  const n = items.length;
  const W = 600;
  const MARGIN_TOP = spec.title ? 34 : 12;
  const MARGIN_BOTTOM = 16;
  const LAYER_H = Math.min(62, Math.max(28, (340 - MARGIN_TOP - MARGIN_BOTTOM) / n));
  const H = MARGIN_TOP + n * LAYER_H + MARGIN_BOTTOM;
  const MAX_W = W - 40;
  const MIN_W = 44;
  const shapes = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    const item = items[i];
    let topW, botW;
    if (inverted) {
      topW = MIN_W + (n - i) / n * (MAX_W - MIN_W);
      botW = MIN_W + (n - i - 1) / n * (MAX_W - MIN_W);
    } else {
      topW = MIN_W + i / n * (MAX_W - MIN_W);
      botW = MIN_W + (i + 1) / n * (MAX_W - MIN_W);
    }
    const y = MARGIN_TOP + i * LAYER_H;
    const cxPos = W / 2;
    const topLeft = cxPos - topW / 2;
    const topRight = cxPos + topW / 2;
    const botLeft = cxPos - botW / 2;
    const botRight = cxPos + botW / 2;
    const narrowT = inverted ? 1 - i / Math.max(n - 1, 1) : i / Math.max(n - 1, 1);
    const fill = lerpColor(theme.primary, theme.muted, narrowT * 0.7);
    shapes.push(
      `<polygon points="${topLeft.toFixed(1)},${y.toFixed(1)} ${topRight.toFixed(1)},${y.toFixed(1)} ${botRight.toFixed(1)},${(y + LAYER_H).toFixed(1)} ${botLeft.toFixed(1)},${(y + LAYER_H).toFixed(1)}" fill="${fill}" stroke="${theme.bg}" stroke-width="2"/>`
    );
    const midW = (topW + botW) / 2;
    const fontSize = midW > 140 ? 12 : midW > 80 ? 11 : midW > 50 ? 9 : 8;
    const textY = y + LAYER_H / 2 + fontSize / 3;
    const maxChars = Math.max(4, Math.floor(midW / 7));
    labels.push(
      `<text x="${cxPos.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="middle" font-size="${fontSize}" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, maxChars)}</text>`
    );
    if (midW < 60 && item.label) {
      const sideX = cxPos + Math.max(topW, botW) / 2 + 8;
      labels.push(
        `<text x="${sideX.toFixed(1)}" y="${textY.toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.label, 20)}</text>`
      );
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${spec.title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>` : ""}
  ${shapes.join("\n  ")}
  ${labels.join("\n  ")}
</svg>`;
}
function renderEmpty6(theme) {
  return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`;
}

// src/layouts/pyramid/inverted-pyramid.ts
function render61(spec, theme) {
  return render60(spec, theme);
}

// src/layouts/pyramid/pyramid-list.ts
function render62(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 600;
  const ROW_H = 36;
  const GAP = 6;
  const MIN_FRAC = 0.28;
  const BADGE_R = 11;
  const titleH = spec.title ? 34 : 12;
  const H = titleH + n * (ROW_H + GAP) - GAP + 20;
  const BAR_MAX = W - 80;
  const cx = W / 2;
  const parts = [];
  if (spec.title) {
    parts.push(
      `<text x="${cx}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`
    );
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const t = n > 1 ? i / (n - 1) : 1;
    const barW = BAR_MAX * (MIN_FRAC + (1 - MIN_FRAC) * t);
    const y = titleH + i * (ROW_H + GAP);
    const barX = cx - barW / 2;
    const fill = lerpColor(theme.primary, theme.muted, t * 0.65);
    parts.push(
      `<rect x="${barX.toFixed(1)}" y="${y}" width="${barW.toFixed(1)}" height="${ROW_H}" rx="5" fill="${fill}"/>`
    );
    const badgeCx = barX - BADGE_R - 5;
    const badgeCy = y + ROW_H / 2;
    parts.push(
      `<circle cx="${badgeCx.toFixed(1)}" cy="${badgeCy.toFixed(1)}" r="${BADGE_R}" fill="${fill}"/>`
    );
    parts.push(
      `<text x="${badgeCx.toFixed(1)}" y="${(badgeCy + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${theme.bg}" font-family="system-ui,sans-serif">${i + 1}</text>`
    );
    const maxChars = Math.max(5, Math.floor(barW / 7.5));
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(y + ROW_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="${theme.bg}" font-family="system-ui,sans-serif">${tt(item.label, maxChars)}</text>`
    );
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join("\n  ")}
</svg>`;
}

// src/layouts/pyramid/segmented-pyramid.ts
function render63(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 600;
  const GAP = 6;
  const LAYER_H = Math.min(58, Math.max(30, (320 - GAP * (n - 1)) / n));
  const titleH = spec.title ? 34 : 12;
  const H = titleH + n * LAYER_H + (n - 1) * GAP + 20;
  const MAX_W = W - 40;
  const MIN_W = 40;
  const cx = W / 2;
  const shapes = [];
  const labels = [];
  if (spec.title) {
    shapes.push(
      `<text x="${cx}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`
    );
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const t = n > 1 ? i / (n - 1) : 1;
    const topW = MIN_W + t * (MAX_W - MIN_W) * 0.88;
    const botW = MIN_W + (i + 1) / n * (MAX_W - MIN_W);
    const y = titleH + i * (LAYER_H + GAP);
    const tL = cx - topW / 2;
    const tR = cx + topW / 2;
    const bL = cx - botW / 2;
    const bR = cx + botW / 2;
    const fill = lerpColor(theme.primary, theme.secondary, t * 0.7);
    const border = lerpColor(theme.primary, theme.accent, t * 0.5);
    shapes.push(
      `<polygon points="${tL.toFixed(1)},${y.toFixed(1)} ${tR.toFixed(1)},${y.toFixed(1)} ${bR.toFixed(1)},${(y + LAYER_H).toFixed(1)} ${bL.toFixed(1)},${(y + LAYER_H).toFixed(1)}" fill="${fill}cc" stroke="${border}" stroke-width="1.8" stroke-linejoin="round"/>`
    );
    shapes.push(
      `<line x1="${(tL + 2).toFixed(1)}" y1="${(y + 1).toFixed(1)}" x2="${(tR - 2).toFixed(1)}" y2="${(y + 1).toFixed(1)}" stroke="${theme.bg}55" stroke-width="1.5"/>`
    );
    const midW = (topW + botW) / 2;
    const textY = y + LAYER_H / 2 + 4;
    const fontSize = midW > 130 ? 12 : midW > 80 ? 11 : 10;
    const maxChars = Math.max(4, Math.floor(midW / 7));
    labels.push(
      `<text x="${cx.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="middle" font-size="${fontSize}" font-weight="600" fill="${theme.bg}" font-family="system-ui,sans-serif">${tt(item.label, maxChars)}</text>`
    );
    if (midW < 70) {
      const sideX = cx + Math.max(topW, botW) / 2 + 8;
      labels.push(
        `<text x="${sideX.toFixed(1)}" y="${textY.toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.label, 22)}</text>`
      );
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${shapes.join("\n  ")}
  ${labels.join("\n  ")}
</svg>`;
}

// src/layouts/pyramid/diamond-pyramid.ts
function render64(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 600;
  const LAYER_H = Math.min(60, Math.max(28, 320 / n));
  const titleH = spec.title ? 34 : 12;
  const H = titleH + n * LAYER_H + 20;
  const MAX_W = W - 40;
  const MIN_W = 36;
  const cx = W / 2;
  function diamondW(p) {
    return MIN_W + (MAX_W - MIN_W) * (1 - Math.abs(2 * p - 1));
  }
  const shapes = [];
  const labels = [];
  if (spec.title) {
    shapes.push(
      `<text x="${cx}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(spec.title)}</text>`
    );
  }
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const pTop = i / n;
    const pBot = (i + 1) / n;
    const topW = diamondW(pTop);
    const botW = diamondW(pBot);
    const y = titleH + i * LAYER_H;
    const tL = cx - topW / 2;
    const tR = cx + topW / 2;
    const bL = cx - botW / 2;
    const bR = cx + botW / 2;
    const pMid = (pTop + pBot) / 2;
    const midness = 1 - Math.abs(2 * pMid - 1);
    const fill = lerpColor(theme.muted, theme.primary, 0.3 + midness * 0.7);
    shapes.push(
      `<polygon points="${tL.toFixed(1)},${y.toFixed(1)} ${tR.toFixed(1)},${y.toFixed(1)} ${bR.toFixed(1)},${(y + LAYER_H).toFixed(1)} ${bL.toFixed(1)},${(y + LAYER_H).toFixed(1)}" fill="${fill}" stroke="${theme.bg}" stroke-width="2"/>`
    );
    const midW = (topW + botW) / 2;
    const textY = y + LAYER_H / 2 + 4;
    const fontSize = midW > 130 ? 12 : midW > 80 ? 11 : 10;
    const maxChars = Math.max(4, Math.floor(midW / 7));
    labels.push(
      `<text x="${cx.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="middle" font-size="${fontSize}" font-weight="600" fill="${theme.bg}" font-family="system-ui,sans-serif">${tt(item.label, maxChars)}</text>`
    );
    if (midW < 70) {
      const sideX = cx + Math.max(topW, botW) / 2 + 8;
      labels.push(
        `<text x="${sideX.toFixed(1)}" y="${textY.toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.label, 22)}</text>`
      );
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${shapes.join("\n  ")}
  ${labels.join("\n  ")}
</svg>`;
}

// src/layouts/relationship/venn.ts
var SEP_RE = /\s*∩\s*|\s*&&\s*/;
function wrapIx(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) return [tt(text, maxChars)];
  return lines.length === 1 ? lines : [lines[0], tt(lines.slice(1).join(" "), maxChars)];
}
function svg11(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function intersectionNames(label) {
  return label.split(SEP_RE).map((s) => s.trim()).filter(Boolean);
}
function intersectionPos(names, circles, centres, allCentre, spread) {
  const pts = [];
  for (const n of names) {
    const idx = circles.findIndex((c) => c.label.toLowerCase() === n.toLowerCase());
    if (idx >= 0 && idx < centres.length) pts.push(centres[idx]);
  }
  if (pts.length === 0) return allCentre;
  const mid = {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length
  };
  if (pts.length === circles.length) return mid;
  return {
    x: allCentre.x + (mid.x - allCentre.x) * spread,
    y: allCentre.y + (mid.y - allCentre.y) * spread
  };
}
function layout2(theme, titleH) {
  const W = 560, H = 320 + titleH;
  const cy = titleH + (H - titleH) / 2;
  const R = 115;
  const overlap = 72;
  const cx1 = W / 2 - R + overlap / 2;
  const cx2 = W / 2 + R - overlap / 2;
  return {
    W,
    H,
    R,
    centres: [{ x: cx1, y: cy }, { x: cx2, y: cy }],
    labelOff: [[-R / 3.5, -10], [R / 3.5, -10]],
    colors: [theme.primary, theme.secondary]
  };
}
function layout3(theme, titleH) {
  const W = 560, H = 380 + titleH;
  const cy = titleH + (H - titleH) / 2;
  const R = 105, off = 62;
  return {
    W,
    H,
    R,
    centres: [
      { x: W / 2 - off, y: cy - off * 0.65 },
      { x: W / 2 + off, y: cy - off * 0.65 },
      { x: W / 2, y: cy + off * 0.9 }
    ],
    labelOff: [[-50, -R * 0.55], [50, -R * 0.55], [0, R * 0.6]],
    colors: [theme.primary, theme.secondary, theme.accent]
  };
}
function layout4(theme, titleH) {
  const W = 560, H = 380 + titleH;
  const cx = W / 2, cy = titleH + (H - titleH) / 2;
  const R = 105, dx = 60, dy = 44;
  return {
    W,
    H,
    R,
    centres: [
      { x: cx - dx, y: cy - dy },
      { x: cx + dx, y: cy - dy },
      { x: cx - dx, y: cy + dy },
      { x: cx + dx, y: cy + dy }
    ],
    labelOff: [
      [-R * 0.58, -R * 0.52],
      [R * 0.58, -R * 0.52],
      [-R * 0.58, R * 0.52],
      [R * 0.58, R * 0.52]
    ],
    colors: [theme.primary, theme.secondary, theme.accent, theme.primary]
  };
}
function render65(spec, theme) {
  const all = spec.items;
  const circles = all.filter((i) => !i.isIntersection).slice(0, 4);
  const intersects = all.filter((i) => i.isIntersection);
  const n = circles.length;
  if (n === 0) {
    return `<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  <text x="150" y="42" text-anchor="middle" font-size="12" fill="${theme.textMuted}" font-family="system-ui,sans-serif">No items</text>
</svg>`;
  }
  const titleH = spec.title ? 28 : 8;
  const layout = n >= 4 ? layout4(theme, titleH) : n === 3 ? layout3(theme, titleH) : layout2(theme, titleH);
  const { W, H, R, centres, labelOff, colors } = layout;
  const parts = [];
  centres.forEach((c, i) => {
    parts.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${R}" fill="${colors[i % colors.length]}28" stroke="${colors[i % colors.length]}88" stroke-width="1.5"/>`);
  });
  circles.forEach((item, i) => {
    const c = centres[i];
    const lx = c.x + labelOff[i][0];
    const ly = c.y + labelOff[i][1];
    const labelFontSize = n === 2 ? 13 : n === 3 ? 12 : 11;
    const labelMax = n === 2 ? 14 : n === 3 ? 13 : 12;
    parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="${labelFontSize}" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, labelMax)}</text>`);
    const maxChildren = n === 2 ? 4 : 2;
    item.children.slice(0, maxChildren).forEach((ch, j) => {
      const childY = ly + (n === 2 ? 12 + j * 16 : 14 + j * 13);
      const fs = n === 2 ? 10 : 8.5;
      parts.push(`<text x="${lx.toFixed(1)}" y="${childY.toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(ch.label, n === 2 ? 13 : 10)}</text>`);
    });
  });
  const allCentre = {
    x: centres.reduce((s, c) => s + c.x, 0) / centres.length,
    y: centres.reduce((s, c) => s + c.y, 0) / centres.length
  };
  const spread = n === 2 ? 1 : n === 3 ? 2 : 1.6;
  intersects.forEach((ix) => {
    const names = intersectionNames(ix.label);
    const pos = intersectionPos(names, circles, centres, allCentre, spread);
    const display = ix.value ?? names.join(" \u2229 ");
    const lines = wrapIx(display, 12);
    const lineH = n === 2 ? 13 : 11;
    const startY = pos.y - (lines.length - 1) * lineH / 2 + (n === 2 ? -4 : 3);
    const fs = n === 2 ? 11 : 9;
    const fw = n === 2 ? "500" : "600";
    lines.forEach((line, li) => {
      parts.push(`<text x="${pos.x.toFixed(1)}" y="${(startY + li * lineH).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="${fw}">${escapeXml(line)}</text>`);
    });
  });
  return svg11(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/concentric.ts
function svg12(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render66(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 500;
  const TITLE_H = spec.title ? 28 : 8;
  const H = 400 + TITLE_H;
  const cxPos = W / 2;
  const cyPos = TITLE_H + (H - TITLE_H) / 2;
  const MAX_R = Math.min(cxPos, (H - TITLE_H) / 2) - 10;
  const parts = [];
  for (let i = n - 1; i >= 0; i--) {
    const item = items[i];
    const r = MAX_R * (i + 1) / n;
    const opacityHex = Math.round(12 + (1 - i / n) * 28).toString(16).padStart(2, "0");
    parts.push(
      `<circle cx="${cxPos.toFixed(1)}" cy="${cyPos.toFixed(1)}" r="${r.toFixed(1)}" fill="${theme.primary}${opacityHex}" stroke="${theme.primary}55" stroke-width="1.2"/>`
    );
    const labelY = cyPos - (r - MAX_R / n / 2) + 14;
    parts.push(
      `<text x="${cxPos.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, 18)}</text>`
    );
  }
  return svg12(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/balance.ts
function svg13(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render67(spec, theme) {
  const left = spec.items[0] ?? { label: "Side A", children: [] };
  const right = spec.items[1] ?? { label: "Side B", children: [] };
  const W = 520, TITLE_H = spec.title ? 28 : 8, H = 300 + TITLE_H;
  const bx = W / 2, beamY = TITLE_H + 76, beamW = 400, plateW = 130, plateH = 18;
  const parts = [];
  parts.push(`<polygon points="${bx},${beamY + 4} ${bx - 18},${beamY + 44} ${bx + 18},${beamY + 44}" fill="${theme.surface}" stroke="${theme.textMuted}" stroke-width="1.5"/>`);
  parts.push(`<rect x="${bx - 30}" y="${beamY + 44}" width="60" height="8" rx="2" fill="${theme.surface}" stroke="${theme.textMuted}" stroke-width="1"/>`);
  parts.push(`<rect x="${(bx - beamW / 2).toFixed(1)}" y="${(beamY - 4).toFixed(1)}" width="${beamW}" height="8" rx="3" fill="${theme.surface}" stroke="${theme.textMuted}" stroke-width="1.5"/>`);
  const lx = bx - beamW / 2 + plateW / 2 - 6;
  parts.push(`<line x1="${lx}" y1="${beamY}" x2="${lx}" y2="${beamY + 38}" stroke="${theme.textMuted}99" stroke-width="1.5"/>`);
  parts.push(`<rect x="${(lx - plateW / 2).toFixed(1)}" y="${(beamY + 38).toFixed(1)}" width="${plateW}" height="${plateH}" rx="4" fill="${theme.primary}30" stroke="${theme.primary}77" stroke-width="1.2"/>`);
  parts.push(`<text x="${lx.toFixed(1)}" y="${(beamY + 38 + 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(left.label, 16)}</text>`);
  left.children.slice(0, 4).forEach((ch, i) => {
    parts.push(`<text x="${lx.toFixed(1)}" y="${(beamY + 66 + i * 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(ch.label, 16)}</text>`);
  });
  const rx = bx + beamW / 2 - plateW / 2 + 6;
  parts.push(`<line x1="${rx}" y1="${beamY}" x2="${rx}" y2="${beamY + 38}" stroke="${theme.textMuted}99" stroke-width="1.5"/>`);
  parts.push(`<rect x="${(rx - plateW / 2).toFixed(1)}" y="${(beamY + 38).toFixed(1)}" width="${plateW}" height="${plateH}" rx="4" fill="${theme.secondary}30" stroke="${theme.secondary}77" stroke-width="1.2"/>`);
  parts.push(`<text x="${rx.toFixed(1)}" y="${(beamY + 38 + 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(right.label, 16)}</text>`);
  right.children.slice(0, 4).forEach((ch, i) => {
    parts.push(`<text x="${rx.toFixed(1)}" y="${(beamY + 66 + i * 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(ch.label, 16)}</text>`);
  });
  return svg13(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/counterbalance.ts
function render68(spec, theme) {
  return render67(spec, theme);
}

// src/layouts/relationship/opposing-arrows.ts
function svg14(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render69(spec, theme) {
  const left = spec.items[0] ?? { label: "Force A", children: [] };
  const right = spec.items[1] ?? { label: "Force B", children: [] };
  const W = 520, TITLE_H = spec.title ? 28 : 8, H = 148 + TITLE_H;
  const cy = TITLE_H + (H - TITLE_H) / 2;
  const AH = 68, gap = 18;
  const lx1 = 8, lx2 = W / 2 - gap / 2;
  const rx1 = W / 2 + gap / 2, rx2 = W - 8;
  const parts = [];
  parts.push(`<polygon points="${lx1},${cy - AH / 2} ${lx2 - 32},${cy - AH / 2} ${lx2},${cy} ${lx2 - 32},${cy + AH / 2} ${lx1},${cy + AH / 2}" fill="${theme.primary}2a" stroke="${theme.primary}77" stroke-width="1.5"/>`);
  parts.push(`<text x="${((lx1 + lx2) / 2 - 14).toFixed(1)}" y="${(cy - 10).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(left.label, 15)}</text>`);
  left.children.slice(0, 3).forEach((ch, i) => {
    parts.push(`<text x="${((lx1 + lx2) / 2 - 14).toFixed(1)}" y="${(cy + 8 + i * 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(ch.label, 13)}</text>`);
  });
  parts.push(`<polygon points="${rx2},${cy - AH / 2} ${rx1 + 32},${cy - AH / 2} ${rx1},${cy} ${rx1 + 32},${cy + AH / 2} ${rx2},${cy + AH / 2}" fill="${theme.secondary}2a" stroke="${theme.secondary}77" stroke-width="1.5"/>`);
  parts.push(`<text x="${((rx1 + rx2) / 2 + 14).toFixed(1)}" y="${(cy - 10).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(right.label, 15)}</text>`);
  right.children.slice(0, 3).forEach((ch, i) => {
    parts.push(`<text x="${((rx1 + rx2) / 2 + 14).toFixed(1)}" y="${(cy + 8 + i * 13).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(ch.label, 13)}</text>`);
  });
  return svg14(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/web.ts
function svg15(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render70(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 520, TITLE_H = spec.title ? 28 : 8, H = 420 + TITLE_H;
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2;
  const R = 148;
  const pos = items.map((_, i) => [
    cx + R * Math.cos(2 * Math.PI * i / n - Math.PI / 2),
    cy + R * Math.sin(2 * Math.PI * i / n - Math.PI / 2)
  ]);
  const parts = [];
  const drawn = /* @__PURE__ */ new Set();
  const edge = (i, j) => {
    const k = `${Math.min(i, j)}-${Math.max(i, j)}`;
    if (drawn.has(k)) return;
    drawn.add(k);
    parts.push(`<line x1="${pos[i][0].toFixed(1)}" y1="${pos[i][1].toFixed(1)}" x2="${pos[j][0].toFixed(1)}" y2="${pos[j][1].toFixed(1)}" stroke="${theme.primary}55" stroke-width="1.8"/>`);
  };
  for (let i = 0; i < n; i++) {
    edge(i, (i + 1) % n);
    if (n <= 7) edge(i, (i + 2) % n);
    if (n <= 4) for (let j = i + 1; j < n; j++) edge(i, j);
  }
  const nodeR = Math.max(22, Math.min(34, 72 / n));
  items.forEach((item, i) => {
    const [nx, ny] = pos[i];
    parts.push(`<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${nodeR}" fill="${theme.surface}" stroke="${theme.primary}99" stroke-width="1.8"/>`);
    parts.push(`<text x="${nx.toFixed(1)}" y="${(ny + 4).toFixed(1)}" text-anchor="middle" font-size="${Math.max(8, Math.min(10, nodeR * 0.5)).toFixed(0)}" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 9)}</text>`);
  });
  return svg15(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/cluster.ts
function svg16(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render71(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const cols = n <= 2 ? n : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const W = 560, TITLE_H = spec.title ? 28 : 8, H = TITLE_H + rows * 180 + 20;
  const clW = (W - 20) / cols - 10, clH = 168;
  const colors = [theme.primary, theme.secondary, theme.accent, theme.primary, theme.secondary];
  const parts = [];
  items.forEach((group, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const gx = 10 + col * (clW + 10) + clW / 2;
    const gy = TITLE_H + 10 + row * (clH + 10) + clH / 2;
    const color = colors[i % colors.length];
    parts.push(`<ellipse cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" rx="${(clW / 2).toFixed(1)}" ry="${(clH / 2).toFixed(1)}" fill="${color}14" stroke="${color}55" stroke-width="1.5"/>`);
    parts.push(`<text x="${gx.toFixed(1)}" y="${(gy - clH / 2 + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(group.label, 16)}</text>`);
    const members = group.children;
    const mCount = Math.min(members.length, 6);
    const mCols = mCount === 0 ? 1 : mCount <= 3 ? mCount : Math.ceil(mCount / 2);
    const nRows = Math.max(1, Math.ceil(mCount / mCols));
    const marginFrac = mCols <= 1 ? 0 : mCols === 2 ? 0.26 : 0.18;
    const useableSpan = mCols > 1 ? clW * (1 - 2 * marginFrac) : 0;
    const stepSize = mCols > 1 ? useableSpan / (mCols - 1) : 0;
    const ellipseMargin = 8;
    const minGap = 8;
    const mRFromEllipse = clW / 2 - (mCols > 1 ? useableSpan / 2 : 0) - ellipseMargin;
    const mRFromGap = mCols > 1 ? (stepSize - minGap) / 2 : Infinity;
    let mR = Math.max(13, Math.min(40, Math.floor(Math.min(mRFromEllipse, mRFromGap))));
    let verticalOffset = nRows === 1 ? 9 : 0;
    if (nRows > 1) {
      const xFar = useableSpan / 2;
      while (mR > 13) {
        verticalOffset = Math.max(0, 2 * mR - 52);
        const yFar = verticalOffset + mR + 4;
        const rxEff = clW / 2 - ellipseMargin;
        const ryEff = clH / 2 - ellipseMargin;
        if (xFar * xFar / (rxEff - mR) ** 2 + yFar * yFar / (ryEff - mR) ** 2 <= 1) break;
        mR--;
      }
    }
    const rowSpacing = mR * 2 + 8;
    const blockH = (nRows - 1) * rowSpacing;
    const firstRowY = gy + verticalOffset - blockH / 2;
    const fontSize = mR >= 22 ? 9 : mR >= 16 ? 8 : 7;
    const labelMax = Math.max(5, Math.floor(mR * 0.55));
    members.slice(0, 6).forEach((m, j) => {
      const mc = j % mCols, mr = Math.floor(j / mCols);
      const offset = mCols === 1 ? 0 : -useableSpan / 2 + mc * stepSize;
      const mx = gx + offset;
      const my = firstRowY + mr * rowSpacing;
      parts.push(`<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${mR}" fill="${color}2a" stroke="${color}66" stroke-width="1"/>`);
      parts.push(`<text x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="middle" font-size="${fontSize}" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(m.label, labelMax)}</text>`);
    });
  });
  return svg16(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/target.ts
function svg17(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render72(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const W = 480, TITLE_H = spec.title ? 28 : 8, H = 380 + TITLE_H;
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2;
  const MAX_R = Math.min(cx - 10, (H - TITLE_H) / 2 - 12);
  const parts = [];
  parts.push(`<line x1="${cx - MAX_R - 6}" y1="${cy}" x2="${cx + MAX_R + 6}" y2="${cy}" stroke="${theme.border}28" stroke-width="1"/>`);
  parts.push(`<line x1="${cx}" y1="${cy - MAX_R - 6}" x2="${cx}" y2="${cy + MAX_R + 6}" stroke="${theme.border}28" stroke-width="1"/>`);
  for (let i = n - 1; i >= 0; i--) {
    const r = MAX_R * (i + 1) / n;
    const t = i / Math.max(n - 1, 1);
    const fillAlpha = Math.round(14 + (1 - t) * 36).toString(16).padStart(2, "0");
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${theme.primary}${fillAlpha}" stroke="${theme.primary}66" stroke-width="1.5"/>`);
    const bandR = r - MAX_R / n / 2;
    parts.push(`<text x="${cx}" y="${(cy - bandR + 5).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="${i === n - 1 ? "700" : "400"}">${tt(items[i].label, 18)}</text>`);
  }
  return svg17(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/radial.ts
function render73(spec, theme) {
  const centerLabel = spec.title ?? spec.items[0]?.label ?? "Hub";
  const spokes = spec.title ? spec.items : spec.items.slice(1);
  const n = spokes.length || 1;
  const W = 560, H = 440;
  const cx = W / 2, cy = H / 2;
  const R = 158;
  const CR = 38;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    const sx = cx + R * Math.cos(angle), sy = cy + R * Math.sin(angle);
    const lx = cx + CR * Math.cos(angle), ly = cy + CR * Math.sin(angle);
    const item = spokes[i];
    parts.push(`<line x1="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${theme.textMuted}" stroke-width="1.5"/>`);
    if (item) {
      parts.push(`<rect x="${(sx - 52).toFixed(1)}" y="${(sy - 18).toFixed(1)}" width="104" height="36" rx="5" fill="${theme.surface}" stroke="${theme.primary}66" stroke-width="1.2"/>`);
      parts.push(`<text x="${sx.toFixed(1)}" y="${(sy + 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 12)}</text>`);
      const above = Math.sin(angle) < -0.1;
      item.children.slice(0, 2).forEach((ch, j) => {
        const offY = above ? sy - 26 - j * 13 : sy + 30 + j * 13;
        parts.push(`<text x="${sx.toFixed(1)}" y="${offY.toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(ch.label, 12)}</text>`);
      });
    }
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${CR}" fill="${theme.surface}" stroke="${theme.accent}" stroke-width="1.5"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${CR}" fill="${theme.accent}22" stroke="none"/>`);
  const cw = centerLabel.split(" ");
  if (cw.length === 1) {
    parts.push(`<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(centerLabel, 12)}</text>`);
  } else {
    const m = Math.ceil(cw.length / 2);
    parts.push(`<text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(cw.slice(0, m).join(" "), 12)}</text>`);
    parts.push(`<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(cw.slice(m).join(" "), 12)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${parts.join("\n  ")}
</svg>`;
}

// src/layouts/relationship/converging.ts
function svg18(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render74(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const sources = items.length > 1 ? items.slice(0, -1) : items;
  const target = items.length > 1 ? items[items.length - 1] : { label: spec.title ?? "Result", children: [] };
  const n = sources.length;
  const W = 520, TITLE_H = spec.title ? 28 : 8;
  const ROW_H = Math.max(44, Math.min(60, 300 / n));
  const H = Math.max(200, n * ROW_H + TITLE_H + 40);
  const cy = TITLE_H + (H - TITLE_H) / 2;
  const SRC_X = 10, TGT_X = W - 130;
  const parts = [];
  parts.push(`<defs><marker id="arr-c" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L7,4 L0,8 Z" fill="${theme.accent}cc"/></marker></defs>`);
  const tBH = Math.min(64, n * 18 + 20);
  parts.push(`<rect x="${TGT_X}" y="${(cy - tBH / 2).toFixed(1)}" width="116" height="${tBH}" rx="6" fill="${theme.accent}28" stroke="${theme.accent}" stroke-width="1.5"/>`);
  const tw = target.label.split(" "), tm = Math.ceil(tw.length / 2);
  parts.push(`<text x="${(TGT_X + 58).toFixed(1)}" y="${tw.length > 1 ? (cy - 2).toFixed(1) : (cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(tw.slice(0, tm).join(" "), 13)}</text>`);
  if (tw.length > 1) parts.push(`<text x="${(TGT_X + 58).toFixed(1)}" y="${(cy + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(tw.slice(tm).join(" "), 13)}</text>`);
  sources.forEach((item, i) => {
    const sy = n === 1 ? cy : TITLE_H + 20 + i * (H - TITLE_H - 40) / (n - 1);
    parts.push(`<rect x="${SRC_X}" y="${(sy - 16).toFixed(1)}" width="112" height="32" rx="5" fill="${theme.surface}" stroke="${theme.primary}66" stroke-width="1.2"/>`);
    parts.push(`<text x="${(SRC_X + 56).toFixed(1)}" y="${(sy + 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, 13)}</text>`);
    const x1 = SRC_X + 112, x2 = TGT_X - 4;
    const mid = (x1 + x2) / 2;
    parts.push(`<path d="M${x1},${sy.toFixed(1)} C${mid},${sy.toFixed(1)} ${mid},${cy.toFixed(1)} ${x2},${cy.toFixed(1)}" fill="none" stroke="${theme.primary}66" stroke-width="1.5" marker-end="url(#arr-c)"/>`);
  });
  return svg18(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/diverging.ts
function svg19(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render75(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const source = items[0];
  const targets = items.length > 1 ? items.slice(1) : [{ label: spec.title ?? "Output", children: [] }];
  const n = targets.length;
  const W = 520, TITLE_H = spec.title ? 28 : 8;
  const ROW_H = Math.max(44, Math.min(60, 300 / n));
  const H = Math.max(200, n * ROW_H + TITLE_H + 40);
  const cy = TITLE_H + (H - TITLE_H) / 2;
  const SRC_X = 10, TGT_X = W - 122;
  const parts = [];
  parts.push(`<defs><marker id="arr-d" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L7,4 L0,8 Z" fill="${theme.primary}cc"/></marker></defs>`);
  const sBH = Math.min(64, n * 18 + 20);
  parts.push(`<rect x="${SRC_X}" y="${(cy - sBH / 2).toFixed(1)}" width="116" height="${sBH}" rx="6" fill="${theme.primary}28" stroke="${theme.primary}" stroke-width="1.5"/>`);
  const sw = source.label.split(" "), sm2 = Math.ceil(sw.length / 2);
  parts.push(`<text x="${(SRC_X + 58).toFixed(1)}" y="${sw.length > 1 ? (cy - 2).toFixed(1) : (cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(sw.slice(0, sm2).join(" "), 13)}</text>`);
  if (sw.length > 1) parts.push(`<text x="${(SRC_X + 58).toFixed(1)}" y="${(cy + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(sw.slice(sm2).join(" "), 13)}</text>`);
  targets.forEach((item, i) => {
    const ty = n === 1 ? cy : TITLE_H + 20 + i * (H - TITLE_H - 40) / (n - 1);
    parts.push(`<rect x="${TGT_X}" y="${(ty - 16).toFixed(1)}" width="112" height="32" rx="5" fill="${theme.surface}" stroke="${theme.secondary}66" stroke-width="1.2"/>`);
    parts.push(`<text x="${(TGT_X + 56).toFixed(1)}" y="${(ty + 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, 13)}</text>`);
    const x1 = SRC_X + 116 + 4, x2 = TGT_X;
    const mid = (x1 + x2) / 2;
    parts.push(`<path d="M${x1},${cy.toFixed(1)} C${mid},${cy.toFixed(1)} ${mid},${ty.toFixed(1)} ${x2},${ty.toFixed(1)}" fill="none" stroke="${theme.secondary}66" stroke-width="1.5" marker-end="url(#arr-d)"/>`);
  });
  return svg19(W, H, theme, spec.title, parts);
}

// src/layouts/relationship/plus.ts
function svg20(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render76(spec, theme) {
  const items = spec.items;
  const W = 500, TITLE_H = spec.title ? 28 : 8, H = 400 + TITLE_H;
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2;
  const ARM = 130, BW = 106, BH = 50, CR = 30;
  const pos = [[cx, cy - ARM], [cx + ARM, cy], [cx, cy + ARM], [cx - ARM, cy]];
  const colors = [theme.primary, theme.secondary, theme.accent, theme.primary];
  const parts = [];
  const armColor = `${theme.primary}55`;
  parts.push(`<line x1="${cx}" y1="${cy - ARM + BH / 2}" x2="${cx}" y2="${cy - CR}" stroke="${armColor}" stroke-width="12"/>`);
  parts.push(`<line x1="${cx}" y1="${cy + CR}" x2="${cx}" y2="${cy + ARM - BH / 2}" stroke="${armColor}" stroke-width="12"/>`);
  parts.push(`<line x1="${cx - ARM + BW / 2}" y1="${cy}" x2="${cx - CR}" y2="${cy}" stroke="${armColor}" stroke-width="12"/>`);
  parts.push(`<line x1="${cx + CR}" y1="${cy}" x2="${cx + ARM - BW / 2}" y2="${cy}" stroke="${armColor}" stroke-width="12"/>`);
  const centerItem = items[4];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${CR}" fill="${theme.accent}33" stroke="${theme.accent}" stroke-width="1.5"/>`);
  if (centerItem) parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(centerItem.label, 9)}</text>`);
  items.slice(0, 4).forEach((item, i) => {
    const [px, py] = pos[i];
    parts.push(`<rect x="${(px - BW / 2).toFixed(1)}" y="${(py - BH / 2).toFixed(1)}" width="${BW}" height="${BH}" rx="6" fill="${theme.surface}" stroke="${colors[i]}88" stroke-width="1.5"/>`);
    parts.push(`<text x="${px.toFixed(1)}" y="${(py - 7).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(item.label, 13)}</text>`);
    item.children.slice(0, 2).forEach((ch, j) => {
      parts.push(`<text x="${px.toFixed(1)}" y="${(py + 9 + j * 12).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(ch.label, 14)}</text>`);
    });
  });
  return svg20(W, H, theme, spec.title, parts);
}

// src/layouts/statistical/progress-list.ts
function svg21(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render77(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 520;
  const ROW_H = 40;
  const LABEL_W = 155;
  const BAR_X = LABEL_W + 20;
  const BAR_W = W - BAR_X - 52;
  const TITLE_H = spec.title ? 30 : 10;
  const H = TITLE_H + items.length * ROW_H + 12;
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const y = TITLE_H + i * ROW_H + 4;
    const barY = y + 11;
    const raw = (item.value ?? item.attrs[0] ?? "0").replace("%", "");
    const num = parseFloat(raw);
    const pct = isNaN(num) ? 0 : num > 1 ? Math.min(num, 100) : num * 100;
    const fillW = Math.max(0, BAR_W * pct / 100);
    const barColor = pct >= 70 ? theme.accent : pct >= 40 ? theme.warning : theme.danger;
    rows.push(
      `<rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="16" rx="8" fill="${theme.muted}33"/>`,
      `<rect x="${BAR_X}" y="${barY}" width="${fillW.toFixed(1)}" height="16" rx="8" fill="${barColor}"/>`,
      `<text x="${LABEL_W}" y="${barY + 11}" text-anchor="end" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, 20)}</text>`,
      `<text x="${BAR_X + BAR_W + 8}" y="${barY + 11}" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${pct % 1 === 0 ? pct : pct.toFixed(1)}%</text>`
    );
  }
  return svg21(W, H, theme, spec.title, rows);
}

// src/layouts/statistical/bullet-chart.ts
function svg22(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render78(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 520, ROW_H = 46, LABEL_W = 150, BAR_X = LABEL_W + 16;
  const BAR_W = W - BAR_X - 48, BAR_H = 18;
  const TITLE_H = spec.title ? 30 : 10;
  const H = TITLE_H + items.length * ROW_H + 12;
  const parts = [];
  items.forEach((item, i) => {
    const y = TITLE_H + i * ROW_H;
    const midY = y + ROW_H / 2;
    const barY = midY - BAR_H / 2;
    const raw = (item.value ?? item.attrs[0] ?? "0").replace("%", "");
    const val = Math.min(parseFloat(raw) || 0, 100) / 100;
    const targetRaw = item.attrs[1] ?? item.attrs.find((a) => a !== item.attrs[0] && /^\d/.test(a));
    const target = targetRaw ? Math.min(parseFloat(targetRaw.replace("%", "")) || 0, 100) / 100 : null;
    parts.push(`<rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="${BAR_H}" rx="3" fill="${theme.muted}40"/>`);
    parts.push(`<rect x="${BAR_X}" y="${barY}" width="${(BAR_W * 0.7).toFixed(1)}" height="${BAR_H}" rx="3" fill="${theme.muted}5a"/>`);
    parts.push(`<rect x="${BAR_X}" y="${barY}" width="${(BAR_W * 0.4).toFixed(1)}" height="${BAR_H}" rx="3" fill="${theme.muted}80"/>`);
    const actH = BAR_H * 0.6, actY = barY + (BAR_H - actH) / 2;
    const barColor = val >= 0.7 ? theme.accent : val >= 0.4 ? theme.warning : theme.danger;
    parts.push(`<rect x="${BAR_X}" y="${actY.toFixed(1)}" width="${(BAR_W * val).toFixed(1)}" height="${actH.toFixed(1)}" rx="2" fill="${barColor}"/>`);
    if (target !== null) {
      const tx = BAR_X + BAR_W * target;
      parts.push(`<rect x="${(tx - 1.5).toFixed(1)}" y="${barY}" width="3" height="${BAR_H}" rx="1" fill="${theme.text}cc"/>`);
    }
    parts.push(`<text x="${LABEL_W}" y="${(midY + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, 20)}</text>`);
    parts.push(`<text x="${BAR_X + BAR_W + 8}" y="${(midY + 4).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${Math.round(val * 100)}%</text>`);
  });
  return svg22(W, H, theme, spec.title, parts);
}

// src/layouts/statistical/scorecard.ts
function svg23(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render79(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const cols = items.length <= 2 ? items.length : items.length <= 4 ? 2 : Math.min(4, items.length);
  const rows = Math.ceil(items.length / cols);
  const W = 600;
  const TITLE_H = spec.title ? 30 : 8;
  const GAP = 12;
  const CARD_W = (W - (cols + 1) * GAP) / cols;
  const CARD_H = 76;
  const H = TITLE_H + rows * (CARD_H + GAP) + GAP;
  const cards = [];
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = GAP + col * (CARD_W + GAP);
    const y = TITLE_H + GAP + row * (CARD_H + GAP);
    const value = item.value ?? item.attrs[0] ?? "\u2014";
    const change = item.attrs.find((a) => /^[+\-]/.test(a));
    const changeColor = change?.startsWith("+") ? theme.accent : theme.danger;
    cards.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CARD_W.toFixed(1)}" height="${CARD_H}" rx="8" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`,
      `<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(y + 32).toFixed(1)}" text-anchor="middle" font-size="22" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="700">${escapeXml(value)}</text>`,
      `<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(y + 50).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.label, 20)}</text>`
    );
    if (change) {
      cards.push(`<text x="${(x + CARD_W / 2).toFixed(1)}" y="${(y + 65).toFixed(1)}" text-anchor="middle" font-size="10" fill="${changeColor}" font-family="system-ui,sans-serif">${escapeXml(change)}</text>`);
    }
  });
  return svg23(W, H, theme, spec.title, cards);
}

// src/layouts/statistical/treemap.ts
function svg24(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render80(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 600;
  const TITLE_H = spec.title ? 30 : 8;
  const H = 320;
  const CONTENT_H = H - TITLE_H - 8;
  const colors = [theme.primary, theme.secondary, theme.accent, theme.muted, ...theme.palette];
  const cells = [];
  const cols = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / cols);
  const cellW = W / cols;
  const cellH = CONTENT_H / rows;
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cellW;
    const y = TITLE_H + 4 + row * cellH;
    const fill = colors[i % colors.length];
    cells.push(
      `<rect x="${(x + 2).toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${(cellW - 4).toFixed(1)}" height="${(cellH - 4).toFixed(1)}" rx="6" fill="${fill}55" stroke="${fill}99" stroke-width="1"/>`,
      `<text x="${(x + cellW / 2).toFixed(1)}" y="${(y + cellH / 2).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, Math.floor(cellW / 8))}</text>`
    );
    if (item.value) {
      cells.push(`<text x="${(x + cellW / 2).toFixed(1)}" y="${(y + cellH / 2 + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${escapeXml(item.value)}</text>`);
    }
  });
  return svg24(W, H, theme, spec.title, cells);
}

// src/layouts/statistical/sankey.ts
function svg25(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render81(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const colors = [theme.primary, theme.secondary, theme.accent, theme.muted, ...theme.palette];
  const srcW = items.map((it) => Math.max(1, parseFloat((it.value ?? it.attrs[0] ?? "1").replace("%", "")) || 1));
  const totalSrc = srcW.reduce((a, b) => a + b, 0);
  const dstMap = /* @__PURE__ */ new Map();
  const flows = [];
  items.forEach((it, si) => {
    const perChild = srcW[si] / Math.max(it.children.length, 1);
    it.children.forEach((ch) => {
      const fw = Math.max(1, parseFloat((ch.value ?? ch.attrs[0] ?? "0").replace("%", "")) || perChild);
      flows.push({ si, dst: ch.label, w: fw });
      dstMap.set(ch.label, (dstMap.get(ch.label) ?? 0) + fw);
    });
  });
  const dstNames = [...dstMap.keys()];
  const totalDst = [...dstMap.values()].reduce((a, b) => a + b, 0) || totalSrc;
  const W = 520, TITLE_H = spec.title ? 30 : 10;
  const BOX_W2 = 112, GAP = 8, CONTENT_H = 280;
  const H = TITLE_H + CONTENT_H + GAP * 2;
  const srcScale = (CONTENT_H - (items.length - 1) * GAP) / totalSrc;
  const srcNodes = [];
  let sy = TITLE_H + GAP;
  items.forEach((_, i) => {
    const h = Math.max(18, srcW[i] * srcScale);
    srcNodes.push({ y: sy, h });
    sy += h + GAP;
  });
  const dstScale = (CONTENT_H - (dstNames.length - 1) * GAP) / totalDst;
  const dstNodes = /* @__PURE__ */ new Map();
  let dy = TITLE_H + GAP;
  dstNames.forEach((name) => {
    const h = Math.max(18, (dstMap.get(name) ?? 1) * dstScale);
    dstNodes.set(name, { y: dy, h });
    dy += h + GAP;
  });
  const parts = [];
  const srcYCur = srcNodes.map((n) => n.y);
  const dstYCur = new Map(dstNames.map((n) => [n, dstNodes.get(n).y]));
  const x0 = BOX_W2, x1 = W - BOX_W2, mx = (x0 + x1) / 2;
  flows.forEach((f) => {
    const src = srcNodes[f.si];
    const dst = dstNodes.get(f.dst);
    if (!src || !dst) return;
    const fwSrc = f.w / srcW[f.si] * src.h;
    const fwDst = f.w / (dstMap.get(f.dst) ?? 1) * dst.h;
    const sy0 = srcYCur[f.si], sy1 = sy0 + fwSrc;
    srcYCur[f.si] += fwSrc;
    const dy0 = dstYCur.get(f.dst), dy1 = dy0 + fwDst;
    dstYCur.set(f.dst, dy1);
    const col = colors[f.si % colors.length];
    parts.push(`<path d="M${x0},${sy0.toFixed(1)} C${mx},${sy0.toFixed(1)} ${mx},${dy0.toFixed(1)} ${x1},${dy0.toFixed(1)} L${x1},${dy1.toFixed(1)} C${mx},${dy1.toFixed(1)} ${mx},${sy1.toFixed(1)} ${x0},${sy1.toFixed(1)} Z" fill="${col}3a" stroke="${col}77" stroke-width="0.5"/>`);
  });
  srcNodes.forEach((n, i) => {
    const col = colors[i % colors.length];
    parts.push(`<rect x="0" y="${n.y.toFixed(1)}" width="${BOX_W2 - 8}" height="${n.h.toFixed(1)}" rx="4" fill="${col}44" stroke="${col}99" stroke-width="1"/>`);
    if (n.h >= 14) parts.push(`<text x="${(BOX_W2 - 8) / 2}" y="${(n.y + n.h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(items[i].label, 13)}</text>`);
  });
  dstNames.forEach((name) => {
    const n = dstNodes.get(name);
    parts.push(`<rect x="${W - BOX_W2 + 8}" y="${n.y.toFixed(1)}" width="${BOX_W2 - 8}" height="${n.h.toFixed(1)}" rx="4" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`);
    if (n.h >= 14) parts.push(`<text x="${W - (BOX_W2 - 8) / 2}" y="${(n.y + n.h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(name, 13)}</text>`);
  });
  return svg25(W, H, theme, spec.title, parts);
}

// src/layouts/statistical/waffle.ts
function svg26(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render82(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const colors = [theme.primary, theme.secondary, theme.accent, theme.muted, ...theme.palette];
  const rawVals = items.map((it) => Math.max(0, parseFloat((it.value ?? it.attrs[0] ?? "0").replace("%", "")) || 0));
  const total = rawVals.reduce((a, b) => a + b, 0) || 100;
  let squares = rawVals.map((v) => Math.round(v / total * 100));
  const diff = 100 - squares.reduce((a, b) => a + b, 0);
  if (diff !== 0) squares[0] = Math.max(0, squares[0] + diff);
  const GRID = 10, SQ = 18, GAP = 3, PAD = 16;
  const GRID_W = GRID * (SQ + GAP) - GAP;
  const LEGEND_H = items.length * 22 + 10;
  const W = Math.max(GRID_W + PAD * 2, 280);
  const gridOffX = (W - GRID_W) / 2;
  const TITLE_H = spec.title ? 30 : 10;
  const H = TITLE_H + PAD + GRID * (SQ + GAP) - GAP + PAD + LEGEND_H;
  const sqColor = [];
  items.forEach((_, gi) => {
    for (let s = 0; s < squares[gi]; s++) sqColor.push(colors[gi % colors.length]);
  });
  const parts = [];
  for (let sq = 0; sq < 100; sq++) {
    const col = sq % GRID, row = Math.floor(sq / GRID);
    const x = gridOffX + col * (SQ + GAP), y = TITLE_H + PAD + row * (SQ + GAP);
    const fill = sqColor[sq] ? sqColor[sq] : `${theme.muted}22`;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${SQ}" height="${SQ}" rx="2" fill="${fill}"/>`);
  }
  const legY = TITLE_H + PAD + GRID * (SQ + GAP) + 6;
  items.forEach((item, i) => {
    const ly = legY + i * 22;
    parts.push(`<rect x="${PAD}" y="${ly}" width="12" height="12" rx="2" fill="${colors[i % colors.length]}"/>`);
    parts.push(`<text x="${PAD + 16}" y="${ly + 10}" font-size="10" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, 22)} (${squares[i]}%)</text>`);
  });
  return svg26(W, H, theme, spec.title, parts);
}

// src/layouts/statistical/gauge.ts
function svg27(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render83(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const n = items.length;
  const GW = n <= 1 ? 240 : n <= 2 ? 220 : n <= 3 ? 180 : 150;
  const W = n * GW, TITLE_H = spec.title ? 30 : 10;
  const GH = GW * 0.62, H = TITLE_H + GH + 36;
  const parts = [];
  items.forEach((item, i) => {
    const cx = GW * i + GW / 2, cy = TITLE_H + GH * 0.88;
    const R = GW * 0.37, SW = R * 0.17;
    const raw = (item.value ?? item.attrs[0] ?? "0").replace("%", "");
    const val = Math.min(Math.max(parseFloat(raw) || 0, 0), 100) / 100;
    const lx = cx - R, rx = cx + R;
    parts.push(`<path d="M${lx},${cy} A${R},${R} 0 0,1 ${rx},${cy}" fill="none" stroke="${theme.muted}44" stroke-width="${SW}" stroke-linecap="round"/>`);
    if (val > 0) {
      const angle = Math.PI * (1 - val);
      const ex = cx + R * Math.cos(angle), ey = cy - R * Math.sin(angle);
      const largeArc = 0;
      const col = val >= 0.7 ? theme.accent : val >= 0.4 ? theme.warning : theme.danger;
      parts.push(`<path d="M${lx},${cy} A${R},${R} 0 ${largeArc},1 ${ex.toFixed(1)},${ey.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${SW}" stroke-linecap="round"/>`);
      parts.push(`<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="${(SW / 2).toFixed(1)}" fill="${col}"/>`);
    }
    const fs = Math.max(16, Math.round(GW * 0.15));
    parts.push(`<text x="${cx}" y="${(cy - 6).toFixed(1)}" text-anchor="middle" font-size="${fs}" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${Math.round(val * 100)}%</text>`);
    parts.push(`<text x="${cx}" y="${(cy + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(item.label, 16)}</text>`);
  });
  return svg27(W, H, theme, spec.title, parts);
}

// src/layouts/statistical/radar.ts
function svg28(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render84(spec, theme) {
  const items = spec.items;
  if (items.length < 3) return renderEmpty(theme);
  const n = items.length;
  const W = 480, TITLE_H = spec.title ? 30 : 10, H = 380 + TITLE_H;
  const cx = W / 2, cy = TITLE_H + (H - TITLE_H) / 2;
  const R = Math.min(cx - 80, (H - TITLE_H) / 2 - 44);
  const parts = [];
  const vals = items.map((it) => {
    const raw = (it.value ?? it.attrs[0] ?? "0").replace("%", "");
    return Math.min(Math.max(parseFloat(raw) || 0, 0), 100) / 100;
  });
  for (let ring = 1; ring <= 4; ring++) {
    const r = R * ring / 4;
    const pts = items.map((_, i) => {
      const a = 2 * Math.PI * i / n - Math.PI / 2;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    });
    parts.push(`<polygon points="${pts.join(" ")}" fill="none" stroke="${theme.border}99" stroke-width="0.8"/>`);
    parts.push(`<text x="${cx}" y="${(cy - r + 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.textMuted}" font-family="system-ui,sans-serif" opacity="0.7">${ring * 25}%</text>`);
  }
  items.forEach((_, i) => {
    const a = 2 * Math.PI * i / n - Math.PI / 2;
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${(cx + R * Math.cos(a)).toFixed(1)}" y2="${(cy + R * Math.sin(a)).toFixed(1)}" stroke="${theme.border}66" stroke-width="1"/>`);
  });
  const vpts = items.map((_, i) => {
    const a = 2 * Math.PI * i / n - Math.PI / 2;
    const r = R * vals[i];
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  });
  parts.push(`<polygon points="${vpts.join(" ")}" fill="${theme.primary}2e" stroke="${theme.primary}" stroke-width="1.8"/>`);
  items.forEach((item, i) => {
    const a = 2 * Math.PI * i / n - Math.PI / 2;
    const vr = R * vals[i];
    parts.push(`<circle cx="${(cx + vr * Math.cos(a)).toFixed(1)}" cy="${(cy + vr * Math.sin(a)).toFixed(1)}" r="4" fill="${theme.accent}"/>`);
    const la = R + 26;
    const lx = cx + la * Math.cos(a), ly = cy + la * Math.sin(a);
    const anchor = Math.cos(a) > 0.15 ? "start" : Math.cos(a) < -0.15 ? "end" : "middle";
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(item.label, 12)}</text>`);
  });
  return svg28(W, H, theme, spec.title, parts);
}

// src/layouts/statistical/heatmap.ts
function svg29(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render85(spec, theme) {
  const rows = spec.items;
  if (rows.length === 0) return renderEmpty(theme);
  const numCols = Math.max(...rows.map((r) => r.children.length), 1);
  const CELL_W = Math.min(88, Math.max(46, 520 / numCols));
  const LABEL_W = 100, CELL_H = 40, HEADER_H = 28;
  const TITLE_H = spec.title ? 30 : 8;
  const W = LABEL_W + numCols * CELL_W;
  const H = TITLE_H + HEADER_H + rows.length * CELL_H + 8;
  const allVals = [];
  rows.forEach((r) => r.children.forEach((c) => {
    const raw = (c.value ?? c.attrs[0] ?? c.label.match(/[\d.]+/)?.[0] ?? "0").replace("%", "");
    allVals.push(parseFloat(raw) || 0);
  }));
  const maxVal = Math.max(...allVals, 1);
  const parts = [];
  const derivedCols = rows[0]?.children.map((ch) => ch.label) ?? [];
  const colHeaders = Array.from(
    { length: numCols },
    (_, c) => spec.columns?.[c] ?? derivedCols[c] ?? String.fromCharCode(65 + c)
  );
  const colHeaderMax = Math.floor(CELL_W / 6);
  parts.push(`<rect x="0" y="${TITLE_H}" width="${LABEL_W}" height="${HEADER_H}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="0.5"/>`);
  for (let c = 0; c < numCols; c++) {
    const colX = LABEL_W + c * CELL_W;
    parts.push(`<rect x="${colX}" y="${TITLE_H}" width="${CELL_W}" height="${HEADER_H}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="0.5"/>`);
    parts.push(`<text x="${(colX + CELL_W / 2).toFixed(1)}" y="${(TITLE_H + 19).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${tt(colHeaders[c], colHeaderMax)}</text>`);
  }
  rows.forEach((row, r) => {
    const rowY = TITLE_H + HEADER_H + r * CELL_H;
    parts.push(`<rect x="0" y="${rowY}" width="${LABEL_W}" height="${CELL_H}" fill="${theme.surface}" stroke="${theme.border}" stroke-width="0.5"/>`);
    parts.push(`<text x="8" y="${(rowY + 25).toFixed(1)}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(row.label, 12)}</text>`);
    row.children.slice(0, numCols).forEach((cell, c) => {
      const colX = LABEL_W + c * CELL_W;
      const raw = (cell.value ?? cell.attrs[0] ?? cell.label.match(/[\d.]+/)?.[0] ?? "0").replace("%", "");
      const v = Math.min((parseFloat(raw) || 0) / maxVal, 1);
      const alpha = Math.round(18 + v * 210).toString(16).padStart(2, "0");
      parts.push(`<rect x="${colX}" y="${rowY}" width="${CELL_W}" height="${CELL_H}" fill="${theme.primary}${alpha}" stroke="${theme.border}55" stroke-width="0.5"/>`);
      const textFill = v > 0.55 ? theme.bg : theme.text;
      const cellText = cell.value ?? cell.label;
      parts.push(`<text x="${(colX + CELL_W / 2).toFixed(1)}" y="${(rowY + 25).toFixed(1)}" text-anchor="middle" font-size="10" fill="${textFill}" font-family="system-ui,sans-serif">${escapeXml(tt(cellText, 9))}</text>`);
    });
  });
  return svg29(W, H, theme, spec.title, parts);
}

// src/layouts/planning/kanban.ts
function svgWrap8(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render86(spec, theme) {
  const columns = spec.items;
  if (columns.length === 0) return renderEmpty(theme);
  const W = 600;
  const TITLE_H = spec.title ? 30 : 8;
  const n = columns.length;
  const GAP = 10;
  const COL_W = (W - (n + 1) * GAP) / n;
  const HEADER_H = 34;
  const CARD_H = 28;
  const CARD_GAP = 6;
  const PAD = 8;
  const maxCards = Math.max(...columns.map((c) => c.children.length), 0);
  const colBodyH = maxCards * (CARD_H + CARD_GAP) + PAD;
  const COL_H = HEADER_H + colBodyH + PAD;
  const H = TITLE_H + 8 + COL_H + 12;
  const parts = [];
  columns.forEach((col, ci) => {
    const colX = GAP + ci * (COL_W + GAP);
    const colY = TITLE_H + 8;
    parts.push(`<rect x="${colX.toFixed(1)}" y="${colY.toFixed(1)}" width="${COL_W.toFixed(1)}" height="${COL_H}" rx="8" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`);
    parts.push(`<path d="M${(colX + 8).toFixed(1)},${colY.toFixed(1)} Q${colX.toFixed(1)},${colY.toFixed(1)} ${colX.toFixed(1)},${(colY + 8).toFixed(1)} L${colX.toFixed(1)},${(colY + HEADER_H).toFixed(1)} L${(colX + COL_W).toFixed(1)},${(colY + HEADER_H).toFixed(1)} L${(colX + COL_W).toFixed(1)},${(colY + 8).toFixed(1)} Q${(colX + COL_W).toFixed(1)},${colY.toFixed(1)} ${(colX + COL_W - 8).toFixed(1)},${colY.toFixed(1)} Z" fill="${theme.accent}22"/>`);
    parts.push(`<text x="${(colX + COL_W / 2).toFixed(1)}" y="${(colY + 21).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${tt(col.label, 14)}</text>`);
    if (col.children.length > 0) {
      const bx = colX + COL_W - 18;
      parts.push(
        `<circle cx="${bx.toFixed(1)}" cy="${(colY + 17).toFixed(1)}" r="9" fill="${theme.accent}44"/>`,
        `<text x="${bx.toFixed(1)}" y="${(colY + 21).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.text}" font-family="system-ui,sans-serif">${col.children.length}</text>`
      );
    }
    parts.push(`<line x1="${colX}" y1="${(colY + HEADER_H).toFixed(1)}" x2="${(colX + COL_W).toFixed(1)}" y2="${(colY + HEADER_H).toFixed(1)}" stroke="${theme.border}" stroke-width="1"/>`);
    col.children.forEach((card, idx) => {
      const cardX = colX + PAD;
      const cardY = colY + HEADER_H + PAD + idx * (CARD_H + CARD_GAP);
      const cardW = COL_W - PAD * 2;
      const isDone2 = card.attrs.includes("done");
      parts.push(
        `<rect x="${cardX.toFixed(1)}" y="${cardY.toFixed(1)}" width="${cardW.toFixed(1)}" height="${CARD_H}" rx="5" fill="${theme.bg}" stroke="${theme.border}" stroke-width="1"/>`,
        `<text x="${(cardX + 10).toFixed(1)}" y="${(cardY + 17).toFixed(1)}" font-size="11" fill="${isDone2 ? theme.muted : theme.text}" font-family="system-ui,sans-serif" ${isDone2 ? 'text-decoration="line-through"' : ""}>${tt(card.label, Math.floor(cardW / 7))}</text>`
      );
    });
  });
  return svgWrap8(W, H, theme, spec.title, parts);
}

// src/layouts/planning/gantt.ts
function svgWrap9(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render87(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  let maxEnd = 0;
  const rows = items.map((item) => {
    const rangeStr = item.attrs.find((a) => /\d/.test(a)) ?? item.value ?? "";
    const match = rangeStr.match(/(\d+)[^\d]+(\d+)/);
    let start = 0, end = 1;
    if (match) {
      start = parseInt(match[1]) - 1;
      end = parseInt(match[2]);
    } else if (/^\d+$/.test(rangeStr)) {
      start = parseInt(rangeStr) - 1;
      end = parseInt(rangeStr);
    }
    maxEnd = Math.max(maxEnd, end);
    return { label: item.label, start, end };
  });
  if (maxEnd === 0) maxEnd = 8;
  const W = 600;
  const LABEL_W = 138;
  const BAR_AREA = W - LABEL_W - 16;
  const ROW_H = 34;
  const TITLE_H = spec.title ? 30 : 8;
  const HEADER_H = 22;
  const H = TITLE_H + HEADER_H + rows.length * ROW_H + 12;
  const parts = [];
  for (let t = 0; t <= maxEnd; t++) {
    const x = LABEL_W + t / maxEnd * BAR_AREA;
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${TITLE_H + HEADER_H - 2}" x2="${x.toFixed(1)}" y2="${H - 8}" stroke="${theme.border}" stroke-width="0.5"/>`,
      `<text x="${x.toFixed(1)}" y="${TITLE_H + 14}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${t + 1}</text>`
    );
  }
  rows.forEach((row, i) => {
    const y = TITLE_H + HEADER_H + i * ROW_H;
    if (i % 2 === 0) {
      parts.push(`<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${ROW_H}" fill="${theme.surface}" opacity="0.5"/>`);
    }
    parts.push(`<text x="${(LABEL_W - 8).toFixed(1)}" y="${(y + 21).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(row.label, 18)}</text>`);
    const barX = LABEL_W + row.start / maxEnd * BAR_AREA;
    const barW = Math.max(6, (row.end - row.start) / maxEnd * BAR_AREA);
    parts.push(`<rect x="${barX.toFixed(1)}" y="${(y + 8).toFixed(1)}" width="${barW.toFixed(1)}" height="18" rx="4" fill="${theme.accent}88" stroke="${theme.accent}" stroke-width="1"/>`);
  });
  return svgWrap9(W, H, theme, spec.title, parts);
}

// src/layouts/planning/gantt-lite.ts
function render88(spec, theme) {
  return render87(spec, theme);
}

// src/layouts/planning/sprint-board.ts
function svgWrap10(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render89(spec, theme) {
  const columns = spec.items;
  if (columns.length === 0) return renderEmpty(theme);
  const W = 640;
  const TITLE_H = spec.title ? 32 : 8;
  const n = columns.length;
  const GAP = 10;
  const COL_W = (W - (n + 1) * GAP) / n;
  const HEADER_H = 44;
  const CARD_H = 30, CARD_GAP = 6, PAD = 8;
  const FOOTER_H = 30;
  const maxCards = Math.max(...columns.map((c) => c.children.length), 0);
  const COL_H = HEADER_H + maxCards * (CARD_H + CARD_GAP) + PAD * 2;
  const H = TITLE_H + 8 + COL_H + FOOTER_H + 12;
  let totalPts = 0, donePts = 0;
  const parts = [];
  columns.forEach((col, ci) => {
    const colX = GAP + ci * (COL_W + GAP), colY = TITLE_H + 8;
    const isDoneCol = /done|complete/i.test(col.label);
    parts.push(`<rect x="${colX.toFixed(1)}" y="${colY}" width="${COL_W.toFixed(1)}" height="${COL_H}" rx="8" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`);
    parts.push(`<path d="M${(colX + 8).toFixed(1)},${colY} Q${colX},${colY} ${colX},${colY + 8} L${colX},${colY + HEADER_H} L${(colX + COL_W).toFixed(1)},${colY + HEADER_H} L${(colX + COL_W).toFixed(1)},${colY + 8} Q${(colX + COL_W).toFixed(1)},${colY} ${(colX + COL_W - 8).toFixed(1)},${colY} Z" fill="${theme.accent}22"/>`);
    parts.push(`<text x="${(colX + COL_W / 2).toFixed(1)}" y="${colY + 19}" text-anchor="middle" font-size="12" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${tt(col.label, 14)}</text>`);
    let colPts = 0;
    col.children.forEach((c) => {
      const p = parseInt(c.value ?? c.attrs.find((a) => /^\d+$/.test(a)) ?? "0") || 0;
      colPts += p;
      totalPts += p;
      if (isDoneCol || c.attrs.includes("done")) donePts += p;
    });
    parts.push(`<text x="${(colX + COL_W / 2).toFixed(1)}" y="${colY + 34}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${colPts} pts</text>`);
    parts.push(`<line x1="${colX}" y1="${colY + HEADER_H}" x2="${(colX + COL_W).toFixed(1)}" y2="${colY + HEADER_H}" stroke="${theme.border}" stroke-width="1"/>`);
    col.children.forEach((card, idx) => {
      const cx = colX + PAD, cy = colY + HEADER_H + PAD + idx * (CARD_H + CARD_GAP);
      const cw = COL_W - PAD * 2;
      const pts = parseInt(card.value ?? card.attrs.find((a) => /^\d+$/.test(a)) ?? "0") || 0;
      const done = isDoneCol || card.attrs.includes("done");
      const active = card.attrs.includes("active") || card.attrs.includes("doing") || card.attrs.includes("wip");
      const border = active ? theme.accent : theme.border;
      parts.push(`<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cw.toFixed(1)}" height="${CARD_H}" rx="5" fill="${theme.bg}" stroke="${border}" stroke-width="${active ? 1.5 : 1}"/>`);
      if (active) parts.push(`<rect x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" width="3" height="${CARD_H - 8}" rx="1.5" fill="${theme.accent}"/>`);
      const maxChars = Math.floor((cw - (pts > 0 ? 30 : 12)) / 6.5);
      const tx = cx + (active ? 10 : 6);
      parts.push(`<text x="${(tx + 2).toFixed(1)}" y="${(cy + 19).toFixed(1)}" font-size="11" fill="${done ? theme.textMuted : theme.text}" font-family="system-ui,sans-serif" ${done ? 'text-decoration="line-through"' : ""}>${tt(card.label, maxChars)}</text>`);
      if (pts > 0) {
        const bx = cx + cw - 13;
        parts.push(`<circle cx="${bx.toFixed(1)}" cy="${(cy + 15).toFixed(1)}" r="9" fill="${theme.accent}30"/>`);
        parts.push(`<text x="${bx.toFixed(1)}" y="${(cy + 19).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="600">${pts}</text>`);
      }
    });
  });
  const barY = TITLE_H + 8 + COL_H + 8;
  const barX = GAP, barW = W - GAP * 2;
  parts.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="10" rx="5" fill="${theme.surface}" stroke="${theme.border}" stroke-width="1"/>`);
  if (totalPts > 0) {
    const fw = Math.max(0, donePts / totalPts * barW);
    parts.push(`<rect x="${barX}" y="${barY}" width="${fw.toFixed(1)}" height="10" rx="5" fill="${theme.accent}cc"/>`);
    parts.push(`<text x="${barX + barW / 2}" y="${(barY + 22).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">Velocity: ${donePts}/${totalPts} pts \xB7 ${Math.round(donePts / totalPts * 100)}% complete</text>`);
  }
  return svgWrap10(W, H, theme, spec.title, parts);
}

// src/layouts/planning/timeline.ts
function svgWrap11(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render90(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 720, PAD = 40;
  const TITLE_H = spec.title ? 30 : 10;
  const BAND = 62;
  const LINE_Y = TITLE_H + BAND;
  const H = TITLE_H + BAND * 2 + 20;
  const n = items.length;
  const spacing = n > 1 ? (W - PAD * 2) / (n - 1) : 0;
  const slotW = n > 1 ? spacing : W - PAD * 2;
  const MAX_CHARS = Math.max(10, Math.floor(slotW / 6.5));
  const parts = [];
  parts.push(`<line x1="${PAD}" y1="${LINE_Y}" x2="${W - PAD}" y2="${LINE_Y}" stroke="${theme.accent}66" stroke-width="2.5"/>`);
  items.forEach((item, i) => {
    const x = n === 1 ? W / 2 : PAD + i * spacing;
    const above = i % 2 === 0;
    const active = item.attrs.includes("active") || item.attrs.includes("current") || item.attrs.includes("now");
    const done = item.attrs.includes("done") || item.attrs.includes("past");
    const r = active ? 8 : 6;
    const dotFill = active ? theme.accent : done ? `${theme.accent}77` : theme.surface;
    const dotStroke = active || done ? theme.accent : theme.border;
    const stemH = 16;
    const stemY1 = above ? LINE_Y - r : LINE_Y + r;
    const stemY2 = above ? LINE_Y - r - stemH : LINE_Y + r + stemH;
    parts.push(`<line x1="${x.toFixed(1)}" y1="${stemY1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${stemY2.toFixed(1)}" stroke="${theme.border}" stroke-width="1"/>`);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${LINE_Y}" r="${r}" fill="${dotFill}" stroke="${dotStroke}" stroke-width="${active ? 2 : 1.5}"/>`);
    if (done && !active) {
      parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y + 4).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.accent}" font-family="system-ui,sans-serif">\u2713</text>`);
    }
    const mainLabel = item.value ? item.label : item.label;
    const subLabel = item.value ?? "";
    const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
    const col = active ? theme.accent : done ? theme.textMuted : theme.text;
    if (above) {
      if (subLabel) {
        parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y - r - stemH - 18).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(mainLabel, MAX_CHARS)}</text>`);
        parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y - r - stemH - 5).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${col}" font-family="system-ui,sans-serif" font-weight="${active ? "600" : "400"}">${tt(subLabel, MAX_CHARS)}</text>`);
      } else {
        parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y - r - stemH - 5).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${col}" font-family="system-ui,sans-serif" font-weight="${active ? "600" : "400"}">${tt(mainLabel, MAX_CHARS)}</text>`);
      }
    } else {
      parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y + r + stemH + 14).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${col}" font-family="system-ui,sans-serif" font-weight="${active ? "600" : "400"}">${tt(item.value ? subLabel : mainLabel, MAX_CHARS)}</text>`);
      if (item.value) {
        parts.push(`<text x="${x.toFixed(1)}" y="${(LINE_Y + r + stemH + 27).toFixed(1)}" text-anchor="${anchor}" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(mainLabel, MAX_CHARS)}</text>`);
      }
    }
  });
  return svgWrap11(W, H, theme, spec.title, parts);
}

// src/layouts/planning/milestone.ts
function svgWrap12(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render91(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 460, ROW_H = 44;
  const TITLE_H = spec.title ? 30 : 8;
  const LINE_X = 36;
  const H = TITLE_H + 12 + items.length * ROW_H + 8;
  const parts = [];
  const spineY1 = TITLE_H + 12 + ROW_H / 2;
  const spineY2 = TITLE_H + 12 + (items.length - 0.5) * ROW_H;
  parts.push(`<line x1="${LINE_X}" y1="${spineY1.toFixed(1)}" x2="${LINE_X}" y2="${spineY2.toFixed(1)}" stroke="${theme.border}" stroke-width="2"/>`);
  items.forEach((item, i) => {
    const cy = TITLE_H + 12 + i * ROW_H + ROW_H / 2;
    const done = item.attrs.includes("done") || item.attrs.includes("complete");
    const active = item.attrs.includes("active") || item.attrs.includes("current") || item.attrs.includes("now");
    const upcoming = !done && !active;
    const s = active ? 10 : 8;
    const fill = done ? theme.accent : active ? theme.accent : theme.surface;
    const stroke = done || active ? theme.accent : theme.border;
    const sw = active ? 2.5 : 1.5;
    parts.push(`<rect x="${(LINE_X - s).toFixed(1)}" y="${(cy - s).toFixed(1)}" width="${(s * 2).toFixed(1)}" height="${(s * 2).toFixed(1)}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="rotate(45 ${LINE_X} ${cy})"/>`);
    if (done) parts.push(`<text x="${LINE_X}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.bg}" font-family="system-ui,sans-serif" font-weight="700">\u2713</text>`);
    const labelColor = upcoming ? theme.textMuted : theme.text;
    const fw = active ? "600" : "400";
    parts.push(`<text x="${(LINE_X + 22).toFixed(1)}" y="${(cy + 5).toFixed(1)}" font-size="12" fill="${labelColor}" font-family="system-ui,sans-serif" font-weight="${fw}">${tt(item.label, 28)}</text>`);
    const tag = done ? "Done" : active ? "In Progress" : item.value ?? "Upcoming";
    const tagCol = done ? theme.accent : active ? "#fbbf24" : theme.textMuted;
    parts.push(`<text x="${W - 10}" y="${(cy + 5).toFixed(1)}" text-anchor="end" font-size="9" fill="${tagCol}" font-family="system-ui,sans-serif">${tt(tag, 12)}</text>`);
  });
  return svgWrap12(W, H, theme, spec.title, parts);
}

// src/layouts/planning/wbs.ts
function svgWrap13(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render92(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const hasL2 = items.some((it) => it.children.length > 0);
  const NW = 118, NH = 30, HGAP = 40, VGAP = 10, PAD_TOP = 8;
  const cols = hasL2 ? 3 : 2;
  const colX = Array.from({ length: cols }, (_, c) => 16 + c * (NW + HGAP));
  const totalLeaves = hasL2 ? items.reduce((a, it) => a + Math.max(it.children.length, 1), 0) : items.length;
  const TITLE_H = 8;
  const H = TITLE_H + PAD_TOP + totalLeaves * (NH + VGAP) - VGAP + PAD_TOP + 10;
  const W = colX[cols - 1] + NW + 16;
  const parts = [];
  const rootLabel = spec.title ?? items[0].label;
  let leafRow = 0;
  const l1Mids = [];
  items.forEach((l1) => {
    const leaves = hasL2 ? Math.max(l1.children.length, 1) : 1;
    const l1SpanTop = TITLE_H + PAD_TOP + leafRow * (NH + VGAP);
    const l1SpanH = leaves * (NH + VGAP) - VGAP;
    const l1Mid = l1SpanTop + l1SpanH / 2;
    l1Mids.push(l1Mid);
    const l1x = colX[hasL2 ? 1 : 0];
    const l1y = l1Mid - NH / 2;
    parts.push(`<rect x="${l1x}" y="${l1y.toFixed(1)}" width="${NW}" height="${NH}" rx="5" fill="${theme.primary}2e" stroke="${theme.primary}88" stroke-width="1.5"/>`);
    parts.push(`<text x="${(l1x + NW / 2).toFixed(1)}" y="${(l1y + 20).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(l1.label, 15)}</text>`);
    if (hasL2) {
      const midX = colX[1] + NW;
      const childX = colX[2];
      const elbowX = midX + HGAP / 2;
      l1.children.forEach((l2, j) => {
        const l2y = TITLE_H + PAD_TOP + (leafRow + j) * (NH + VGAP);
        const l2Mid = l2y + NH / 2;
        const done = l2.attrs.includes("done");
        const active = l2.attrs.includes("active") || l2.attrs.includes("wip");
        parts.push(`<path d="M${midX},${l1Mid.toFixed(1)} H${elbowX} V${l2Mid.toFixed(1)} H${childX}" fill="none" stroke="${theme.border}" stroke-width="1.2"/>`);
        const l2Fill = done ? `${theme.accent}22` : theme.surface;
        const l2Stroke = done ? theme.accent : active ? `${theme.accent}88` : theme.border;
        parts.push(`<rect x="${childX}" y="${l2y.toFixed(1)}" width="${NW}" height="${NH}" rx="4" fill="${l2Fill}" stroke="${l2Stroke}" stroke-width="${active ? 1.5 : 1}"/>`);
        const l2Col = done ? theme.accent : active ? theme.text : theme.textMuted;
        parts.push(`<text x="${(childX + NW / 2).toFixed(1)}" y="${(l2y + 20).toFixed(1)}" text-anchor="middle" font-size="10" fill="${l2Col}" font-family="system-ui,sans-serif" ${done ? 'text-decoration="line-through"' : ""}>${tt(l2.label, 15)}</text>`);
      });
    }
    leafRow += leaves;
  });
  if (hasL2 && l1Mids.length > 0) {
    const spineX = colX[1] - HGAP / 2;
    parts.push(`<line x1="${spineX}" y1="${l1Mids[0].toFixed(1)}" x2="${spineX}" y2="${l1Mids[l1Mids.length - 1].toFixed(1)}" stroke="${theme.border}" stroke-width="1.5"/>`);
    l1Mids.forEach((mid) => parts.push(`<line x1="${spineX}" y1="${mid.toFixed(1)}" x2="${colX[1]}" y2="${mid.toFixed(1)}" stroke="${theme.border}" stroke-width="1.2"/>`));
    const rootMid = (l1Mids[0] + l1Mids[l1Mids.length - 1]) / 2;
    const rootX = colX[0];
    parts.push(`<rect x="${rootX}" y="${(rootMid - NH / 2).toFixed(1)}" width="${NW}" height="${NH}" rx="6" fill="${theme.accent}33" stroke="${theme.accent}99" stroke-width="2"/>`);
    parts.push(`<text x="${(rootX + NW / 2).toFixed(1)}" y="${(rootMid + 5).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.accent}" font-family="system-ui,sans-serif" font-weight="700">${tt(rootLabel, 15)}</text>`);
    parts.push(`<line x1="${rootX + NW}" y1="${rootMid.toFixed(1)}" x2="${spineX}" y2="${rootMid.toFixed(1)}" stroke="${theme.border}" stroke-width="1.5"/>`);
  }
  return svgWrap13(W, H, theme, void 0, parts);
}

// src/layouts/technical/layered-arch.ts
function svgWrap14(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render93(spec, theme) {
  const layers = spec.items;
  if (layers.length === 0) return renderEmpty(theme);
  const W = 600;
  const TITLE_H = spec.title ? 30 : 8;
  const LAYER_H = 62;
  const GAP = 6;
  const H = TITLE_H + layers.length * (LAYER_H + GAP) + 16;
  const LAYER_LEFT_PAD = 8;
  const LAYER_RIGHT_PAD = 16;
  const TITLE_COL = 120;
  const FIRST_CHIP_X = 140;
  const CHIP_GAP = 8;
  const CHIP_H = 26;
  const CHAR_PX = 6.5;
  const CHIP_PAD = 18;
  const parts = [];
  parts.push(`<defs><marker id="la-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${theme.muted}"/></marker></defs>`);
  layers.forEach((layer, i) => {
    const y = TITLE_H + 8 + i * (LAYER_H + GAP);
    const t = i / Math.max(layers.length - 1, 1);
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(`<rect x="${LAYER_LEFT_PAD}" y="${y.toFixed(1)}" width="${W - LAYER_LEFT_PAD - LAYER_RIGHT_PAD}" height="${LAYER_H}" rx="8" fill="${fill}22" stroke="${fill}66" stroke-width="1.2"/>`);
    if (layer.children.length === 0) {
      const mid = (y + LAYER_H / 2 + 4).toFixed(1);
      const maxNoChild = Math.max(24, Math.floor((W - LAYER_LEFT_PAD - LAYER_RIGHT_PAD - 32) / 6.5));
      parts.push(`<text x="24" y="${mid}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(layer.label, maxNoChild)}</text>`);
    } else {
      const titleMax = Math.max(6, Math.floor((TITLE_COL - 28) / 6.5));
      parts.push(`<text x="24" y="${(y + LAYER_H / 2 + 4).toFixed(1)}" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(layer.label, titleMax)}</text>`);
      parts.push(`<line x1="128" y1="${(y + 10).toFixed(1)}" x2="128" y2="${(y + LAYER_H - 10).toFixed(1)}" stroke="${fill}55" stroke-width="1"/>`);
      const children = layer.children.slice(0, 7);
      const n = children.length;
      const rowInner = W - LAYER_RIGHT_PAD - FIRST_CHIP_X;
      const perChipMax = n > 0 ? (rowInner - (n - 1) * CHIP_GAP) / n : 0;
      let chipX = FIRST_CHIP_X;
      const chipY = y + (LAYER_H - CHIP_H) / 2;
      for (const child of children) {
        const maxChars = Math.max(4, Math.floor((perChipMax - CHIP_PAD) / CHAR_PX));
        const vis = truncate(child.label, maxChars);
        const naturalW = vis.length * 7 + 18;
        const chipW = Math.max(24, Math.min(perChipMax, naturalW));
        parts.push(
          `<rect x="${chipX.toFixed(1)}" y="${chipY.toFixed(1)}" width="${chipW.toFixed(1)}" height="${CHIP_H}" rx="5" fill="${theme.surface}" stroke="${fill}66" stroke-width="1"/>`,
          `<text x="${(chipX + chipW / 2).toFixed(1)}" y="${(chipY + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(child.label, maxChars)}</text>`
        );
        chipX += chipW + CHIP_GAP;
      }
    }
    if (i < layers.length - 1) {
      const ax = W / 2;
      const ay1 = y + LAYER_H;
      const ay2 = ay1 + GAP;
      parts.push(`<line x1="${ax}" y1="${ay1.toFixed(1)}" x2="${ax}" y2="${ay2.toFixed(1)}" stroke="${theme.muted}" stroke-width="1.5" marker-end="url(#la-arr)"/>`);
    }
  });
  return svgWrap14(W, H, theme, spec.title, parts);
}

// src/layouts/technical/entity.ts
function svgWrap15(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render94(spec, theme) {
  const entities = spec.items;
  if (entities.length === 0) return renderEmpty(theme);
  const W = 600;
  const TITLE_H = spec.title ? 30 : 8;
  const n = entities.length;
  const GAP = 14;
  const ENT_W = Math.min(170, (W - (n + 1) * GAP) / n);
  const HEADER_H = 30;
  const FIELD_H = 22;
  const ENT_H = HEADER_H + Math.max(...entities.map((e) => e.children.length), 1) * FIELD_H + 8;
  const totalW = n * ENT_W + (n - 1) * GAP;
  const startX = (W - totalW) / 2;
  const H = TITLE_H + ENT_H + 32;
  const parts = [];
  entities.forEach((entity, i) => {
    const x = startX + i * (ENT_W + GAP);
    const y = TITLE_H + 12;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${ENT_W}" height="${ENT_H}" rx="6" fill="${theme.surface}" stroke="${theme.accent}88" stroke-width="1.5"/>`);
    parts.push(
      `<path d="M${(x + 6).toFixed(1)},${y.toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${x.toFixed(1)},${(y + 6).toFixed(1)} L${x.toFixed(1)},${(y + HEADER_H).toFixed(1)} L${(x + ENT_W).toFixed(1)},${(y + HEADER_H).toFixed(1)} L${(x + ENT_W).toFixed(1)},${(y + 6).toFixed(1)} Q${(x + ENT_W).toFixed(1)},${y.toFixed(1)} ${(x + ENT_W - 6).toFixed(1)},${y.toFixed(1)} Z" fill="${theme.accent}33"/>`,
      `<text x="${(x + ENT_W / 2).toFixed(1)}" y="${(y + 19).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="700">${tt(entity.label, 14)}</text>`
    );
    parts.push(`<line x1="${x.toFixed(1)}" y1="${(y + HEADER_H).toFixed(1)}" x2="${(x + ENT_W).toFixed(1)}" y2="${(y + HEADER_H).toFixed(1)}" stroke="${theme.accent}44" stroke-width="1"/>`);
    entity.children.forEach((field, fi) => {
      const fy = y + HEADER_H + fi * FIELD_H + 14;
      const isPK = field.attrs.includes("PK");
      const isFK = field.attrs.includes("FK");
      const textColor = isPK ? theme.accent : isFK ? `${theme.secondary}ee` : theme.textMuted;
      parts.push(`<text x="${(x + 10).toFixed(1)}" y="${fy.toFixed(1)}" font-size="10" fill="${textColor}" font-family="ui-monospace,monospace">${tt(field.label, 16)}</text>`);
      if (isPK || isFK) {
        const badge = isPK ? "PK" : "FK";
        const badgeColor = isPK ? theme.accent : theme.secondary;
        const bx = x + ENT_W - 28;
        parts.push(
          `<rect x="${bx.toFixed(1)}" y="${(fy - 11).toFixed(1)}" width="24" height="13" rx="3" fill="${badgeColor}22" stroke="${badgeColor}66" stroke-width="0.5"/>`,
          `<text x="${(bx + 12).toFixed(1)}" y="${(fy - 1).toFixed(1)}" text-anchor="middle" font-size="8" fill="${badgeColor}" font-family="system-ui,sans-serif" font-weight="600">${badge}</text>`
        );
      }
    });
  });
  return svgWrap15(W, H, theme, spec.title, parts);
}

// src/layouts/technical/network.ts
function svgWrap16(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render95(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const allLabels = items.map((it) => it.label);
  items.forEach((it) => {
    it.flowChildren.forEach((fc) => {
      if (!allLabels.includes(fc.label)) allLabels.push(fc.label);
    });
  });
  const n = allLabels.length;
  const W = 580, H = 420;
  const TITLE_H_net = spec.title ? 30 : 8;
  const cx = W / 2, cy = (H + TITLE_H_net) / 2;
  const NODE_W = 104, NODE_H = 30;
  const maxRH = cy - TITLE_H_net - NODE_H / 2 - 12;
  const maxRW = cx - NODE_W / 2 - 8;
  const R = Math.min(maxRH, maxRW, Math.max(100, 80 + n * 18));
  const positions = allLabels.map((_, i) => {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    return { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
  });
  const labelIndex = new Map(allLabels.map((lbl, i) => [lbl, i]));
  const edges = [];
  const nodes = [];
  edges.push(`<defs><marker id="net-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${theme.muted}e6"/></marker></defs>`);
  items.forEach((item) => {
    const si = labelIndex.get(item.label) ?? -1;
    if (si < 0) return;
    const src = positions[si];
    item.flowChildren.forEach((fc) => {
      const ti = labelIndex.get(fc.label) ?? -1;
      if (ti < 0) return;
      const dst = positions[ti];
      const dx = dst.x - src.x, dy = dst.y - src.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const x1 = src.x + dx / len * (NODE_W / 2 + 2);
      const y1 = src.y + dy / len * (NODE_H / 2 + 2);
      const x2 = dst.x - dx / len * (NODE_W / 2 + 10);
      const y2 = dst.y - dy / len * (NODE_H / 2 + 6);
      edges.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${theme.muted}d0" stroke-width="1.5" marker-end="url(#net-arr)"/>`);
    });
  });
  const topLevelSet = new Set(items.map((it) => it.label));
  allLabels.forEach((label, i) => {
    const { x, y } = positions[i];
    const isTop = topLevelSet.has(label);
    const stroke = isTop ? `${theme.accent}bb` : `${theme.muted}aa`;
    const fill = isTop ? theme.surface : `${theme.surface}cc`;
    nodes.push(
      `<rect x="${(x - NODE_W / 2).toFixed(1)}" y="${(y - NODE_H / 2).toFixed(1)}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
      `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(label, 13)}</text>`
    );
  });
  return svgWrap16(W, H, theme, spec.title, [...edges, ...nodes]);
}

// src/layouts/technical/pipeline.ts
function svgWrap17(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render96(spec, theme) {
  const items = spec.items;
  if (items.length === 0) return renderEmpty(theme);
  const W = 600;
  const TITLE_H = spec.title ? 30 : 8;
  const H = 100 + TITLE_H;
  const n = items.length;
  const ARROW_W = 18;
  const STAGE_W = (W - 24 - (n - 1) * ARROW_W) / n;
  const STAGE_H = 50;
  const stageY = TITLE_H + (H - TITLE_H - STAGE_H) / 2;
  const parts = [];
  items.forEach((item, i) => {
    const x = 12 + i * (STAGE_W + ARROW_W);
    const t = i / Math.max(n - 1, 1);
    const fill = lerpColor(theme.primary, theme.secondary, t);
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${stageY.toFixed(1)}" width="${STAGE_W.toFixed(1)}" height="${STAGE_H}" rx="6" fill="${fill}33" stroke="${fill}99" stroke-width="1.5"/>`,
      `<text x="${(x + STAGE_W / 2).toFixed(1)}" y="${(stageY + STAGE_H / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(item.label, Math.floor(STAGE_W / 7))}</text>`
    );
    if (i < n - 1) {
      const ax = x + STAGE_W + 4;
      const ay = stageY + STAGE_H / 2;
      parts.push(`<path d="M${ax.toFixed(1)},${(ay - 6).toFixed(1)} L${(ax + ARROW_W - 4).toFixed(1)},${ay.toFixed(1)} L${ax.toFixed(1)},${(ay + 6).toFixed(1)}" fill="${theme.muted}99" stroke="none"/>`);
    }
  });
  return svgWrap17(W, H, theme, spec.title, parts);
}

// src/layouts/technical/sequence.ts
function svgWrap18(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render97(spec, theme) {
  const messages = [];
  const actors = [];
  const addActor = (name) => {
    if (!actors.includes(name)) actors.push(name);
  };
  spec.items.forEach((item) => {
    addActor(item.label);
    item.flowChildren.forEach((fc) => {
      addActor(fc.label);
      messages.push({ from: item.label, to: fc.label, msg: fc.value ?? "" });
    });
  });
  if (actors.length === 0) return renderEmpty(theme);
  const n = actors.length;
  const W = 600;
  const TITLE_H = spec.title ? 30 : 8;
  const ACTOR_H = 28;
  const MSG_GAP = 36;
  const PAD_V = 16;
  const H = TITLE_H + ACTOR_H + PAD_V + Math.max(messages.length, 1) * MSG_GAP + PAD_V + 16;
  const COL_W = W / n;
  const ax = (i) => (i + 0.5) * COL_W;
  const parts = [];
  parts.push(`<defs>
    <marker id="sq-a" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="${theme.accent}"/>
    </marker>
    <marker id="sq-b" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="${theme.muted}e0"/>
    </marker>
  </defs>`);
  const lifeY1 = TITLE_H + ACTOR_H + PAD_V;
  const lifeY2 = H - 16;
  const actorBoxY = TITLE_H + 8;
  actors.forEach((actor, i) => {
    const x = ax(i);
    const bw = Math.min(COL_W - 16, 96);
    parts.push(
      `<rect x="${(x - bw / 2).toFixed(1)}" y="${actorBoxY.toFixed(1)}" width="${bw.toFixed(1)}" height="${ACTOR_H}" rx="5" fill="${theme.accent}22" stroke="${theme.accent}aa" stroke-width="1.5"/>`,
      `<text x="${x.toFixed(1)}" y="${(actorBoxY + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif" font-weight="600">${tt(actor, 11)}</text>`
    );
  });
  actors.forEach((_, i) => {
    const x = ax(i);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${lifeY1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${lifeY2.toFixed(1)}" stroke="${theme.textMuted}9a" stroke-width="1" stroke-dasharray="4,4"/>`);
  });
  messages.forEach((msg, mi) => {
    const y = lifeY1 + PAD_V + mi * MSG_GAP;
    const fi = actors.indexOf(msg.from);
    const ti = actors.indexOf(msg.to);
    if (fi < 0 || ti < 0) return;
    const x1 = ax(fi);
    const x2 = ax(ti);
    const isSelf = fi === ti;
    if (isSelf) {
      const lx = x1 + COL_W * 0.28;
      parts.push(
        `<path d="M${x1.toFixed(1)},${y.toFixed(1)} C${lx.toFixed(1)},${(y - 10).toFixed(1)} ${lx.toFixed(1)},${(y + 10).toFixed(1)} ${x1.toFixed(1)},${(y + MSG_GAP * 0.55).toFixed(1)}" fill="none" stroke="${theme.accent}cc" stroke-width="1.5" marker-end="url(#sq-a)"/>`,
        msg.msg ? `<text x="${(lx + 4).toFixed(1)}" y="${(y - 1).toFixed(1)}" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(msg.msg, 11)}</text>` : ""
      );
    } else {
      const isRet = ti < fi;
      const dir = x2 > x1 ? 1 : -1;
      const ex1 = x1 + dir * 4;
      const ex2 = x2 - dir * 8;
      const midX = (ex1 + ex2) / 2;
      const maxChars = Math.max(8, Math.floor(Math.abs(ex2 - ex1) / 7));
      parts.push(
        `<line x1="${ex1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${ex2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${isRet ? theme.muted + "e0" : theme.accent}" stroke-width="1.5"${isRet ? ' stroke-dasharray="5,3"' : ""} marker-end="${isRet ? "url(#sq-b)" : "url(#sq-a)"}"/>`,
        msg.msg ? `<text x="${midX.toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(msg.msg, maxChars)}</text>` : ""
      );
    }
  });
  return svgWrap18(W, H, theme, spec.title, parts);
}

// src/layouts/technical/state-machine.ts
function svgWrap19(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render98(spec, theme) {
  const states = spec.items;
  if (states.length === 0) return renderEmpty(theme);
  const W = 580;
  const TITLE_H = spec.title ? 30 : 8;
  const H = 380;
  const n = states.length;
  const cx = W / 2;
  const cy = (H - TITLE_H) / 2 + TITLE_H;
  const R = Math.min(150, Math.max(90, 55 + n * 18));
  const STATE_W = 100, STATE_H = 30;
  const pos = states.map((_, i) => {
    const angle = 2 * Math.PI * i / n - Math.PI / 2;
    return { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
  });
  const stateIdx = new Map(states.map((s, i) => [s.label, i]));
  const parts = [];
  parts.push(`<defs>
    <marker id="sm-a" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="${theme.accent}99"/>
    </marker>
  </defs>`);
  const transitionSet = /* @__PURE__ */ new Set();
  states.forEach((state, si) => {
    state.flowChildren.forEach((fc) => {
      const ti = stateIdx.get(fc.label) ?? -1;
      if (ti >= 0 && si !== ti) transitionSet.add(`${si}-${ti}`);
    });
  });
  states.forEach((state, si) => {
    const src = pos[si];
    state.flowChildren.forEach((fc) => {
      const ti = stateIdx.get(fc.label) ?? -1;
      if (ti < 0) return;
      const dst = pos[ti];
      const isSelf = si === ti;
      if (isSelf) {
        const bx = src.x + STATE_W / 2;
        const by = src.y - STATE_H / 2;
        parts.push(
          `<path d="M${(bx - 4).toFixed(1)},${by.toFixed(1)} C${(bx + 26).toFixed(1)},${(by - 28).toFixed(1)} ${(bx + 26).toFixed(1)},${(by + 12).toFixed(1)} ${(bx - 4).toFixed(1)},${(by + STATE_H).toFixed(1)}" fill="none" stroke="${theme.accent}66" stroke-width="1.5" marker-end="url(#sm-a)"/>`,
          fc.value ? `<text x="${(bx + 32).toFixed(1)}" y="${(by - 6).toFixed(1)}" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(fc.value, 12)}</text>` : ""
        );
      } else {
        const isBidi = transitionSet.has(`${ti}-${si}`);
        const dx = dst.x - src.x, dy = dst.y - src.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / len, ny = dy / len;
        const x1 = src.x + nx * (STATE_W / 2 + 2);
        const y1 = src.y + ny * (STATE_H / 2 + 2);
        const x2 = dst.x - nx * (STATE_W / 2 + 10);
        const y2 = dst.y - ny * (STATE_H / 2 + 8);
        const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
        const toCenterX = cx - midX, toCenterY = cy - midY;
        const dot = -ny * toCenterX + nx * toCenterY;
        const naturalSign = dot < 0 ? 1 : -1;
        const curveMag = isBidi ? 44 : 30;
        const effectiveSign = isBidi && si > ti ? -naturalSign : naturalSign;
        const cpx = midX - ny * curveMag * effectiveSign;
        const cpy = midY + nx * curveMag * effectiveSign;
        const labelOff = curveMag - 12;
        const tx = midX - ny * labelOff * effectiveSign;
        const ty = midY + nx * labelOff * effectiveSign;
        const lw = Math.min((fc.value?.length ?? 0) * 5.5 + 8, 90);
        parts.push(
          `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${cpx.toFixed(1)},${cpy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${theme.accent}66" stroke-width="1.5" marker-end="url(#sm-a)"/>`,
          fc.value ? `<rect x="${(tx - lw / 2).toFixed(1)}" y="${(ty - 9).toFixed(1)}" width="${lw.toFixed(1)}" height="12" rx="3" fill="${theme.surface}" opacity="0.88"/>` : "",
          fc.value ? `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="9" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${tt(fc.value, 14)}</text>` : ""
        );
      }
    });
  });
  const fp = pos[0];
  const dotX = fp.x - STATE_W / 2 - 34;
  parts.push(
    `<circle cx="${dotX.toFixed(1)}" cy="${fp.y.toFixed(1)}" r="7" fill="${theme.text}"/>`,
    `<line x1="${(dotX + 7).toFixed(1)}" y1="${fp.y.toFixed(1)}" x2="${(fp.x - STATE_W / 2 - 6).toFixed(1)}" y2="${fp.y.toFixed(1)}" stroke="${theme.text}" stroke-width="2.5" marker-end="url(#sm-a)"/>`
  );
  states.forEach((state, i) => {
    const { x, y } = pos[i];
    const lbl = state.label.toLowerCase();
    const isFinal = state.attrs.includes("final") || lbl === "end" || lbl === "final";
    const stroke = i === 0 ? theme.primary : isFinal ? theme.accent : `${theme.accent}66`;
    const fill = isFinal ? `${theme.accent}18` : theme.surface;
    if (isFinal) {
      parts.push(`<rect x="${(x - STATE_W / 2 - 4).toFixed(1)}" y="${(y - STATE_H / 2 - 4).toFixed(1)}" width="${STATE_W + 8}" height="${STATE_H + 8}" rx="9" fill="none" stroke="${theme.accent}" stroke-width="2"/>`);
    }
    parts.push(
      `<rect x="${(x - STATE_W / 2).toFixed(1)}" y="${(y - STATE_H / 2).toFixed(1)}" width="${STATE_W}" height="${STATE_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
      `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle" font-size="11" fill="${theme.text}" font-family="system-ui,sans-serif">${tt(state.label, 12)}</text>`
    );
  });
  return svgWrap19(W, H, theme, spec.title, parts);
}

// src/layouts/technical/class.ts
function svgWrap20(W, H, theme, title, parts) {
  const titleEl2 = title ? `<text x="${W / 2}" y="20" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif" font-weight="600">${escapeXml(title)}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:${theme.bg};border-radius:8px">
  ${titleEl2}
  ${parts.join("\n  ")}
</svg>`;
}
function render99(spec, theme) {
  const classes = spec.items;
  if (classes.length === 0) return renderEmpty(theme);
  const W = 600;
  const TITLE_H = spec.title ? 30 : 8;
  const cols = Math.min(classes.length, 3);
  const CLASS_W = Math.min(170, Math.floor((W - 24) / cols) - 12);
  const HEADER_H = 30;
  const FIELD_H = 18;
  const SEP_H = 6;
  const VPAD = 10;
  const colGap = (W - cols * CLASS_W) / (cols + 1);
  const classHeights = classes.map((cls) => {
    const fields = cls.children.filter((c) => !c.label.includes("("));
    const methods = cls.children.filter((c) => c.label.includes("("));
    const hasDiv = fields.length > 0 && methods.length > 0;
    return HEADER_H + fields.length * FIELD_H + (hasDiv ? SEP_H : 0) + methods.length * FIELD_H + VPAD;
  });
  const rows = Math.ceil(classes.length / cols);
  const ROW_H = Math.max(...classHeights) + 20;
  const H = TITLE_H + rows * ROW_H + 20;
  const parts = [];
  const maxCharsPerField = Math.floor(CLASS_W / 7) - 2;
  classes.forEach((cls, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = colGap + col * (CLASS_W + colGap);
    const y = TITLE_H + 12 + row * ROW_H;
    const fields = cls.children.filter((c) => !c.label.includes("("));
    const methods = cls.children.filter((c) => c.label.includes("("));
    const hasDiv = fields.length > 0 && methods.length > 0;
    const totalH = classHeights[i];
    const isAbstract = cls.attrs.includes("abstract");
    const isInterface = cls.attrs.includes("interface");
    const isSpecial = isAbstract || isInterface;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CLASS_W}" height="${totalH}" rx="5" fill="${theme.surface}" stroke="${theme.accent}77" stroke-width="1.5"/>`,
      `<path d="M${(x + 5).toFixed(1)},${y.toFixed(1)} L${(x + CLASS_W - 5).toFixed(1)},${y.toFixed(1)} Q${(x + CLASS_W).toFixed(1)},${y.toFixed(1)} ${(x + CLASS_W).toFixed(1)},${(y + 5).toFixed(1)} L${(x + CLASS_W).toFixed(1)},${(y + HEADER_H).toFixed(1)} L${x.toFixed(1)},${(y + HEADER_H).toFixed(1)} L${x.toFixed(1)},${(y + 5).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + 5).toFixed(1)},${y.toFixed(1)} Z" fill="${theme.accent}22"/>`
    );
    if (isSpecial) {
      const stereo = isInterface ? "\xABinterface\xBB" : "\xABabstract\xBB";
      parts.push(`<text x="${(x + CLASS_W / 2).toFixed(1)}" y="${(y + 11).toFixed(1)}" text-anchor="middle" font-size="8" fill="${theme.accent}99" font-family="system-ui,sans-serif">${stereo}</text>`);
    }
    const nameY = isSpecial ? y + 24 : y + 19;
    parts.push(
      `<text x="${(x + CLASS_W / 2).toFixed(1)}" y="${nameY.toFixed(1)}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="ui-monospace,monospace" font-weight="700"${isSpecial ? ' font-style="italic"' : ""}>${tt(cls.label, Math.floor(CLASS_W / 7))}</text>`,
      `<line x1="${x.toFixed(1)}" y1="${(y + HEADER_H).toFixed(1)}" x2="${(x + CLASS_W).toFixed(1)}" y2="${(y + HEADER_H).toFixed(1)}" stroke="${theme.accent}44" stroke-width="1"/>`
    );
    let curY = y + HEADER_H;
    fields.forEach((field, fi) => {
      const fy = curY + fi * FIELD_H + 13;
      const isPK = field.attrs.includes("PK");
      const isFK = field.attrs.includes("FK");
      const visMatch = field.label.match(/^\[([+\-#~])\]/) ?? field.label.match(/^([+\-#~])/);
      const vis = visMatch ? visMatch[1] + " " : "  ";
      const raw = field.label.replace(/^\[[+\-#~]\]\s*|^[+\-#~]\s*/, "");
      const color = isPK ? theme.accent : isFK ? "#c4b5fd" : `${theme.textMuted}cc`;
      parts.push(`<text x="${(x + 7).toFixed(1)}" y="${fy.toFixed(1)}" font-size="10" fill="${color}" font-family="ui-monospace,monospace">${escapeXml(vis + truncate(raw, maxCharsPerField))}</text>`);
      if (isPK || isFK) {
        const bc = isPK ? theme.accent : "#a78bfa";
        const bx = x + CLASS_W - 26;
        parts.push(
          `<rect x="${bx.toFixed(1)}" y="${(fy - 11).toFixed(1)}" width="22" height="12" rx="3" fill="${bc}22" stroke="${bc}55" stroke-width="0.5"/>`,
          `<text x="${(bx + 11).toFixed(1)}" y="${(fy - 1).toFixed(1)}" text-anchor="middle" font-size="8" fill="${bc}" font-family="system-ui,sans-serif" font-weight="600">${isPK ? "PK" : "FK"}</text>`
        );
      }
    });
    curY += fields.length * FIELD_H;
    if (hasDiv) {
      parts.push(`<line x1="${x.toFixed(1)}" y1="${(curY + SEP_H / 2).toFixed(1)}" x2="${(x + CLASS_W).toFixed(1)}" y2="${(curY + SEP_H / 2).toFixed(1)}" stroke="${theme.border}" stroke-width="0.8"/>`);
      curY += SEP_H;
    }
    methods.forEach((method, mi) => {
      const my = curY + mi * FIELD_H + 13;
      const visMatch = method.label.match(/^\[([+\-#~])\]/) ?? method.label.match(/^([+\-#~])/);
      const vis = visMatch ? visMatch[1] + " " : "  ";
      const raw = method.label.replace(/^\[[+\-#~]\]\s*|^[+\-#~]\s*/, "");
      const isStatic = method.attrs.includes("static");
      parts.push(`<text x="${(x + 7).toFixed(1)}" y="${my.toFixed(1)}" font-size="10" fill="${theme.primary}cc" font-family="ui-monospace,monospace"${isStatic ? ' text-decoration="underline"' : ""}>${escapeXml(vis + truncate(raw, maxCharsPerField))}</text>`);
    });
  });
  return svgWrap20(W, H, theme, spec.title, parts);
}

// src/renderer.ts
var LAYOUT_RENDERERS = {
  // process family
  process: render,
  "chevron-process": render2,
  "arrow-process": render3,
  "circular-process": render4,
  funnel: render5,
  roadmap: render6,
  waterfall: render7,
  "snake-process": render9,
  "step-down": render10,
  "step-up": render11,
  "circle-process": render12,
  equation: render13,
  "bending-process": render8,
  "segmented-bar": render14,
  "phase-process": render15,
  "timeline-h": render16,
  "timeline-v": render17,
  swimlane: render18,
  // list family
  "bullet-list": render19,
  "numbered-list": render20,
  checklist: render21,
  "two-column-list": render22,
  "timeline-list": render23,
  "block-list": render24,
  "chevron-list": render25,
  "card-list": render26,
  "zigzag-list": render27,
  "ribbon-list": render28,
  "hexagon-list": render29,
  "trapezoid-list": render30,
  "tab-list": render31,
  "circle-list": render32,
  "icon-list": render33,
  // cycle family
  cycle: render34,
  "donut-cycle": render35,
  "gear-cycle": render36,
  spiral: render37,
  "block-cycle": render38,
  "segmented-cycle": render39,
  "nondirectional-cycle": render40,
  "multidirectional-cycle": render41,
  loop: render42,
  // matrix family
  swot: render43,
  "pros-cons": render44,
  comparison: render45,
  "matrix-2x2": render46,
  bcg: render47,
  ansoff: render48,
  "matrix-nxm": render49,
  // hierarchy family
  "org-chart": render50,
  tree: render51,
  "h-org-chart": render52,
  "hierarchy-list": render53,
  "radial-tree": render54,
  "decision-tree": render55,
  sitemap: render56,
  bracket: render57,
  "bracket-tree": render58,
  "mind-map": render59,
  // pyramid family
  pyramid: render60,
  "inverted-pyramid": render61,
  "pyramid-list": render62,
  "segmented-pyramid": render63,
  "diamond-pyramid": render64,
  // relationship family
  venn: render65,
  "venn-3": render65,
  "venn-4": render65,
  concentric: render66,
  balance: render67,
  counterbalance: render68,
  "opposing-arrows": render69,
  web: render70,
  cluster: render71,
  target: render72,
  radial: render73,
  converging: render74,
  diverging: render75,
  plus: render76,
  // statistical family
  "progress-list": render77,
  "bullet-chart": render78,
  scorecard: render79,
  treemap: render80,
  sankey: render81,
  waffle: render82,
  gauge: render83,
  radar: render84,
  heatmap: render85,
  // planning family
  kanban: render86,
  gantt: render87,
  "gantt-lite": render88,
  "sprint-board": render89,
  timeline: render90,
  milestone: render91,
  wbs: render92,
  // technical family
  "layered-arch": render93,
  entity: render94,
  network: render95,
  pipeline: render96,
  sequence: render97,
  "state-machine": render98,
  class: render99
};
function renderMdArt(raw, hintType, pluginConfig) {
  try {
    const spec = parseMdArt(raw, hintType);
    const globalCfg = getGlobalConfig();
    const themeKey = spec.theme ?? pluginConfig?.theme ?? globalCfg.theme;
    const mode = spec.mode ?? pluginConfig?.mode ?? globalCfg.mode ?? "dark";
    let theme = getTheme(spec.type, themeKey, mode);
    if (globalCfg.colors) theme = { ...theme, ...globalCfg.colors };
    if (pluginConfig?.colors) theme = { ...theme, ...pluginConfig.colors };
    if (spec.colors && Object.keys(spec.colors).length > 0) {
      theme = { ...theme, ...spec.colors };
    }
    const renderer = LAYOUT_RENDERERS[spec.type];
    if (!renderer) return renderFallback(spec, theme);
    return renderer(spec, theme);
  } catch (e) {
    return renderError(String(e));
  }
}
function renderFallback(spec, theme) {
  const W = 360;
  const H = 80;
  const label = spec.type ? `${spec.type} (${spec.items.length} items)` : `MdArt (${spec.items.length} items)`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    <rect width="${W}" height="${H}" fill="${theme.bg}" rx="8" stroke="${theme.border}" stroke-width="1"/>
    <text x="${W / 2}" y="34" text-anchor="middle" font-size="13" fill="${theme.textMuted}" font-family="system-ui,sans-serif">${label}</text>
    <text x="${W / 2}" y="52" text-anchor="middle" font-size="10" fill="${theme.muted}" font-family="system-ui,sans-serif">layout not yet implemented</text>
  </svg>`;
}
function renderError(msg) {
  return `<svg viewBox="0 0 300 60" xmlns="http://www.w3.org/2000/svg">
    <rect width="300" height="60" fill="#1a0a0a" rx="4"/>
    <text x="150" y="28" text-anchor="middle" font-size="11" fill="#f87171" font-family="system-ui,sans-serif">MdArt error</text>
    <text x="150" y="44" text-anchor="middle" font-size="9" fill="#7f1d1d" font-family="system-ui,sans-serif">${msg.slice(0, 60).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>
  </svg>`;
}
export {
  configureMdArt,
  parseMdArt,
  renderMdArt,
  resetMdArtConfig
};
//# sourceMappingURL=index.js.map
