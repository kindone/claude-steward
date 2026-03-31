#!/usr/bin/env npx tsx
/**
 * compare-chart.ts — Multi-stock normalized % change comparison chart
 *
 * Usage:
 *   npm run compare-chart -- [range] TICKER1 TICKER2 ...
 *
 * Range options (default: 5d):
 *   1d          — today, hourly bars
 *   5d | 1w     — 5 trading days, hourly bars
 *   1mo | 1m    — 1 month, daily bars
 *   3mo | 3m    — 3 months, daily bars
 *   6mo | 6m    — 6 months, daily bars
 *   1y          — 1 year, weekly bars
 *   2y          — 2 years, weekly bars
 *
 * Benchmarks: any ^-prefixed ticker is treated as a dashed reference line.
 * If no ^-prefixed ticker is supplied, ^GSPC is added automatically.
 *
 * Examples:
 *   npm run compare-chart -- GOOG IBM AAPL AMD
 *   npm run compare-chart -- 3mo GOOG IBM AAPL AMD
 *   npm run compare-chart -- 1y GOOG MSFT
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithCache, type SeriesData } from './lib/fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/data/charts/ is outside the Vite build output (server/public/) so it
// survives `npm run build` which runs with emptyOutDir: true.
const CHARTS_DIR = resolve(__dirname, '../server/data/charts');
const BASE_URL   = 'https://steward.jradoo.com';

// ─── Range config ─────────────────────────────────────────────────────────────

interface RangeConfig {
  yahooRange:   string;
  interval:     string;
  intervalType: 'hour' | 'day' | 'week';
  label:        string;   // human-readable
}

const RANGE_MAP: Record<string, RangeConfig> = {
  '1d':  { yahooRange: '2d',  interval: '1m',  intervalType: 'hour', label: '1 Day'     },
  '5d':  { yahooRange: '5d',  interval: '1h',  intervalType: 'hour', label: '1 Week'    },
  '1w':  { yahooRange: '5d',  interval: '1h',  intervalType: 'hour', label: '1 Week'    },
  '1mo': { yahooRange: '1mo', interval: '1d',  intervalType: 'day',  label: '1 Month'   },
  '1m':  { yahooRange: '1mo', interval: '1d',  intervalType: 'day',  label: '1 Month'   },
  '3mo': { yahooRange: '3mo', interval: '1d',  intervalType: 'day',  label: '3 Months'  },
  '3m':  { yahooRange: '3mo', interval: '1d',  intervalType: 'day',  label: '3 Months'  },
  '6mo': { yahooRange: '6mo', interval: '1d',  intervalType: 'day',  label: '6 Months'  },
  '6m':  { yahooRange: '6mo', interval: '1d',  intervalType: 'day',  label: '6 Months'  },
  '1y':  { yahooRange: '1y',  interval: '1wk', intervalType: 'week', label: '1 Year'    },
  '2y':  { yahooRange: '2y',  interval: '1wk', intervalType: 'week', label: '2 Years'   },
};

const DEFAULT_RANGE = '5d';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npx tsx scripts/compare-chart.ts [range] TICKER1 TICKER2 ...');
  console.error('Ranges: 1d | 5d | 1w | 1mo | 3mo | 6mo | 1y | 2y');
  process.exit(1);
}

// If first arg looks like a range key, consume it; otherwise default.
let rangeKey: string;
let rawTickers: string[];
if (RANGE_MAP[args[0].toLowerCase()]) {
  rangeKey   = args[0].toLowerCase();
  rawTickers = args.slice(1);
} else {
  rangeKey   = DEFAULT_RANGE;
  rawTickers = args;
}

if (rawTickers.length === 0) {
  console.error('At least one ticker required.');
  process.exit(1);
}

const rangeConfig  = RANGE_MAP[rangeKey];
const userTickers  = rawTickers.map(t => t.toUpperCase());

// Auto-add ^GSPC only when no ^-prefixed benchmark is explicitly provided.
const hasExplicitBenchmark = userTickers.some(t => t.startsWith('^'));
const allTickers = hasExplicitBenchmark
  ? [...new Set(userTickers)]
  : [...new Set([...userTickers, '^GSPC'])];

// ─── Fetch ────────────────────────────────────────────────────────────────────

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fetchData(sym: string): Promise<SeriesData> {
  const { yahooRange, interval, intervalType } = rangeConfig;
  return fetchWithCache(sym, yahooRange, interval, intervalType);
}

// ─── Normalize ───────────────────────────────────────────────────────────────

function toPercent(closes: (number | null)[]): (number | null)[] {
  // Normalize to the midpoint of the series so all lines cross 0% at the
  // horizontal center of the chart, making left-half and right-half symmetric.
  const midIdx = Math.floor(closes.length / 2);
  const base   = closes[midIdx] ?? closes.find(c => c !== null);
  if (base == null) return closes.map(() => null);
  return closes.map(c => c === null ? null : ((c - base) / base) * 100);
}

// ─── Axis helpers ─────────────────────────────────────────────────────────────

function niceAxis(min: number, max: number, targetSteps = 8) {
  const range    = max - min || 1;
  const raw      = range / targetSteps;
  const mag      = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  const niceStep = [0.5, 1, 2, 2.5, 5, 10].find(s => s * mag >= raw)! * mag;
  return {
    axisMin: Math.floor(min / niceStep) * niceStep,
    axisMax: Math.ceil(max  / niceStep) * niceStep,
    step:    niceStep,
  };
}

// ─── X-axis segmentation ─────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function fmtMonthOnly(ts: number): string {
  return MONTHS[new Date(ts * 1000).getUTCMonth()];
}

function fmtMonthYear(ts: number): string {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
}

interface XSegment { startIdx: number; endIdx: number; label: string }

function getXSegments(timestamps: number[], intervalType: 'hour' | 'day' | 'week'): XSegment[] {
  const n = timestamps.length;

  if (intervalType === 'hour') {
    // Segment by trading day: gap > 2 hours = new day
    const starts = [0];
    for (let i = 1; i < n; i++) {
      if (timestamps[i] - timestamps[i - 1] > 7200) starts.push(i);
    }
    return starts.map((si, s) => ({
      startIdx: si,
      endIdx:   s + 1 < starts.length ? starts[s + 1] - 1 : n - 1,
      label:    fmtDate(timestamps[si]),
    }));
  }

  // Daily or weekly: segment by calendar month
  const multiYear =
    new Date(timestamps[n - 1] * 1000).getUTCFullYear() >
    new Date(timestamps[0]     * 1000).getUTCFullYear();
  const fmtLabel = multiYear ? fmtMonthYear : fmtMonthOnly;

  const starts: number[] = [0];
  let lastMonth = new Date(timestamps[0] * 1000).getUTCMonth();
  for (let i = 1; i < n; i++) {
    const m = new Date(timestamps[i] * 1000).getUTCMonth();
    if (m !== lastMonth) { starts.push(i); lastMonth = m; }
  }

  return starts.map((si, s) => ({
    startIdx: si,
    endIdx:   s + 1 < starts.length ? starts[s + 1] - 1 : n - 1,
    label:    fmtLabel(timestamps[si]),
  }));
}

function fmtPct(p: number): string {
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const PALETTE           = [
  '#58a6ff', '#f0883e', '#3fb950', '#bc8cff', '#ffa657', '#ff7b72', '#79c0ff',
  '#e3b341', '#56d364', '#d2a8ff', '#ffa198', '#39d3bb',
  '#f778ba', '#87d96c', '#ffb347', '#00cfcf', '#c084fc', '#fb923c',
  '#34d399', '#f472b6',
];
const BENCHMARK_PALETTE = ['#8b949e', '#6e7681', '#b1bac4', '#484f58'];

// Any ^-prefixed symbol is a benchmark: rendered dashed + muted color
function isBenchmark(sym: string) {
  return sym.startsWith('^');
}

// ─── SVG builder ─────────────────────────────────────────────────────────────

function buildSVG(allSeries: SeriesData[]): string {
  const W  = 900;
  const ML = 78, MT = 56, MR = 22;
  const CW = W - ML - MR;

  // Dynamic bottom margin: accommodate multi-row legend
  const ITEMS_PER_ROW  = Math.floor(CW / 112);
  const legendRows     = Math.ceil(allSeries.length / ITEMS_PER_ROW);
  const MB             = 36 + legendRows * 22;   // x-axis labels (36) + legend rows
  const H              = MT + 348 + MB;           // fixed plot area height of 348
  const CH             = 348;

  // Normalize + annotate each series
  let mainIdx = 0, benchIdx = 0;
  const series = allSeries.map(s => {
    const pcts      = toPercent(s.closes);
    const finalPct  = [...pcts].reverse().find(p => p !== null) ?? 0;
    const benchmark = isBenchmark(s.symbol);
    const color     = benchmark
      ? BENCHMARK_PALETTE[benchIdx++ % BENCHMARK_PALETTE.length]
      : PALETTE[mainIdx++ % PALETTE.length];
    return { ...s, pcts, finalPct, isBenchmark: benchmark, color };
  });

  // Global Y-axis bounds across all series
  const allPcts = series.flatMap(s => s.pcts.filter((p): p is number => p !== null));
  const rawMin  = Math.min(...allPcts);
  const rawMax  = Math.max(...allPcts);
  const yPad    = Math.max((rawMax - rawMin) * 0.10, 0.1);
  const { axisMin, axisMax, step } = niceAxis(rawMin - yPad, rawMax + yPad);
  const yRange  = axisMax - axisMin;

  const pyShared = (pct: number) => MT + (1 - (pct - axisMin) / yRange) * CH;
  const zeroY    = pyShared(0);

  // X-axis: use reference series (longest one) for segments/labels
  const refSeries  = allSeries.reduce((a, b) => a.timestamps.length >= b.timestamps.length ? a : b);
  const refTs      = refSeries.timestamps;
  const refN       = refTs.length;
  const pxRef      = (i: number) => ML + (i / Math.max(refN - 1, 1)) * CW;
  const segments   = getXSegments(refTs, rangeConfig.intervalType);

  // Separator x-positions (between segments)
  const sepXs = segments.slice(1).map(seg => (pxRef(seg.startIdx - 1) + pxRef(seg.startIdx)) / 2);
  // Label x-positions (midpoint of each segment)
  const xLabels = segments.map(seg => ({
    x:     pxRef((seg.startIdx + seg.endIdx) / 2),
    label: seg.label,
  }));

  // Grid lines
  const gridLines: Array<{ y: number; label: string; isZero: boolean }> = [];
  for (let p = axisMin; p <= axisMax + 1e-9; p += step) {
    gridLines.push({ y: pyShared(p), label: fmtPct(p), isZero: Math.abs(p) < 1e-9 });
  }

  // Polyline points per series (each uses its own n for x-scale)
  const lineData = series.map(s => {
    const sN  = s.closes.length;
    const pxS = (i: number) => ML + (i / Math.max(sN - 1, 1)) * CW;
    const pts = s.pcts
      .map((p, i) => p === null ? null : `${pxS(i).toFixed(1)},${pyShared(p).toFixed(1)}`)
      .filter(Boolean)
      .join(' ');
    return { ...s, pts };
  });

  const mainTickers  = userTickers.filter(t => !isBenchmark(t));
  const benchTickers = userTickers.filter(t => isBenchmark(t));
  const titleMain    = xmlEsc(mainTickers.join(' · '));
  const titleBench   = benchTickers.length ? ` vs ${xmlEsc(benchTickers.join(' · '))}` : hasExplicitBenchmark ? '' : ' vs S&amp;P 500';
  const startDate    = fmtDate(refTs[0]);
  const endDate      = fmtDate(refTs[refTs.length - 1]);
  const subtitle     = xmlEsc(`${startDate} – ${endDate} · ${rangeConfig.intervalType === 'hour' ? '1h' : rangeConfig.intervalType === 'day' ? '1d' : '1wk'} bars · normalized to midpoint`);

  const benchLines = lineData.filter(l => l.isBenchmark);
  const stockLines = lineData.filter(l => !l.isBenchmark);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <clipPath id="cc">
      <rect x="${ML}" y="${MT}" width="${CW}" height="${CH}"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="#0d1117" rx="8"/>

  <!-- Title -->
  <text x="${W / 2}" y="24" text-anchor="middle" fill="#e6edf3" font-family="monospace" font-size="14" font-weight="bold">${titleMain}${titleBench} — ${rangeConfig.label} % Change</text>
  <text x="${W / 2}" y="40" text-anchor="middle" fill="#6e7681" font-family="monospace" font-size="11">${subtitle}</text>

  <!-- Chart area -->
  <rect x="${ML}" y="${MT}" width="${CW}" height="${CH}" fill="#161b22" rx="2"/>

  <!-- Grid lines + Y-axis labels -->
  ${gridLines.map(g => {
    const stroke = g.isZero ? '#388bfd' : '#21262d';
    const sw     = g.isZero ? '1.5'    : '1';
    const op     = g.isZero ? ' opacity="0.8"' : '';
    const tf     = g.isZero ? '#58a6ff' : '#6e7681';
    return `<line x1="${ML}" y1="${g.y.toFixed(1)}" x2="${ML + CW}" y2="${g.y.toFixed(1)}" stroke="${stroke}" stroke-width="${sw}"${op}/>
  <text x="${ML - 6}" y="${(g.y + 4).toFixed(1)}" text-anchor="end" fill="${tf}" font-family="monospace" font-size="10">${g.label}</text>`;
  }).join('\n  ')}

  <!-- Day/period separator lines -->
  ${sepXs.map(x =>
    `<line x1="${x.toFixed(1)}" y1="${MT}" x2="${x.toFixed(1)}" y2="${MT + CH}" stroke="#30363d" stroke-width="1" stroke-dasharray="4,3"/>`
  ).join('\n  ')}

  <!-- Benchmark lines (dashed, behind) -->
  ${benchLines.map(l =>
    `<polyline clip-path="url(#cc)" points="${l.pts}" fill="none" stroke="${l.color}" stroke-width="1.5" stroke-dasharray="6,4" stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>`
  ).join('\n  ')}

  <!-- Stock lines -->
  ${stockLines.map(l =>
    `<polyline clip-path="url(#cc)" points="${l.pts}" fill="none" stroke="${l.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
  ).join('\n  ')}

  <!-- Chart border -->
  <rect x="${ML}" y="${MT}" width="${CW}" height="${CH}" fill="none" stroke="#30363d" stroke-width="1" rx="2"/>

  <!-- X-axis labels -->
  ${xLabels.map(l =>
    `<text x="${l.x.toFixed(1)}" y="${(MT + CH + 18).toFixed(1)}" text-anchor="middle" fill="#8b949e" font-family="monospace" font-size="11">${l.label}</text>`
  ).join('\n  ')}

  <!-- Legend (multi-row) -->
  ${lineData.map((l, i) => {
    const row      = Math.floor(i / ITEMS_PER_ROW);
    const col      = i % ITEMS_PER_ROW;
    const itemW    = CW / ITEMS_PER_ROW;
    const lx       = ML + col * itemW + itemW * 0.05;
    const ly       = MT + CH + 34 + row * 22;
    const dash     = l.isBenchmark ? ' stroke-dasharray="5,3"' : '';
    const sw       = l.isBenchmark ? '1.5' : '2.5';
    const pctColor = l.finalPct >= 0 ? '#3fb950' : '#f85149';
    const symLabel = l.symbol.replace(/&/g, '&amp;');
    const symLen   = l.symbol.length;
    return `<line x1="${lx.toFixed(1)}" y1="${ly}" x2="${(lx + 16).toFixed(1)}" y2="${ly}" stroke="${l.color}" stroke-width="${sw}"${dash}/>
  <text x="${(lx + 20).toFixed(1)}" y="${ly + 4}" fill="${l.color}" font-family="monospace" font-size="9" font-weight="bold">${symLabel}</text>
  <text x="${(lx + 20 + symLen * 5.5).toFixed(1)}" y="${ly + 4}" fill="${pctColor}" font-family="monospace" font-size="9"> ${fmtPct(l.finalPct)}</text>`;
  }).join('\n  ')}
</svg>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`⏳ Fetching ${allTickers.join(', ')} [${rangeConfig.label} / ${rangeConfig.interval} bars]...`);

  const results = await Promise.all(allTickers.map(t => fetchData(t)));

  for (const r of results) {
    const pcts     = toPercent(r.closes).filter((p): p is number => p !== null);
    const finalPct = pcts[pcts.length - 1] ?? 0;
    const hi       = Math.max(...pcts);
    const lo       = Math.min(...pcts);
    console.log(`✓  ${r.symbol.padEnd(8)} ${r.closes.filter(Boolean).length} pts  range [${fmtPct(lo)}, ${fmtPct(hi)}]  final ${fmtPct(finalPct)}`);
  }

  const svg = buildSVG(results);

  const rawSlug = userTickers.join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const slug    = rawSlug.length > 60
    ? `${rawSlug.slice(0, 40)}_and_${userTickers.length}tickers`
    : rawSlug;
  const fname   = `compare_${slug}_${rangeKey}_chart.svg`;
  const outFile = resolve(`${CHARTS_DIR}/${fname}`);
  writeFileSync(outFile, svg, 'utf8');
  console.log(`\n✓  SVG saved → ${outFile}`);

  const url = `${BASE_URL}/charts/${fname}?t=${Date.now()}`;
  console.log(`\n![${userTickers.join(' vs ')} ${rangeConfig.label}](${url})\n`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
