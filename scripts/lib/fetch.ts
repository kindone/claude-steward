/**
 * fetch.ts — Yahoo Finance fetcher with TTL file cache.
 *
 * Cache lives in server/data/cache/<symbol>_<range>_<interval>.json.
 * TTLs:
 *   1h  bars → 15 min
 *   1d  bars → 2 hours
 *   1wk bars → 12 hours
 *
 * After TTL expires the file is overwritten with fresh data.
 * No historical accumulation — always reflects the latest fetch.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR  = resolve(__dirname, '../../server/data/cache');

const TTL: Record<'hour' | 'day' | 'week', number> = {
  hour: 15  * 60  * 1000,   //  15 minutes
  day:   2  * 3600 * 1000,  //   2 hours
  week: 12  * 3600 * 1000,  //  12 hours
};

export interface SeriesData {
  symbol:     string;
  timestamps: number[];
  closes:     (number | null)[];
}

interface CacheEntry {
  fetchedAt: number;
  data:      SeriesData;
}

function cacheKey(sym: string, yahooRange: string, interval: string): string {
  const safe = sym.replace(/[^a-zA-Z0-9]/g, '_');
  return `${safe}_${yahooRange}_${interval}.json`;
}

function readCache(key: string): SeriesData | null {
  const file = resolve(CACHE_DIR, key);
  if (!existsSync(file)) return null;
  try {
    const entry: CacheEntry = JSON.parse(readFileSync(file, 'utf8'));
    return entry.data;            // caller checks freshness separately
  } catch {
    return null;
  }
}

function cacheAge(key: string): number {
  const file = resolve(CACHE_DIR, key);
  if (!existsSync(file)) return Infinity;
  try {
    const entry: CacheEntry = JSON.parse(readFileSync(file, 'utf8'));
    return Date.now() - entry.fetchedAt;
  } catch {
    return Infinity;
  }
}

function writeCache(key: string, data: SeriesData): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const entry: CacheEntry = { fetchedAt: Date.now(), data };
  writeFileSync(resolve(CACHE_DIR, key), JSON.stringify(entry), 'utf8');
}

async function fetchFromYahoo(
  sym: string,
  yahooRange: string,
  interval: string,
): Promise<SeriesData> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${yahooRange}`;
  const res  = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${sym}`);

  const json = await res.json() as any;
  if (json.chart.error)           throw new Error(`Yahoo: ${json.chart.error}`);
  if (!json.chart.result?.length) throw new Error(`No data for ${sym}`);

  const r      = json.chart.result[0];
  const closes = r.indicators.quote[0].close.map(
    (c: number | null, i: number) => c ?? r.indicators.quote[0].open[i] ?? null,
  );
  return { symbol: r.meta.symbol, timestamps: r.timestamp, closes };
}

/**
 * Fetch a symbol, using the file cache when fresh enough.
 * @param sym          ticker symbol
 * @param yahooRange   Yahoo Finance range string (1d, 5d, 1mo, …)
 * @param interval     Yahoo Finance interval string (1h, 1d, 1wk)
 * @param intervalType used to pick TTL bucket
 * @returns            resolved SeriesData (cached or fresh)
 */
export async function fetchWithCache(
  sym: string,
  yahooRange: string,
  interval: string,
  intervalType: 'hour' | 'day' | 'week',
): Promise<SeriesData> {
  const key = cacheKey(sym, yahooRange, interval);
  const age = cacheAge(key);
  const ttl = TTL[intervalType];

  if (age < ttl) {
    const cached = readCache(key);
    if (cached) {
      const remaining = Math.ceil((ttl - age) / 1000);
      process.stdout.write(`[cache ${remaining}s] `);
      return cached;
    }
  }

  const data = await fetchFromYahoo(sym, yahooRange, interval);
  writeCache(key, data);
  return data;
}
