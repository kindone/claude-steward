#!/usr/bin/env npx tsx
/**
 * stock-chart.ts — Fetch Yahoo Finance hourly data and render an SVG price chart
 *
 * Usage:
 *   npx tsx scripts/stock-chart.ts <TICKER> [output.svg]
 *   npm run stock-chart -- GOOG
 *   npm run stock-chart -- IBM /tmp/ibm.svg
 *
 * Output: writes <ticker>_chart.svg to server/public/ and prints a URL.
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARTS_DIR = resolve(__dirname, '../server/data/charts');
const BASE_URL   = 'https://steward.jradoo.com';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const ticker = (process.argv[2] ?? '').toUpperCase();
if (!ticker) {
  console.error('Usage: npx tsx scripts/stock-chart.ts <TICKER> [output.svg]');
  process.exit(1);
}
const filename = `${ticker.toLowerCase()}_chart.svg`;
const outFile  = resolve(process.argv[3] ?? `${CHARTS_DIR}/${filename}`);

// ─── Types ────────────────────────────────────────────────────────────────────

interface YahooChart {
  chart: {
    result: Array<{
      meta: {
        symbol: string;
        currency: string;
        regularMarketPrice: number;
      };
      timestamp: number[];
      indicators: {
        quote: Array<{
          close:  (number | null)[];
          open:   (number | null)[];
          high:   (number | null)[];
          low:    (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }>;
    error: string | null;
  };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchHourly(sym: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1h&range=7d`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; stock-chart/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Yahoo Finance`);

  const json = await res.json() as YahooChart;
  if (json.chart.error) throw new Error(`Yahoo Finance: ${json.chart.error}`);
  if (!json.chart.result?.length) throw new Error('No data returned from Yahoo Finance');

  const result  = json.chart.result[0];
  const timestamps = result.timestamp;
  // Fill null closes with nearest neighbour (rare at market open/close)
  const rawClose = result.indicators.quote[0].close;
  const opens    = result.indicators.quote[0].open;
  const closes   = rawClose.map((c, i) => c ?? opens[i] ?? null);

  return {
    symbol:       result.meta.symbol,
    currency:     result.meta.currency,
    latestPrice:  result.meta.regularMarketPrice,
    timestamps,
    closes,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick nice round Y-axis bounds and step size. */
function niceAxis(min: number, max: number, targetSteps = 8) {
  const range    = max - min;
  const raw      = range / targetSteps;
  const mag      = Math.pow(10, Math.floor(Math.log10(raw)));
  const niceStep = [1, 2, 2.5, 5, 10].find(s => s * mag >= raw)! * mag;
  return {
    axisMin: Math.floor(min / niceStep) * niceStep,
    axisMax: Math.ceil(max  / niceStep) * niceStep,
    step:    niceStep,
  };
}

/** Detect trading-day boundaries: any gap > 2 hours between consecutive points. */
function dayBoundaries(timestamps: number[]): number[] {
  const starts = [0];
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > 7200) starts.push(i);
  }
  return starts;
}

/** UTC timestamp → "Mar 24" style label. */
function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Format price label, respecting magnitude. */
function fmtPrice(p: number): string {
  if (p >= 1000) return `$${p.toFixed(0)}`;
  if (p >= 100)  return `$${p.toFixed(1)}`;
  return `$${p.toFixed(2)}`;
}

// ─── SVG generator ────────────────────────────────────────────────────────────

