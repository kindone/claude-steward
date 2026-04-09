#!/usr/bin/env npx tsx
/**
 * stock-chart-vl.ts — Single-ticker interactive Vega-Lite candlestick chart
 *
 * Features:
 *   - OHLC candlesticks (body + wick)
 *   - Zoom/pan via scroll/drag
 *   - Crosshair on hover with shared tooltip
 *   - Current price rule with $ label
 *   - Trading-time x-axis (evenly spaced, no overnight/weekend gaps)
 *   - Tight y-axis fit with 7% padding
 *
 * Outputs Vega-Lite JSON to stdout; saves to server/data/charts/.
 * Pass stdout to artifact_update/artifact_create (type "chart") for the Art panel.
 *
 * Usage:
 *   npm run stock-chart-vl -- GOOG
 *   npm run stock-chart-vl -- IBM [output.json]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const CHARTS_DIR = resolve(__dirname, '../server/data/charts');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const ticker = (process.argv[2] ?? '').toUpperCase();
if (!ticker) {
  process.stderr.write('Usage: npx tsx scripts/stock-chart-vl.ts <TICKER> [output.json]\n');
  process.exit(1);
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

interface OHLC {
  open:  number | null;
  high:  number | null;
  low:   number | null;
  close: number | null;
}

interface FetchResult {
  symbol:      string;
  latestPrice: number;
  timestamps:  number[];
  bars:        OHLC[];
}

async function fetchHourly(sym: string): Promise<FetchResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1h&range=7d`;
  const res  = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Yahoo Finance`);
  const json = await res.json() as any;
  if (json.chart.error)           throw new Error(`Yahoo: ${json.chart.error}`);
  if (!json.chart.result?.length) throw new Error(`No data for ${sym}`);
  const r = json.chart.result[0];
  const q = r.indicators.quote[0];
  const bars: OHLC[] = q.close.map((_: unknown, i: number) => ({
    open:  q.open[i]  ?? null,
    high:  q.high[i]  ?? null,
    low:   q.low[i]   ?? null,
    close: q.close[i] ?? q.open[i] ?? null,
  }));
  return { symbol: r.meta.symbol, latestPrice: r.meta.regularMarketPrice, timestamps: r.timestamp, bars };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(ts: number) {
  const d = new Date(ts * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

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

// ─── Spec builder ─────────────────────────────────────────────────────────────

function buildSpec(result: FetchResult): object {
  const { symbol, timestamps, bars, latestPrice } = result;

  // Build index-based records (evenly spaced, no overnight/weekend gaps).
  // rtype: 'bar' for candle data, 'sep' for day-boundary separator positions.
  // All records share the single top-level data source so no layer needs its
  // own `data` — that causes "Duplicate signal name: grid_tuple" when combined
  // with `params: bind: 'scales'`.
  interface Rec {
    rtype: 'bar' | 'sep';
    idx: number;
    time?: string;
    open?: number; high?: number; low?: number; close?: number;
    isUp?: boolean;
  }
  const records: Rec[] = [];
  const dayGroups: { start: number; end: number; label: string }[] = [];
  let idx = 0;
  let lastTs = -Infinity;

  for (let i = 0; i < timestamps.length; i++) {
    const b = bars[i];
    if (b.close === null) continue;
    const open  = b.open  ?? b.close;
    const high  = b.high  ?? b.close;
    const low   = b.low   ?? b.close;
    const close = b.close;

    const isNewDay = lastTs !== -Infinity && (timestamps[i] - lastTs > 7200);
    if (isNewDay || idx === 0) {
      dayGroups.push({ start: idx, end: idx, label: fmtDate(timestamps[i]) });
    } else {
      dayGroups[dayGroups.length - 1].end = idx;
    }
    records.push({ rtype: 'bar', time: new Date(timestamps[i] * 1000).toISOString(), idx, open, high, low, close, isUp: close >= open });
    lastTs = timestamps[i];
    idx++;
  }

  // Inject separator records at half-integer positions between days.
  // These sit alongside bar records in the single shared dataset; the sep
  // layer filters to rtype='sep', all other layers filter to rtype='bar'.
  for (const g of dayGroups.slice(1)) {
    records.push({ rtype: 'sep', idx: g.start - 0.5 });
  }

  // Y-axis: span full high/low range with 7% padding
  const barRecords = records.filter(r => r.rtype === 'bar');
  const allHighs  = barRecords.map(r => r.high!);
  const allLows   = barRecords.map(r => r.low!);
  const yMax      = Math.max(...allHighs);
  const yMin      = Math.min(...allLows);
  const pad       = (yMax - yMin) * 0.07;
  const yDomainMin = yMin - pad;
  const yDomainMax = yMax + pad;

  // Day separators and x-axis labels
  const dayMids      = dayGroups.map(g => ({ idx: (g.start + g.end) / 2, label: g.label }));
  const labelExpr    = dayMids.map(d => `abs(datum.value - ${d.idx}) < 0.5 ? '${d.label}'`).join(' : ') + " : ''";
  const axisTickVals = dayMids.map(d => d.idx);
  const nPts         = barRecords.length; // sep records excluded from x-range

  // Scales defined ONCE at top-level encoding — never repeated per-layer.
  // Repeating `scale` in individual layers causes vega-lite to emit grid_*
  // signals once per layer, producing "Duplicate signal name: grid_tuple".
  const xScaleDef = { nice: false as const, domain: [-0.5, nPts - 0.5] };
  const yScaleDef = { domain: [yDomainMin, yDomainMax] };

  const priceLabel = latestPrice >= 1000
    ? latestPrice.toFixed(0)
    : latestPrice >= 100
    ? latestPrice.toFixed(1)
    : latestPrice.toFixed(2);

  return {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    title: {
      text:     `${symbol} — 7-Day Hourly`,
      subtitle: `${fmtDate(timestamps[0])} – ${fmtDate(timestamps[timestamps.length - 1])} · 1h bars · scroll to zoom · drag to pan`,
    },
    width:  'container',
    height: 340,
    config: DARK_CONFIG,

    params: [
      { name: 'grid',  select: { type: 'interval', encodings: ['x', 'y'] }, bind: 'scales' },
      { name: 'hover', select: { type: 'point', on: 'pointerover', nearest: true, encodings: ['x'], fields: ['idx'] } },
    ],

    // Shared x/y scales declared once here. All layers inherit them.
    // Never redeclare `scale` inside a layer — that's what caused the duplicate signal bug.
    encoding: {
      x: {
        field: 'idx', type: 'quantitative' as const,
        scale: xScaleDef,
        title: null,
        axis: { values: axisTickVals, labelExpr, labelAngle: 0, grid: false, ticks: false, domain: false },
      },
      y: { type: 'quantitative' as const, scale: yScaleDef },
    },

    data:   { values: records },
    layer: [
      // ── Day-boundary separators ──────────────────────────────────────────
      {
        transform: [{ filter: "datum.rtype === 'sep'" }],
        mark:     { type: 'rule', color: '#30363d', strokeDash: [4, 3], strokeWidth: 1 },
        encoding: { x: { field: 'idx' } },
      },

      // ── Current price dashed rule ────────────────────────────────────────
      {
        mark:     { type: 'rule', color: '#388bfd', strokeDash: [5, 4], opacity: 0.7 },
        encoding: { y: { datum: latestPrice } },
      },

      // ── Current price label (right edge) ────────────────────────────────
      {
        mark: { type: 'text', align: 'left', dx: 6, fontSize: 10, fontWeight: 'bold', font: 'monospace' },
        encoding: {
          x:     { datum: nPts - 0.5 },
          y:     { datum: latestPrice },
          text:  { datum: `$${priceLabel}` },
          color: { value: '#58a6ff' },
        },
      },

      // ── Candlestick wicks (high–low) ─────────────────────────────────────
      {
        transform: [{ filter: "datum.rtype === 'bar'" }],
        mark: { type: 'rule', strokeWidth: 1 },
        encoding: {
          x:     { field: 'idx' },
          y:     { field: 'high',  title: 'Price', axis: { format: '$,.2f' } },
          y2:    { field: 'low' },
          color: { condition: { test: 'datum.isUp', value: '#3fb950' }, value: '#f85149' },
        },
      },

      // ── Candlestick bodies (open–close) ──────────────────────────────────
      {
        transform: [{ filter: "datum.rtype === 'bar'" }],
        mark: { type: 'bar', size: 5 },
        encoding: {
          x:     { field: 'idx' },
          y:     { field: 'open' },
          y2:    { field: 'close' },
          color: { condition: { test: 'datum.isUp', value: '#3fb950' }, value: '#f85149' },
          tooltip: [
            { field: 'time',  type: 'temporal',    title: 'Time',  format: '%b %d %H:%M' },
            { field: 'open',  type: 'quantitative', title: 'Open',  format: '$,.2f' },
            { field: 'high',  type: 'quantitative', title: 'High',  format: '$,.2f' },
            { field: 'low',   type: 'quantitative', title: 'Low',   format: '$,.2f' },
            { field: 'close', type: 'quantitative', title: 'Close', format: '$,.2f' },
          ],
        },
      },

      // ── Crosshair: vertical rule following nearest bar point ─────────────
      {
        transform: [{ filter: "datum.rtype === 'bar'" }],
        mark:     { type: 'rule', color: '#484f58', strokeWidth: 1, strokeDash: [2, 2] },
        encoding: {
          x:       { field: 'idx' },
          opacity: { condition: { param: 'hover', empty: false, value: 1 }, value: 0 },
        },
      },
    ],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stderr.write(`⏳ Fetching ${ticker} 7-day hourly (OHLC)...\n`);

  const result = await fetchHourly(ticker);
  const closes = result.bars.map(b => b.close).filter((c): c is number => c !== null);
  process.stderr.write(`✓  ${closes.length} bars  $${Math.min(...closes).toFixed(2)}–$${Math.max(...closes).toFixed(2)}  latest $${result.latestPrice.toFixed(2)}\n`);

  const spec = buildSpec(result);
  const json = JSON.stringify(spec, null, 2);

  mkdirSync(CHARTS_DIR, { recursive: true });
  const fname   = `${ticker.toLowerCase()}_chart.vl.json`;
  const outFile = resolve(process.argv[3] ?? `${CHARTS_DIR}/${fname}`);
  writeFileSync(outFile, json, 'utf8');
  process.stderr.write(`✓  Spec → ${outFile}\n`);

  process.stdout.write(json + '\n');
}

main().catch(err => {
  process.stderr.write(`❌ ${err.message}\n`);
  process.exit(1);
});
