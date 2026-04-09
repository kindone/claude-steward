#!/usr/bin/env npx tsx
/**
 * compare-chart-vl.ts — Multi-stock normalized % change, interactive Vega-Lite chart
 *
 * Same CLI as compare-chart.ts, but outputs a Vega-Lite JSON spec instead of SVG.
 * Capture stdout and pass to `artifact_create` (type "chart") to display in the Art panel.
 *
 * Usage:
 *   npm run compare-chart-vl -- [range] TICKER1 TICKER2 ...
 *
 * Range options (default: 5d):
 *   1d | 5d | 1w | 1mo | 1m | 3mo | 3m | 6mo | 6m | 1y | 2y
 *
 * Benchmarks: any ^-prefixed ticker renders dashed + muted.
 * ^GSPC is auto-added if no benchmark is provided.
 *
 * Examples:
 *   npm run compare-chart-vl -- GOOG IBM AAPL AMD
 *   npm run compare-chart-vl -- 3mo GOOG IBM AAPL AMD
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWithCache, type SeriesData } from './lib/fetch.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const CHARTS_DIR = resolve(__dirname, '../server/data/charts');

// ─── Range config ─────────────────────────────────────────────────────────────

interface RangeConfig {
  yahooRange:   string;
  interval:     string;
  intervalType: 'hour' | 'day' | 'week';
  label:        string;
}

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
if (args.length === 0) {
  process.stderr.write('Usage: npx tsx scripts/compare-chart-vl.ts [range] TICKER1 TICKER2 ...\n');
  process.exit(1);
}

let rangeKey: string;
let rawTickers: string[];
if (RANGE_MAP[args[0].toLowerCase()]) {
  rangeKey   = args[0].toLowerCase();
  rawTickers = args.slice(1);
} else {
  rangeKey   = '5d';
  rawTickers = args;
}

if (rawTickers.length === 0) {
  process.stderr.write('At least one ticker required.\n');
  process.exit(1);
}

const rangeConfig  = RANGE_MAP[rangeKey];
const userTickers  = rawTickers.map(t => t.toUpperCase());
const hasExplicitBenchmark = userTickers.some(t => t.startsWith('^'));
const allTickers = hasExplicitBenchmark
  ? [...new Set(userTickers)]
  : [...new Set([...userTickers, '^GSPC'])];

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
};

function buildSpec(allSeries: SeriesData[]): object {
  // Assign colors: stocks get PALETTE, benchmarks get BENCHMARK_PALETTE
  let mainIdx = 0, benchIdx = 0;
  const colorDomain: string[] = [];
  const colorRange:  string[] = [];
  for (const s of allSeries) {
    const isBench = s.symbol.startsWith('^');
    colorDomain.push(s.symbol);
    colorRange.push(isBench
      ? BENCHMARK_PALETTE[benchIdx++ % BENCHMARK_PALETTE.length]
      : PALETTE[mainIdx++ % PALETTE.length]);
  }

  // Build flat records: pre-normalize each series to its midpoint %
  interface Rec { time: string; pct: number; symbol: string; seriesType: string; finalPct: string }
  const records: Rec[] = [];
  for (const s of allSeries) {
    const pcts       = toPercent(s.closes);
    const validPcts  = pcts.filter((p): p is number => p !== null);
    const finalPct   = validPcts[validPcts.length - 1] ?? 0;
    const finalLabel = `${finalPct >= 0 ? '+' : ''}${finalPct.toFixed(1)}%`;
    const seriesType = s.symbol.startsWith('^') ? 'benchmark' : 'stock';
    for (let i = 0; i < s.timestamps.length; i++) {
      if (pcts[i] === null) continue;
      records.push({
        time:       new Date(s.timestamps[i] * 1000).toISOString(),
        pct:        pcts[i]!,
        symbol:     s.symbol,
        seriesType,
        finalPct:   finalLabel,
      });
    }
  }

  // Day-boundary separators for hourly charts
  const refSeries = allSeries.reduce((a, b) => a.timestamps.length >= b.timestamps.length ? a : b);
  const daySeps: object[] = [];
  if (rangeConfig.intervalType === 'hour') {
    const ts = refSeries.timestamps;
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] > 7200) {
        daySeps.push({ time: new Date(((ts[i - 1] + ts[i]) / 2) * 1000).toISOString() });
      }
    }
  }

  const startDate = fmtDate(refSeries.timestamps[0]);
  const endDate   = fmtDate(refSeries.timestamps[refSeries.timestamps.length - 1]);
  const intervalLabel = rangeConfig.intervalType === 'hour' ? '1h' : rangeConfig.intervalType === 'day' ? '1d' : '1wk';

  const mainTickers  = userTickers.filter(t => !t.startsWith('^'));
  const benchTickers = userTickers.filter(t => t.startsWith('^'));
  const titleMain    = mainTickers.join(' · ');
  const titleBench   = benchTickers.length
    ? ` vs ${benchTickers.join(' · ')}`
    : hasExplicitBenchmark ? '' : ' vs S&P 500';

  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: {
      text:     `${titleMain}${titleBench} — ${rangeConfig.label} % Change`,
      subtitle: `${startDate} – ${endDate} · ${intervalLabel} bars · normalized to midpoint`,
    },
    width:  'container',
    height: 350,
    config: DARK_CONFIG,
    layer: [
      // Day-boundary separator rules
      ...(daySeps.length > 0 ? [{
        data:     { values: daySeps },
        mark:     { type: 'rule', color: '#30363d', strokeDash: [4, 3], strokeWidth: 1 },
        encoding: { x: { field: 'time', type: 'temporal' } },
      }] : []),

      // Zero-line rule
      {
        mark:     { type: 'rule', color: '#388bfd', strokeDash: [4, 3], opacity: 0.35 },
        encoding: { y: { datum: 0, type: 'quantitative' } },
      },

      // Multi-series lines
      {
        data:     { values: records },
        mark:     { type: 'line', interpolate: 'linear' },
        encoding: {
          x: {
            field: 'time', type: 'temporal', title: null,
            axis: { format: rangeConfig.intervalType === 'hour' ? '%b %d' : rangeConfig.intervalType === 'week' ? "%b '%y" : '%b %d', labelAngle: 0 },
          },
          y: {
            field: 'pct', type: 'quantitative', title: '% Change',
            axis: { format: '+.1f' },
            scale: { zero: false },
          },
          color: {
            field: 'symbol', type: 'nominal',
            scale: { domain: colorDomain, range: colorRange },
            legend: { title: null, orient: 'bottom', columns: Math.min(allSeries.length, 5) },
          },
          strokeDash: {
            field: 'seriesType', type: 'nominal',
            scale: { domain: ['stock', 'benchmark'], range: [[1, 0], [6, 4]] },
            legend: null,
          },
          strokeWidth: {
            field: 'seriesType', type: 'nominal',
            scale: { domain: ['stock', 'benchmark'], range: [2.5, 1.5] },
            legend: null,
          },
          opacity: {
            field: 'seriesType', type: 'nominal',
            scale: { domain: ['stock', 'benchmark'], range: [1, 0.65] },
            legend: null,
          },
          tooltip: [
            { field: 'time',     type: 'temporal',    title: 'Date',    format: rangeConfig.intervalType === 'hour' ? '%b %d %H:%M' : '%b %d, %Y' },
            { field: 'symbol',   type: 'nominal',     title: 'Ticker'  },
            { field: 'pct',      type: 'quantitative', title: '% vs mid', format: '+.2f' },
            { field: 'finalPct', type: 'nominal',     title: 'Period Δ' },
          ],
        },
      },
    ],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stderr.write(`⏳ Fetching ${allTickers.join(', ')} [${rangeConfig.label} / ${rangeConfig.interval}]...\n`);

  const allSeries = await Promise.all(
    allTickers.map(t => fetchWithCache(t, rangeConfig.yahooRange, rangeConfig.interval, rangeConfig.intervalType)),
  );

  for (const s of allSeries) {
    const pcts    = toPercent(s.closes).filter((p): p is number => p !== null);
    const finalPct = pcts[pcts.length - 1] ?? 0;
    process.stderr.write(`✓  ${s.symbol.padEnd(8)} ${s.closes.filter(Boolean).length} pts  final ${finalPct >= 0 ? '+' : ''}${finalPct.toFixed(1)}%\n`);
  }

  const spec = buildSpec(allSeries);
  const json = JSON.stringify(spec, null, 2);

  mkdirSync(CHARTS_DIR, { recursive: true });
  const rawSlug = userTickers.join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const slug    = rawSlug.length > 60 ? `${rawSlug.slice(0, 40)}_and_${userTickers.length}` : rawSlug;
  const fname   = `compare_${slug}_${rangeKey}.vl.json`;
  const outFile = resolve(`${CHARTS_DIR}/${fname}`);
  writeFileSync(outFile, json, 'utf8');
  process.stderr.write(`✓  Spec → ${outFile}\n`);
  process.stderr.write('\nPass stdout to artifact_create (type: "chart") to display in Art panel.\n');

  process.stdout.write(json + '\n');
}

main().catch(err => {
  process.stderr.write(`❌ ${err.message}\n`);
  process.exit(1);
});