function buildSVG(
  symbol:      string,
  timestamps:  number[],
  allCloses:   (number | null)[],
  latestPrice: number,
): string {
  // Filter nulls but keep index mapping
  const pts = allCloses
    .map((c, i) => ({ i, c, ts: timestamps[i] }))
    .filter((p): p is { i: number; c: number; ts: number } => p.c !== null);

  const n = allCloses.length;
  const prices = pts.map(p => p.c);

  // ── Layout ──────────────────────────────────────────────────
  const W = 860, H = 440;
  const ML = 72, MT = 50, MR = 58, MB = 68;  // margins
  const CW = W - ML - MR;
  const CH = H - MT - MB;

  // ── Scales ──────────────────────────────────────────────────
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const pad    = (rawMax - rawMin) * 0.07;
  const { axisMin, axisMax, step } = niceAxis(rawMin - pad, rawMax + pad);
  const pRange = axisMax - axisMin;

  const px = (i: number) => ML + (i / Math.max(n - 1, 1)) * CW;
  const py = (price: number) => MT + (1 - (price - axisMin) / pRange) * CH;

  // ── Day metadata ────────────────────────────────────────────
  const daySrc   = dayBoundaries(timestamps);
  const sepLines = daySrc.slice(1).map(start => (px(start - 1) + px(start)) / 2);
  const dayLbls  = daySrc.map((start, di) => {
    const end = daySrc[di + 1] ?? n;
    return { x: px((start + end - 1) / 2), label: fmtDate(timestamps[start]) };
  });

  // ── Grid lines ──────────────────────────────────────────────
  const gridLines: Array<{ y: number; label: string }> = [];
  for (let p = axisMin; p <= axisMax + 1e-9; p += step) {
    gridLines.push({ y: py(p), label: fmtPrice(p) });
  }

  // ── Polyline / area points ───────────────────────────────────
  const linePoints = pts.map(p => `${px(p.i).toFixed(1)},${py(p.c).toFixed(1)}`).join(' ');
  const lastPt = pts[pts.length - 1];
  const areaPoints = linePoints
    + ` ${px(lastPt.i).toFixed(1)},${(MT + CH).toFixed(1)}`
    + ` ${px(pts[0].i).toFixed(1)},${(MT + CH).toFixed(1)}`;

  // ── Notable prices ───────────────────────────────────────────
  const highIdx  = prices.indexOf(Math.max(...prices));
  const lowIdx   = prices.indexOf(Math.min(...prices));
  const highPt   = pts[highIdx];
  const lowPt    = pts[lowIdx];

  const openPrice   = prices[0];
  const closePrice  = prices[prices.length - 1];
  const highPrice   = prices[highIdx];
  const lowPrice    = prices[lowIdx];
  const pctChange   = ((closePrice - openPrice) / openPrice * 100).toFixed(1);
  const isUp        = closePrice >= openPrice;
  const lineColor   = isUp ? '#3fb950' : '#f85149';

  const startDate = fmtDate(timestamps[0]);
  const endDate   = fmtDate(timestamps[timestamps.length - 1]);

  // Peak label: push above if near top, otherwise show above point
  const peakLabelY = py(highPrice) < MT + 22 ? py(highPrice) + 22 : py(highPrice) - 8;
  // Trough label: push below if near bottom, otherwise show below point
  const troughLabelY = py(lowPrice) > MT + CH - 22 ? py(lowPrice) - 8 : py(lowPrice) + 20;

  // ── Render ───────────────────────────────────────────────────
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${lineColor}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${lineColor}" stop-opacity="0.02"/>
    </linearGradient>
    <clipPath id="cc">
      <rect x="${ML}" y="${MT}" width="${CW}" height="${CH}"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="#0d1117" rx="8"/>

  <!-- Title -->
  <text x="${W / 2}" y="26" text-anchor="middle" fill="#e6edf3" font-family="monospace" font-size="15" font-weight="bold">${symbol} — 7-Day Hourly Price</text>
  <text x="${W / 2}" y="42" text-anchor="middle" fill="#6e7681" font-family="monospace" font-size="11">${startDate} – ${endDate} · 1h intervals · Market hours ET</text>

  <!-- Chart background -->
  <rect x="${ML}" y="${MT}" width="${CW}" height="${CH}" fill="#161b22" rx="2"/>

  <!-- Horizontal grid lines + Y labels -->
  ${gridLines.map(g => `<line x1="${ML}" y1="${g.y.toFixed(1)}" x2="${ML + CW}" y2="${g.y.toFixed(1)}" stroke="#21262d" stroke-width="1"/>
  <text x="${ML - 6}" y="${(g.y + 4).toFixed(1)}" text-anchor="end" fill="#6e7681" font-family="monospace" font-size="11">${g.label}</text>`).join('\n  ')}

  <!-- Day separator lines -->
  ${sepLines.map(x => `<line x1="${x.toFixed(1)}" y1="${MT}" x2="${x.toFixed(1)}" y2="${MT + CH}" stroke="#30363d" stroke-width="1" stroke-dasharray="4,3"/>`).join('\n  ')}

  <!-- Current price reference line -->
  <line x1="${ML}" y1="${py(latestPrice).toFixed(1)}" x2="${ML + CW}" y2="${py(latestPrice).toFixed(1)}" stroke="#388bfd" stroke-width="1" stroke-dasharray="6,4" opacity="0.6"/>
  <rect x="${ML + CW + 3}" y="${(py(latestPrice) - 8).toFixed(1)}" width="52" height="16" fill="#1f3b6e" rx="3"/>
  <text x="${(ML + CW + 29).toFixed(1)}" y="${(py(latestPrice) + 4).toFixed(1)}" text-anchor="middle" fill="#58a6ff" font-family="monospace" font-size="10" font-weight="bold">${fmtPrice(latestPrice)}</text>

  <!-- Area fill -->
  <polygon clip-path="url(#cc)" points="${areaPoints}" fill="url(#ag)"/>

  <!-- Price line -->
  <polyline clip-path="url(#cc)" points="${linePoints}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>

  <!-- High marker -->
  <circle cx="${px(highPt.i).toFixed(1)}" cy="${py(highPt.c).toFixed(1)}" r="4" fill="#3fb950" stroke="#0d1117" stroke-width="1.5"/>
  <rect x="${(px(highPt.i) - 35).toFixed(1)}" y="${(peakLabelY - 13).toFixed(1)}" width="70" height="16" fill="#1a3a2a" rx="3"/>
  <text x="${px(highPt.i).toFixed(1)}" y="${(peakLabelY - 2).toFixed(1)}" text-anchor="middle" fill="#3fb950" font-family="monospace" font-size="10" font-weight="bold">▲ ${fmtPrice(highPrice)}</text>

  <!-- Low marker -->
  <circle cx="${px(lowPt.i).toFixed(1)}" cy="${py(lowPt.c).toFixed(1)}" r="4" fill="#f85149" stroke="#0d1117" stroke-width="1.5"/>
  <rect x="${(px(lowPt.i) - 35).toFixed(1)}" y="${(troughLabelY - 1).toFixed(1)}" width="70" height="16" fill="#3a1a1a" rx="3"/>
  <text x="${px(lowPt.i).toFixed(1)}" y="${(troughLabelY + 10).toFixed(1)}" text-anchor="middle" fill="#f85149" font-family="monospace" font-size="10" font-weight="bold">▼ ${fmtPrice(lowPrice)}</text>

  <!-- Start / end dots -->
  <circle cx="${px(pts[0].i).toFixed(1)}" cy="${py(openPrice).toFixed(1)}" r="3.5" fill="#8b949e" stroke="#0d1117" stroke-width="1.5"/>
  <circle cx="${px(lastPt.i).toFixed(1)}" cy="${py(closePrice).toFixed(1)}" r="3.5" fill="#58a6ff" stroke="#0d1117" stroke-width="1.5"/>

  <!-- Chart border -->
  <rect x="${ML}" y="${MT}" width="${CW}" height="${CH}" fill="none" stroke="#30363d" stroke-width="1" rx="2"/>

  <!-- X-axis day labels -->
  ${dayLbls.map(dl => `<text x="${dl.x.toFixed(1)}" y="${(MT + CH + 20).toFixed(1)}" text-anchor="middle" fill="#8b949e" font-family="monospace" font-size="11">${dl.label}</text>`).join('\n  ')}

  <!-- Stats bar -->
  <text x="${ML}"       y="${H - 10}" fill="#484f58" font-family="monospace" font-size="10">Open ${fmtPrice(openPrice)}</text>
  <text x="${ML + 130}" y="${H - 10}" fill="#f85149"  font-family="monospace" font-size="10">Low ${fmtPrice(lowPrice)}</text>
  <text x="${ML + 250}" y="${H - 10}" fill="#3fb950"  font-family="monospace" font-size="10">High ${fmtPrice(highPrice)}</text>
  <text x="${ML + 370}" y="${H - 10}" fill="#58a6ff"  font-family="monospace" font-size="10">Latest ${fmtPrice(closePrice)}</text>
  <text x="${ML + 510}" y="${H - 10}" fill="${isUp ? '#3fb950' : '#f85149'}" font-family="monospace" font-size="10">7d Change ${isUp ? '+' : ''}${pctChange}%</text>
  <text x="${ML + 660}" y="${H - 10}" fill="#484f58"  font-family="monospace" font-size="10">yahoo finance</text>
</svg>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`⏳ Fetching ${ticker} hourly data from Yahoo Finance...`);

  const { symbol, timestamps, closes, latestPrice } = await fetchHourly(ticker);
  const valid = closes.filter(Boolean) as number[];
  console.log(`✓  ${valid.length} data points  |  range $${Math.min(...valid).toFixed(2)} – $${Math.max(...valid).toFixed(2)}`);

  const svg = buildSVG(symbol, timestamps, closes, latestPrice);

  writeFileSync(outFile, svg, 'utf8');
  console.log(`✓  SVG saved → ${outFile}`);

  // Print a clean URL if saved to the public dir, otherwise just the path
  const isPublic = outFile.startsWith(CHARTS_DIR);
  const url = isPublic
    ? `${BASE_URL}/charts/${outFile.slice(CHARTS_DIR.length + 1)}`
    : `file://${outFile}`;
  console.log(`\n![${symbol} 7-day chart](${url})\n`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
