#!/usr/bin/env npx tsx
/**
 * overview-chart.ts — Small-multiples grid: one mini-chart per watchlist group,
 * all sharing the same Y-axis scale for honest cross-group comparison.
 *
 * Usage:
 *   npm run overview-chart              # default: 5d
 *   npm run overview-chart -- 1mo       # single range
 *   npm run overview-chart -- all       # all ranges in parallel
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithCache, type SeriesData } from './lib/fetch.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const CHARTS_DIR = resolve(__dirname, '../server/data/charts');
const WATCHLIST  = resolve(__dirname, 'watchlist.json');
const BASE_URL   = 'https://steward.jradoo.com';

// ─── Range config ─────────────────────────────────────────────────────────────

interface RangeConfig { yahooRange: string; interval: string; intervalType: 'hour' | 'day' | 'week'; label: string }

const RANGE_MAP: Record<string, RangeConfig> = {
  '1d':  { yahooRange: '2d',  interval: '1m',  intervalType: 'hour', label: '1 Day'    },
  '5d':  { yahooRange: '5d',  interval: '1h',  intervalType: 'hour', label: '1 Week'   },
  '1w':  { yahooRange: '5d',  interval: '1h',  intervalType: 'hour', label: '1 Week'   },
  '1mo': { yahooRange: '1mo', interval: '1d',  intervalType: 'day',  label: '1 Month'  },
  '1m':  { yahooRange: '1mo', interval: '1d',  intervalType: 'day',  label: '1 Month'  },
  '3mo': { yahooRange: '3mo', interval: '1d',  intervalType: 'day',  label: '3 Months' },
  '3m':  { yahooRange: '3mo', interval: '1d',  intervalType: 'day',  label: '3 Months' },
  '6mo': { yahooRange: '6mo', interval: '1d',  intervalType: 'day',  label: '6 Months' },
  '6m':  { yahooRange: '6mo', interval: '1d',  intervalType: 'day',  label: '6 Months' },
  '1y':  { yahooRange: '1y',  interval: '1wk', intervalType: 'week', label: '1 Year'   },
  '2y':  { yahooRange: '2y',  interval: '1wk', intervalType: 'week', label: '2 Years'  },
};

const rangeArg = process.argv[2]?.toLowerCase() ?? '';

const ALL_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y'] as const;

// ─── Zoom box mapping: duration → fraction of data to show (from right edge) ────

const ZOOM_MAP: Record<string, number | null> = {
  '1d': null,              // no zoom box (finest grain)
  '5d': 2/5,               // show last 2/5 (1d chart actually shows 2d of data)
  '1w': 2/5,               // show last 2/5 (1d chart actually shows 2d of data)
  '1mo': 1/4,              // show last 1/4 (approximates 1w within 1mo)
  '1m': 1/4,
  '3mo': 1/3,              // show last 1/3 (approximates 1mo within 3mo)
  '3m': 1/3,
  '6mo': 1/2,              // show last 1/2 (approximates 3mo within 6mo)
  '6m': 1/2,
  '1y': 1/2,               // show last 1/2 (approximates 6mo within 1y)
  '2y': 1/2,
};

// ─── "all" mode: re-spawn once per range in parallel ─────────────────────────

if (rangeArg === 'all') {
  const script = fileURLToPath(import.meta.url);
  const procs  = ALL_RANGES.map(r =>
    spawn(process.execPath, ['--import', 'tsx/esm', script, r], {
      stdio: 'inherit',
      env:   { ...process.env },
    })
  );
  const codes  = await Promise.all(procs.map(p => new Promise<number>(res => p.on('close', res))));
  process.exit(codes.filter(c => c !== 0).length ? 1 : 0);
}

// ─── "group-all" / "group:<name>" mode ───────────────────────────────────────

if (rangeArg === 'group-all' || rangeArg.startsWith('group:')) {
  const script      = fileURLToPath(import.meta.url);
  const watchlistRaw = JSON.parse(readFileSync(WATCHLIST, 'utf8')) as { groups: Record<string, unknown> };
  const groupNames  = Object.keys(watchlistRaw.groups);
  const targets     = rangeArg === 'group-all'
    ? groupNames
    : [rangeArg.slice(6)];

  const procs = targets.map(g =>
    spawn(process.execPath, ['--import', 'tsx/esm', script, `_group:${g}`], {
      stdio: 'inherit',
      env:   { ...process.env },
    })
  );
  const codes = await Promise.all(procs.map(p => new Promise<number>(res => p.on('close', res))));
  process.exit(codes.filter(c => c !== 0).length ? 1 : 0);
}

const rangeKey    = RANGE_MAP[rangeArg] ? rangeArg : '5d';
const rangeConfig = RANGE_MAP[rangeKey];

// ─── Watchlist ────────────────────────────────────────────────────────────────

interface WatchlistTicker { symbol: string; name: string }
interface WatchlistGroup  { description: string; benchmarks?: string[]; tickers: WatchlistTicker[] }
interface Watchlist       { groups: Record<string, WatchlistGroup> }

const watchlist = JSON.parse(readFileSync(WATCHLIST, 'utf8')) as Watchlist;
const groups    = Object.entries(watchlist.groups);

// Map symbol → short display name for legend labels.
// Number-based / exchange-suffixed tickers (Korean, HK, TW, T, FX) use the
// watchlist name truncated to 10 chars; clean alpha symbols keep themselves.
const nameMap = new Map<string, string>();
for (const [, g] of groups) {
  for (const t of g.tickers) nameMap.set(t.symbol, t.name);
}

function legendLabel(sym: string): string {
  const stripped = sym.replace(/\.\w+$/, ''); // strip .KS / .HK / .T etc.
  const needsName = /\d/.test(stripped) || sym.endsWith('=X');
  if (needsName) {
    const name = nameMap.get(sym) ?? stripped;
    return name.length <= 10 ? name : name.slice(0, 9) + '…';
  }
  return stripped;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

function fetchData(sym: string): Promise<SeriesData> {
  const { yahooRange, interval, intervalType } = rangeConfig;
  return fetchWithCache(sym, yahooRange, interval, intervalType);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPercent(closes: (number | null)[]): (number | null)[] {
  const base = closes[Math.floor(closes.length / 2)] ?? closes.find(c => c !== null);
  if (!base) return closes.map(() => null);
  return closes.map(c => c === null ? null : ((c - base) / base) * 100);
}

function niceAxis(min: number, max: number, steps = 5) {
  const raw      = (max - min || 1) / steps;
  const mag      = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const niceStep = [0.5, 1, 2, 2.5, 5, 10].find(s => s * mag >= raw)! * mag;
  return {
    axisMin: Math.floor(min / niceStep) * niceStep,
    axisMax: Math.ceil(max  / niceStep) * niceStep,
    step:    niceStep,
  };
}

function fmtPct(p: number) { return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`; }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(ts: number) {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function isBenchmark(sym: string) { return sym.startsWith('^'); }

// ─── Zoom box helper ──────────────────────────────────────────────────────────

function calculateZoomBoxCoords(
  refSeries: SeriesData,
  fraction: number,
  chx: number,
  cchw: number,
): { startX: number; width: number } | null {
  const n = refSeries.closes.length;
  if (n < 2 || fraction <= 0 || fraction > 1) return null;

  // Show the last `fraction` of the data
  const startIdx = Math.max(0, Math.floor(n * (1 - fraction)));
  const endIdx = n - 1;

  const pxS = (i: number) => chx + (i / Math.max(n - 1, 1)) * cchw;
  const startX = pxS(startIdx);
  const endX = pxS(endIdx);
  const width = endX - startX;

  return width > 0 ? { startX, width } : null;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const PALETTE = [
  '#58a6ff', '#f0883e', '#3fb950', '#bc8cff', '#ffa657', '#ff7b72', '#79c0ff',
  '#e3b341', '#56d364', '#d2a8ff', '#ffa198', '#39d3bb',
  '#f778ba', '#87d96c', '#ffb347', '#00cfcf', '#c084fc', '#fb923c',
];
const BENCH_PALETTE = ['#8b949e', '#6e7681', '#b1bac4'];

// ─── Layout constants ─────────────────────────────────────────────────────────

const COLS         = 4;
const ROWS         = Math.ceil(groups.length / COLS);
const SVG_W        = 1120;
const PAD_X        = 12;
const PAD_TOP      = 52;
const PAD_BOT      = 14;
const GAP_X        = 10;
const GAP_Y        = 10;
const CELL_W       = Math.floor((SVG_W - 2 * PAD_X - (COLS - 1) * GAP_X) / COLS); // 266
const AXIS_W       = 38;   // width reserved for Y-axis labels
const CHART_H      = 132;
const TITLE_H      = 17;
const LEG_ROW_H    = 13;
const LEG_COLS     = 3;
const CELL_H       = TITLE_H + 6 + CHART_H + 6 + LEG_ROW_H * 2 + 6;  // ~186
const SVG_H        = PAD_TOP + ROWS * CELL_H + (ROWS - 1) * GAP_Y + PAD_BOT;

// ─── Group-wise chart (all durations for one group) ───────────────────────────

async function mainGroupWise(groupName: string) {
  const entry = groups.find(([n]) => n === groupName);
  if (!entry) { console.error(`❌ Unknown group: ${groupName}`); process.exit(1); }
  const [, group] = entry;

  const mainSyms  = group.tickers.map(t => t.symbol);
  const benchSyms = group.benchmarks ?? ['^GSPC'];
  const allSyms   = [...new Set([...benchSyms, ...mainSyms])];

  // Fetch all 6 ranges in parallel
  const rangeDataMaps = new Map<string, Map<string, SeriesData>>();
  await Promise.all(ALL_RANGES.map(async rk => {
    const rc = RANGE_MAP[rk];
    console.log(`⏳ [${groupName}] Fetching ${allSyms.length} symbols [${rc.label}]...`);
    const settled = await Promise.allSettled(
      allSyms.map(s => fetchWithCache(s, rc.yahooRange, rc.interval, rc.intervalType))
    );
    const dm = new Map<string, SeriesData>();
    for (let i = 0; i < allSyms.length; i++) {
      const r = settled[i];
      if (r.status === 'fulfilled') dm.set(allSyms[i], r.value);
    }
    rangeDataMaps.set(rk, dm);
  }));

  // Assign stable colors
  let mainIdx = 0, benchIdx = 0;
  const colorMap = new Map<string, string>();
  [...benchSyms, ...mainSyms].forEach(s => {
    colorMap.set(s, isBenchmark(s)
      ? BENCH_PALETTE[benchIdx++ % BENCH_PALETTE.length]
      : PALETTE[mainIdx++ % PALETTE.length]);
  });

  // ── Layout: 3 cols × 2 rows (6 duration panels) ──
  const GCOLS   = 3, GROWS = 2;
  const GAXIS_W = 38, GCHART_H = 150, GTITLE_H = 17;
  const GCELL_W = Math.floor((SVG_W - 2 * PAD_X - (GCOLS - 1) * GAP_X) / GCOLS);
  const GCELL_H = GTITLE_H + 6 + GCHART_H + 6;

  // Shared legend sizing
  const GLEG_COLS  = Math.min(6, mainSyms.length);
  const GLEG_ROWS  = Math.ceil(mainSyms.length / GLEG_COLS);
  const GLEG_H     = GLEG_ROWS * 18 + 16;
  const G_SVG_H    = PAD_TOP + GROWS * GCELL_H + (GROWS - 1) * GAP_Y + GLEG_H + PAD_BOT;

  const defs: string[]  = [];
  const cells: string[] = [];

  for (let ri = 0; ri < ALL_RANGES.length; ri++) {
    const rk = ALL_RANGES[ri];
    const rc = RANGE_MAP[rk];
    const dm = rangeDataMaps.get(rk)!;

    const col  = ri % GCOLS;
    const row  = Math.floor(ri / GCOLS);
    const cx   = PAD_X + col * (GCELL_W + GAP_X);
    const cy   = PAD_TOP + row * (GCELL_H + GAP_Y);
    const chx  = cx + GAXIS_W;
    const chy  = cy + GTITLE_H + 6;
    const cchw = GCELL_W - GAXIS_W - 2;
    const clipId = `gc${ri}`;

    defs.push(`<clipPath id="${clipId}"><rect x="${chx}" y="${chy}" width="${cchw}" height="${GCHART_H}"/></clipPath>`);

    // Per-cell Y-axis auto-scaled to this duration
    const cellPcts: number[] = [];
    for (const s of allSyms) {
      const d = dm.get(s);
      if (d) toPercent(d.closes).forEach(p => { if (p !== null) cellPcts.push(p); });
    }
    cellPcts.sort((a, b) => a - b);
    const cpMin = Math.min(...cellPcts, -5);
    const cpMax = Math.max(...cellPcts, 5);
    const yPad = (cpMax - cpMin) * 0.06;
    const { axisMin, axisMax, step } = niceAxis(cpMin - yPad, cpMax + yPad);
    const yRange = axisMax - axisMin || 1;
    const pyC = (pct: number) => chy + (1 - (pct - axisMin) / yRange) * GCHART_H;

    const gridLines: string[] = [];
    for (let p = axisMin; p <= axisMax + 1e-9; p += step) {
      const y = pyC(p), isZero = Math.abs(p) < 1e-9;
      gridLines.push(
        `<line x1="${chx}" y1="${y.toFixed(1)}" x2="${(chx+cchw).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${isZero ? '#388bfd' : '#21262d'}" stroke-width="${isZero ? '0.8' : '0.5'}" ${isZero ? 'opacity="0.7"' : ''}/>`,
        `<text x="${(cx+GAXIS_W-3).toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="end" fill="${isZero ? '#58a6ff' : '#484f58'}" font-family="monospace" font-size="7">${fmtPct(p)}</text>`,
      );
    }

    const polylineFor = (sym: string, bench: boolean) => {
      const d = dm.get(sym); if (!d) return '';
      const n   = d.closes.length;
      const pxS = (i: number) => chx + (i / Math.max(n - 1, 1)) * cchw;
      const pts = toPercent(d.closes)
        .map((p, i) => p === null ? null : `${pxS(i).toFixed(1)},${pyC(p).toFixed(1)}`)
        .filter(Boolean).join(' ');
      const color = colorMap.get(sym) ?? '#666';
      return bench
        ? `<polyline clip-path="url(#${clipId})" points="${pts}" fill="none" stroke="${color}" stroke-width="0.8" stroke-dasharray="3,2" opacity="0.55" stroke-linejoin="round"/>`
        : `<polyline clip-path="url(#${clipId})" points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    };

    // Zoom box for group-wise charts
    const zoomHoursBack = ZOOM_MAP[rk];
    let zoomBoxSvg = '';
    if (zoomHoursBack !== null) {
      // Find refSeries for this range
      const refSeriesForRange = [...dm.values()].reduce((a, b) => a.timestamps.length >= b.timestamps.length ? a : b);
      const zoomCoords = calculateZoomBoxCoords(refSeriesForRange, zoomHoursBack, chx, cchw);
      if (zoomCoords) {
        zoomBoxSvg = `<rect x="${zoomCoords.startX.toFixed(1)}" y="${chy.toFixed(1)}" width="${zoomCoords.width.toFixed(1)}" height="${GCHART_H}" fill="rgba(100, 150, 255, 0.12)" stroke="#6496ff" stroke-width="1.5" rx="2"/>`;
      }
    }

    const barLabel = rc.intervalType === 'hour' ? rc.interval : rc.intervalType === 'day' ? '1d' : '1wk';
    cells.push(`
<rect x="${cx}" y="${cy}" width="${GCELL_W}" height="${GCELL_H}" fill="#161b22" rx="3"/>
<text x="${(cx+5).toFixed(1)}" y="${(cy+12).toFixed(1)}" fill="#8b949e" font-family="monospace" font-size="9" font-weight="bold">${rc.label}</text>
<text x="${(cx+GCELL_W-4).toFixed(1)}" y="${(cy+12).toFixed(1)}" text-anchor="end" fill="#484f58" font-family="monospace" font-size="7">${barLabel} bars · ${fmtPct(axisMin)}→${fmtPct(axisMax)}</text>
<rect x="${chx}" y="${chy}" width="${cchw}" height="${GCHART_H}" fill="#0d1117" rx="2"/>
${gridLines.join('\n')}
${[...benchSyms.map(s => polylineFor(s, true)), ...mainSyms.map(s => polylineFor(s, false))].filter(Boolean).join('\n')}
${zoomBoxSvg}
<rect x="${chx}" y="${chy}" width="${cchw}" height="${GCHART_H}" fill="none" stroke="#30363d" stroke-width="0.5" rx="2"/>`);
  }

  // Shared legend
  const legendY    = PAD_TOP + GROWS * GCELL_H + (GROWS - 1) * GAP_Y + 10;
  const legItemW   = (SVG_W - 2 * PAD_X) / GLEG_COLS;
  const legendItems = mainSyms.map((sym, li) => {
    const lx    = PAD_X + (li % GLEG_COLS) * legItemW;
    const ly    = legendY + Math.floor(li / GLEG_COLS) * 18 + 12;
    const color = colorMap.get(sym)!;
    const label = legendLabel(sym);
    return `<line x1="${lx.toFixed(1)}" y1="${(ly-3).toFixed(1)}" x2="${(lx+16).toFixed(1)}" y2="${(ly-3).toFixed(1)}" stroke="${color}" stroke-width="2"/>` +
           `<text x="${(lx+20).toFixed(1)}" y="${ly.toFixed(1)}" fill="${color}" font-family="monospace" font-size="10" font-weight="bold">${label}</text>`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${G_SVG_H}" width="${SVG_W}" height="${G_SVG_H}">
  <defs>${defs.join('')}</defs>
  <rect width="${SVG_W}" height="${G_SVG_H}" fill="#0d1117" rx="8"/>
  <text x="${SVG_W/2}" y="24" text-anchor="middle" fill="#e6edf3" font-family="monospace" font-size="14" font-weight="bold">${groupName} — All Durations % Change</text>
  <text x="${SVG_W/2}" y="40" text-anchor="middle" fill="#6e7681" font-family="monospace" font-size="10">per-panel Y-axis · normalized to midpoint · benchmarks dashed</text>
  ${cells.join('\n')}
  ${legendItems}
</svg>`;

  mkdirSync(CHARTS_DIR, { recursive: true });
  const fname   = `group_${groupName}_chart.svg`;
  const outFile = resolve(CHARTS_DIR, fname);
  writeFileSync(outFile, svg, 'utf8');
  console.log(`\n✓  SVG saved → ${outFile}`);
  console.log(`\n![${groupName} — All Durations](${BASE_URL}/charts/${fname}?t=${Date.now()})\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Collect all unique symbols
  const allSymbols = new Set<string>();
  for (const [, g] of groups) {
    g.tickers.forEach(t => allSymbols.add(t.symbol));
    (g.benchmarks ?? ['^GSPC']).forEach(b => allSymbols.add(b));
  }

  console.log(`⏳ Fetching ${allSymbols.size} symbols [${rangeConfig.label}]...`);
  const syms    = [...allSymbols];
  const settled = await Promise.allSettled(syms.map(s => fetchData(s)));
  const dataMap = new Map<string, SeriesData>();
  for (let i = 0; i < syms.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') { dataMap.set(syms[i], r.value); process.stdout.write(`✓ ${syms[i]}  `); }
    else                          { process.stdout.write(`✗ ${syms[i]}  `); }
  }
  console.log();

  // Global Y bounds — use 5th/95th percentile so one extreme outlier
  // (e.g. Hanwha Solutions +32%) doesn't flatten everything else.
  // Outlier lines are clipped within each cell via clipPath.
  const allPcts: number[] = [];
  for (const [, s] of dataMap) {
    toPercent(s.closes).forEach(p => { if (p !== null) allPcts.push(p); });
  }
  allPcts.sort((a, b) => a - b);
  const pMin = Math.min(...allPcts, -10);
  const pMax = Math.max(...allPcts, 10);
  const yPad = (pMax - pMin) * 0.06;
  const { axisMin, axisMax, step } = niceAxis(pMin - yPad, pMax + yPad);
  const yRange = axisMax - axisMin;

  console.log(`\nShared Y-axis: ${fmtPct(axisMin)} → ${fmtPct(axisMax)}  (step ${step}%)`);

  // Reference timestamps for title dates
  const refSeries = [...dataMap.values()].reduce((a, b) => a.timestamps.length >= b.timestamps.length ? a : b);

  // ─── Render cells ───────────────────────────────────────────────────────────

  const defs: string[]  = [];
  const cells: string[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const [groupName, group] = groups[gi];
    const col  = gi % COLS;
    const row  = Math.floor(gi / COLS);
    const cx   = PAD_X + col * (CELL_W + GAP_X);
    const cy   = PAD_TOP + row * (CELL_H + GAP_Y);
    const chx  = cx + AXIS_W;
    const chy  = cy + TITLE_H + 6;
    const cchw = CELL_W - AXIS_W - 2;
    const clipId = `cc${gi}`;

    defs.push(`<clipPath id="${clipId}"><rect x="${chx}" y="${chy}" width="${cchw}" height="${CHART_H}"/></clipPath>`);

    // Y helpers for this cell
    const pyC = (pct: number) => chy + (1 - (pct - axisMin) / yRange) * CHART_H;

    // Grid lines
    const gridLines: string[] = [];
    for (let p = axisMin; p <= axisMax + 1e-9; p += step) {
      const y      = pyC(p);
      const isZero = Math.abs(p) < 1e-9;
      gridLines.push(
        `<line x1="${chx}" y1="${y.toFixed(1)}" x2="${(chx + cchw).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${isZero ? '#388bfd' : '#21262d'}" stroke-width="${isZero ? '0.8' : '0.5'}" ${isZero ? 'opacity="0.7"' : ''}/>`,
      );
      // Y-axis label
      gridLines.push(
        `<text x="${(cx + AXIS_W - 3).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="${isZero ? '#58a6ff' : '#484f58'}" font-family="monospace" font-size="7">${fmtPct(p)}</text>`,
      );
    }

    // Series — benchmarks drawn first (behind)
    const mainSyms  = group.tickers.map(t => t.symbol).filter(s => dataMap.has(s));
    const benchSyms = (group.benchmarks ?? ['^GSPC']).filter(s => dataMap.has(s));

    let mainIdx = 0, benchIdx = 0;
    const colorOf = (sym: string) =>
      isBenchmark(sym) ? BENCH_PALETTE[benchIdx++ % BENCH_PALETTE.length]
                       : PALETTE[mainIdx++ % PALETTE.length];

    // Assign colors first pass (so legend can reference them)
    const colorMap = new Map<string, string>();
    // Reset counters
    mainIdx = 0; benchIdx = 0;
    [...benchSyms, ...mainSyms].forEach(s => colorMap.set(s, colorOf(s)));

    const polylineFor = (sym: string, bench: boolean) => {
      const s   = dataMap.get(sym)!;
      const n   = s.closes.length;
      const pxS = (i: number) => chx + (i / Math.max(n - 1, 1)) * cchw;
      const pts = toPercent(s.closes)
        .map((p, i) => p === null ? null : `${pxS(i).toFixed(1)},${pyC(p).toFixed(1)}`)
        .filter(Boolean).join(' ');
      const color = colorMap.get(sym)!;
      return bench
        ? `<polyline clip-path="url(#${clipId})" points="${pts}" fill="none" stroke="${color}" stroke-width="0.8" stroke-dasharray="3,2" opacity="0.55" stroke-linejoin="round"/>`
        : `<polyline clip-path="url(#${clipId})" points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    };

    const polylines = [
      ...benchSyms.map(s => polylineFor(s, true)),
      ...mainSyms.map(s => polylineFor(s, false)),
    ].join('\n');

    // Zoom box: show smaller duration range dynamically
    const zoomHoursBack = ZOOM_MAP[rangeKey];
    let zoomBoxSvg = '';
    if (zoomHoursBack !== null) {
      const zoomCoords = calculateZoomBoxCoords(refSeries, zoomHoursBack, chx, cchw);
      if (zoomCoords) {
        zoomBoxSvg = `<rect x="${zoomCoords.startX.toFixed(1)}" y="${chy.toFixed(1)}" width="${zoomCoords.width.toFixed(1)}" height="${CHART_H}" fill="rgba(100, 150, 255, 0.12)" stroke="#6496ff" stroke-width="1.5" rx="2"/>`;
      }
    }

    // Compact legend: ticker + final % (main tickers only, 2 rows max)
    const legendTop = chy + CHART_H + 7;
    const itemW     = (CELL_W - 2) / LEG_COLS;
    const legendSvg = mainSyms.slice(0, LEG_COLS * 2).map((sym, li) => {
      const lcol     = li % LEG_COLS;
      const lrow     = Math.floor(li / LEG_COLS);
      const lx       = cx + 2 + lcol * itemW;
      const ly       = legendTop + lrow * LEG_ROW_H + 9;
      const pcts     = toPercent(dataMap.get(sym)!.closes).filter((p): p is number => p !== null);
      const finalPct = pcts[pcts.length - 1] ?? 0;
      const color    = colorMap.get(sym)!;
      const pctClr   = finalPct >= 0 ? '#3fb950' : '#f85149';
      const label    = legendLabel(sym);
      return [
        `<line x1="${lx.toFixed(1)}" y1="${(ly - 3).toFixed(1)}" x2="${(lx + 10).toFixed(1)}" y2="${(ly - 3).toFixed(1)}" stroke="${color}" stroke-width="1.5"/>`,
        `<text x="${(lx + 13).toFixed(1)}" y="${ly.toFixed(1)}" fill="${color}" font-family="monospace" font-size="7.5" font-weight="bold">${label}</text>`,
        `<text x="${(lx + 13 + label.length * 4.8).toFixed(1)}" y="${ly.toFixed(1)}" fill="${pctClr}" font-family="monospace" font-size="7.5"> ${fmtPct(finalPct)}</text>`,
      ].join('');
    }).join('\n');

    // Cell background + title
    cells.push(`
<!-- ── ${groupName} ──────────── -->
<rect x="${cx}" y="${cy}" width="${CELL_W}" height="${CELL_H}" fill="#161b22" rx="3"/>
<text x="${(cx + 5).toFixed(1)}" y="${(cy + 12).toFixed(1)}" fill="#8b949e" font-family="monospace" font-size="9" font-weight="bold">${groupName}</text>
<rect x="${chx}" y="${chy}" width="${cchw}" height="${CHART_H}" fill="#0d1117" rx="2"/>
${gridLines.join('\n')}
${polylines}
${zoomBoxSvg}
<rect x="${chx}" y="${chy}" width="${cchw}" height="${CHART_H}" fill="none" stroke="#30363d" stroke-width="0.5" rx="2"/>
${legendSvg}`);
  }

  // ─── Assemble SVG ──────────────────────────────────────────────────────────

  const startDate = fmtDate(refSeries.timestamps[0]);
  const endDate   = fmtDate(refSeries.timestamps[refSeries.timestamps.length - 1]);
  const barLabel  = rangeConfig.intervalType === 'hour' ? '1h' : rangeConfig.intervalType === 'day' ? '1d' : '1wk';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">
  <defs>${defs.join('')}</defs>
  <rect width="${SVG_W}" height="${SVG_H}" fill="#0d1117" rx="8"/>
  <text x="${SVG_W / 2}" y="24" text-anchor="middle" fill="#e6edf3" font-family="monospace" font-size="14" font-weight="bold">Watchlist Overview — ${rangeConfig.label} % Change</text>
  <text x="${SVG_W / 2}" y="40" text-anchor="middle" fill="#6e7681" font-family="monospace" font-size="10">${startDate} – ${endDate} · ${barLabel} bars · shared Y-axis · normalized to midpoint · extreme outliers clipped</text>
  ${cells.join('\n')}
</svg>`;

  mkdirSync(CHARTS_DIR, { recursive: true });
  const fname   = `overview_${rangeKey}_chart.svg`;
  const outFile = resolve(CHARTS_DIR, fname);
  writeFileSync(outFile, svg, 'utf8');
  console.log(`\n✓  SVG saved → ${outFile}`);
  console.log(`\n![Watchlist Overview ${rangeConfig.label}](${BASE_URL}/charts/${fname}?t=${Date.now()})\n`);
}

if (rangeArg.startsWith('_group:')) {
  mainGroupWise(rangeArg.slice(7)).catch(err => { console.error('❌', err.message); process.exit(1); });
} else {
  main().catch(err => { console.error('❌', err.message); process.exit(1); });
}
