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
  '1d':  { yahooRange: '1d',  interval: '1h',  intervalType: 'hour', label: '1 Day'    },
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

// ─── "all" mode: re-spawn once per range in parallel ─────────────────────────

if (rangeArg === 'all') {
  const ALL_RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y'];
  const script     = fileURLToPath(import.meta.url);
  const procs = ALL_RANGES.map(r =>
    spawn(process.execPath, ['--import', 'tsx/esm', script, r], {
      stdio: 'inherit',
      env:   { ...process.env },
    })
  );
  const codes = await Promise.all(procs.map(p => new Promise<number>(res => p.on('close', res))));
  const failed = codes.filter(c => c !== 0).length;
  process.exit(failed ? 1 : 0);
}

const rangeKey    = RANGE_MAP[rangeArg] ? rangeArg : '5d';
const rangeConfig = RANGE_MAP[rangeKey];

// ─── Watchlist ────────────────────────────────────────────────────────────────

interface WatchlistTicker { symbol: string; name: string }
interface WatchlistGroup  { description: string; benchmarks?: string[]; tickers: WatchlistTicker[] }
interface Watchlist       { groups: Record<string, WatchlistGroup> }

const watchlist = JSON.parse(readFileSync(WATCHLIST, 'utf8')) as Watchlist;
const groups    = Object.entries(watchlist.groups);

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
  const p05  = allPcts[Math.floor(allPcts.length * 0.05)] ?? -10;
  const p95  = allPcts[Math.floor(allPcts.length * 0.95)] ?? 10;
  const yPad = (p95 - p05) * 0.06;
  const { axisMin, axisMax, step } = niceAxis(p05 - yPad, p95 + yPad);
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
      const label    = sym.replace(/\.\w+$/, ''); // strip exchange suffix for brevity
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
  console.log(`\n![Watchlist Overview ${rangeConfig.label}](${BASE_URL}/charts/${fname})\n`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
