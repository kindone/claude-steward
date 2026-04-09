#!/usr/bin/env npx tsx
/**
 * overview-chart-vl.ts — Watchlist overview: one mini-chart per group, interactive Vega-Lite
 *
 * Outputs a Vega-Lite JSON spec (faceted by group) to stdout.
 * Capture stdout and pass to `artifact_create` (type "chart") to display in the Art panel.
 *
 * Usage:
 *   npm run overview-chart-vl                    # all groups, default 5d
 *   npm run overview-chart-vl -- 1mo             # all groups, custom range
 *   npm run overview-chart-vl -- group:us-bigtech         # single group, 5d
 *   npm run overview-chart-vl -- group:us-bigtech 3mo     # single group + range
 *
 * Range options (default: 5d):
 *   1d | 5d | 1w | 1mo | 1m | 3mo | 3m | 6mo | 6m | 1y | 2y
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithCache, type SeriesData } from './lib/fetch.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const CHARTS_DIR = resolve(__dirname, '../server/data/charts');
const WATCHLIST  = resolve(__dirname, 'watchlist.json');

// ─── Watchlist types ──────────────────────────────────────────────────────────

interface WatchlistEntry { symbol: string; name: string }
interface WatchlistGroupRaw {
  description: string;
  tickers:     WatchlistEntry[];
  benchmarks?: string[];
}
// Normalized form with id injected
interface WatchlistGroup {
  id:          string;
  description: string;
  entries:     WatchlistEntry[];
  benchmarks?: string[];
}
interface Watchlist { groups: Record<string, WatchlistGroupRaw> }

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

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// Parse group filter
let groupFilter: string | null = null;
const filteredArgs: string[] = [];
for (const a of args) {
  if (a.startsWith('group:')) { groupFilter = a.slice(6); }
  else                         { filteredArgs.push(a); }
}

// Parse range
let rangeKey = '5d';
if (filteredArgs.length > 0 && RANGE_MAP[filteredArgs[0].toLowerCase()]) {
  rangeKey = filteredArgs[0].toLowerCase();
}

const rangeConfig = RANGE_MAP[rangeKey];

// ─── Colors ───────────────────────────────────────────────────────────────────

const PALETTE           = [
  '#58a6ff', '#f0883e', '#3fb950', '#bc8cff', '#ffa657', '#ff7b72', '#79c0ff',
  '#e3b341', '#56d364', '#d2a8ff', '#ffa198', '#39d3bb',
  '#f778ba', '#87d96c', '#ffb347', '#00cfcf', '#c084fc', '#fb923c', '#34d399', '#f472b6',
];
const BENCHMARK_PALETTE = ['#8b949e', '#6e7681', '#b1bac4', '#484f58'];

// ─── Normalize ────────────────────────────────────────────────────────────────

function toPercent(closes: (number | null)[]): (number | null)[] {
  const midIdx = Math.floor(closes.length / 2);
  const base   = closes[midIdx] ?? closes.find(c => c !== null);
  if (base == null) return closes.map(() => null);
  return closes.map(c => c === null ? null : ((c - base) / base) * 100);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(ts: number) {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ─── Spec builder ─────────────────────────────────────────────────────────────

const DARK_CONFIG = {
  background:  '#0d1117',
  view:        { stroke: '#30363d', fill: '#161b22' },
  axis: {
    gridColor:   '#21262d', gridOpacity: 1,
    domainColor: '#30363d', tickColor:   '#30363d',
    labelColor:  '#6e7681', titleColor:  '#8b949e',
    labelFont:   'monospace', titleFont: 'monospace',
  },
  legend:  { labelColor: '#8b949e', titleColor: '#8b949e', labelFont: 'monospace' },
  title:   { color: '#e6edf3', subtitleColor: '#6e7681', font: 'monospace', subtitleFont: 'monospace' },
  tooltip: { theme: 'dark' },
  facet:   { spacing: 12 },
  header:  {
    labelColor:  '#e6edf3', labelFont: 'monospace', labelFontSize: 12, labelFontWeight: 'bold',
    titleColor:  '#8b949e', titleFont: 'monospace',
    labelPadding: 4,
  },
};

interface FlatRecord {
  time:        string;
  pct:         number;
  symbol:      string;
  seriesType:  string;
  group:       string;
  groupLabel:  string;
  finalPct:    string;
  color:       string;
}

function buildSpec(
  groups:    WatchlistGroup[],
  allData:   Map<string, SeriesData>,
  colorMap:  Map<string, string>,
): object {
  const records: FlatRecord[] = [];
  let globalStart = Infinity, globalEnd = -Infinity;

  for (const group of groups) {
    const allSymbols = [
      ...group.entries.map(e => e.symbol),
      ...(group.benchmarks ?? []),
    ];

    for (const sym of allSymbols) {
      const s = allData.get(sym);
      if (!s || s.closes.every(c => c === null)) continue;

      const pcts       = toPercent(s.closes);
      const validPcts  = pcts.filter((p): p is number => p !== null);
      const finalPct   = validPcts[validPcts.length - 1] ?? 0;
      const finalLabel = `${finalPct >= 0 ? '+' : ''}${finalPct.toFixed(1)}%`;
      const seriesType = sym.startsWith('^') ? 'benchmark' : 'stock';
      const color      = colorMap.get(sym) ?? '#6e7681';

      for (let i = 0; i < s.timestamps.length; i++) {
        if (pcts[i] === null) continue;
        const ts = s.timestamps[i];
        if (ts < globalStart) globalStart = ts;
        if (ts > globalEnd)   globalEnd   = ts;
        records.push({
          time:       new Date(ts * 1000).toISOString(),
          pct:        pcts[i]!,
          symbol:     sym,
          seriesType,
          group:      group.id,
          groupLabel: group.description,
          finalPct:   finalLabel,
          color,
        });
      }
    }
  }

  const allSymbols    = [...colorMap.keys()];
  const allColors     = allSymbols.map(s => colorMap.get(s)!);
  const groupIds      = groups.map(g => g.id);
  const groupLabels   = groups.map(g => g.description);
  const intervalLabel = rangeConfig.intervalType === 'hour' ? '1h' : rangeConfig.intervalType === 'day' ? '1d' : '1wk';
  const subtitle      = `${fmtDate(globalStart)} – ${fmtDate(globalEnd)} · ${intervalLabel} bars · normalized per group`;

  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: {
      text:     `Watchlist Overview — ${rangeConfig.label}`,
      subtitle,
    },
    width:   450,
    height:  130,
    config:  DARK_CONFIG,
    data:    { values: records },
    facet: {
      field:  'group',
      type:   'nominal',
      sort:   groupIds,
      header: {
        title: null,
        labelExpr: `pluck(${JSON.stringify(groupIds.map((id, i) => ({ id, label: groupLabels[i] })))}, 'id').indexOf(datum.value) >= 0 ? ${JSON.stringify(groupLabels)}[indexof(${JSON.stringify(groupIds)}, datum.value)] : datum.value`,
      },
    },
    columns: 2,
    spec: {
      layer: [
        // Zero-line
        {
          mark:     { type: 'rule', color: '#388bfd', strokeDash: [4, 3], opacity: 0.3 },
          encoding: { y: { datum: 0, type: 'quantitative' } },
        },
        // Lines
        {
          mark: { type: 'line', interpolate: 'linear' },
          encoding: {
            x: {
              field: 'time', type: 'temporal', title: null,
              axis: { labels: false, ticks: false, domain: false, grid: false },
            },
            y: {
              field: 'pct', type: 'quantitative', title: '% Δ',
              axis: { format: '+.0f', labelFontSize: 9 },
              scale: { zero: false },
            },
            color: {
              field: 'symbol', type: 'nominal',
              scale: { domain: allSymbols, range: allColors },
              legend: null,
            },
            strokeDash: {
              field:  'seriesType', type: 'nominal',
              scale:  { domain: ['stock', 'benchmark'], range: [[1, 0], [5, 3]] },
              legend: null,
            },
            strokeWidth: {
              field:  'seriesType', type: 'nominal',
              scale:  { domain: ['stock', 'benchmark'], range: [2, 1] },
              legend: null,
            },
            opacity: {
              field:  'seriesType', type: 'nominal',
              scale:  { domain: ['stock', 'benchmark'], range: [1, 0.55] },
              legend: null,
            },
            tooltip: [
              { field: 'groupLabel', type: 'nominal',     title: 'Group' },
              { field: 'symbol',     type: 'nominal',     title: 'Ticker' },
              { field: 'time',       type: 'temporal',    title: 'Date', format: rangeConfig.intervalType === 'hour' ? '%b %d %H:%M' : '%b %d, %Y' },
              { field: 'pct',        type: 'quantitative', title: '% vs mid', format: '+.2f' },
              { field: 'finalPct',   type: 'nominal',     title: 'Period Δ' },
            ],
          },
        },
      ],
    },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const watchlist: Watchlist = JSON.parse(readFileSync(WATCHLIST, 'utf8'));

  // Normalize object → array with id injected
  const allGroups: WatchlistGroup[] = Object.entries(watchlist.groups).map(([id, g]) => ({
    id,
    description: g.description,
    entries:     g.tickers,
    benchmarks:  g.benchmarks,
  }));

  // Filter groups
  const groups = groupFilter
    ? allGroups.filter(g => g.id === groupFilter)
    : allGroups;

  if (groups.length === 0) {
    const ids = allGroups.map(g => g.id).join(', ');
    process.stderr.write(`❌ Group "${groupFilter}" not found. Available: ${ids}\n`);
    process.exit(1);
  }

  // Collect all unique symbols (tickers + benchmarks per group)
  const allSymbols = new Set<string>();
  for (const g of groups) {
    for (const e of g.entries)          allSymbols.add(e.symbol);
    for (const b of g.benchmarks ?? []) allSymbols.add(b);
  }

  process.stderr.write(`⏳ Fetching ${allSymbols.size} symbols across ${groups.length} group(s) [${rangeConfig.label} / ${rangeConfig.interval}]...\n`);

  // Fetch all with cache
  const allData = new Map<string, SeriesData>();
  await Promise.all([...allSymbols].map(async sym => {
    try {
      const data = await fetchWithCache(sym, rangeConfig.yahooRange, rangeConfig.interval, rangeConfig.intervalType);
      allData.set(sym, data);
      process.stderr.write(`✓  ${sym}\n`);
    } catch (err: any) {
      process.stderr.write(`⚠  ${sym}: ${err.message}\n`);
    }
  }));

  // Assign colors: consistent per symbol (stocks=PALETTE, benchmarks=BENCHMARK_PALETTE)
  const colorMap = new Map<string, string>();
  let mainIdx = 0, benchIdx = 0;
  // Go through groups in order for deterministic color assignment
  for (const g of groups) {
    for (const e of g.entries) {
      if (!colorMap.has(e.symbol)) colorMap.set(e.symbol, PALETTE[mainIdx++ % PALETTE.length]);
    }
    for (const b of g.benchmarks ?? []) {
      if (!colorMap.has(b)) colorMap.set(b, BENCHMARK_PALETTE[benchIdx++ % BENCHMARK_PALETTE.length]);
    }
  }

  const spec = buildSpec(groups, allData, colorMap);
  const json = JSON.stringify(spec, null, 2);

  mkdirSync(CHARTS_DIR, { recursive: true });
  const suffix  = groupFilter ? `_${groupFilter}` : '';
  const fname   = `overview${suffix}_${rangeKey}.vl.json`;
  const outFile = resolve(`${CHARTS_DIR}/${fname}`);
  writeFileSync(outFile, json, 'utf8');
  process.stderr.write(`\n✓  Spec → ${outFile}\n`);
  process.stderr.write('Pass stdout to artifact_create (type: "chart") to display in Art panel.\n');

  process.stdout.write(json + '\n');
}

main().catch(err => {
  process.stderr.write(`❌ ${err.message}\n`);
  process.exit(1);
});
