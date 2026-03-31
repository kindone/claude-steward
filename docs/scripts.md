# Scripts

Utility scripts in `scripts/` for data fetching, chart generation, and watchlist management. Run via `npm run <name>` from the repo root.

---

## Stock Charts

Three scripts for visualising stock and FX price data as SVG charts served from `https://steward.jradoo.com/charts/`.

### `scripts/stock-chart.ts` — single-ticker chart

```bash
npm run stock-chart -- GOOG
npm run stock-chart -- AAPL /tmp/custom-path.svg   # optional output path
```

Fetches 7-day hourly data from Yahoo Finance for one ticker, renders a standalone SVG with price line, Y-axis auto-scaling, and day separators.

### `scripts/compare-chart.ts` — multi-ticker normalised % change

```bash
npm run compare-chart -- GOOG IBM AAPL AMD          # default range: 5d
npm run compare-chart -- 1mo GOOG IBM AAPL AMD      # explicit range
npm run compare-chart -- 1y 005930.KS 000660.KS     # Korean tickers work too
```

**Range options:** `1d` · `5d` · `1w` · `1mo` · `1m` · `3mo` · `3m` · `6mo` · `6m` · `1y` · `2y`

Key design decisions:
- **Y-axis = % change from midpoint** — all lines cross 0% at the horizontal centre of the chart; left half shows "where it came from", right half shows "where it went"
- **Auto-benchmark** — if no `^`-prefixed ticker is provided, `^GSPC` is appended automatically; any `^`-prefixed ticker is rendered as a dashed muted reference line
- **Multi-exchange** — Yahoo Finance suffixes work natively: `.KS` (Korea), `.HK` (HK), `.T` (Tokyo), `.TW` (Taiwan), `.DE` (Frankfurt), `=X` (FX pairs e.g. `KRW=X`)
- **Filename** — output is `compare_<slug>_<range>_chart.svg`; slug is truncated to avoid OS filename limits

### `scripts/overview-chart.ts` — small-multiples watchlist grid

```bash
npm run overview-chart                # default range: 5d
npm run overview-chart -- 1mo
```

Reads `scripts/watchlist.json`, fetches every ticker, and renders a 4×3 SVG grid — one cell per group. All cells share the same Y-axis (5th–95th percentile bounds, so extreme outliers are clipped rather than flattening everything else). Benchmarks appear as thin dashed lines within each cell.

Output: `overview_<range>_chart.svg`

---

## Shared fetch library

`scripts/lib/fetch.ts` — Yahoo Finance fetcher with TTL file cache.

```typescript
import { fetchWithCache } from './lib/fetch.js'
const data = await fetchWithCache(symbol, yahooRange, interval, intervalType)
```

Cache lives in `server/data/cache/<symbol>_<range>_<interval>.json`. After TTL expires the file is overwritten; no historical accumulation.

| Bar size | TTL |
|----------|-----|
| `1h` (1d / 5d range) | 15 minutes |
| `1d` (1mo / 3mo / 6mo) | 2 hours |
| `1wk` (1y / 2y) | 12 hours |

Cache hits print `[cache Xs]` inline (X = seconds remaining). The cache is shared across all script invocations in the same process or across processes — running `/stocks` with multiple parallel `compare-chart` calls reuses benchmark fetches (e.g. `^GSPC`) without hitting Yahoo Finance multiple times.

---

## Watchlist

`scripts/watchlist.json` — the source of truth for tracked tickers.

```jsonc
{
  "groups": {
    "us-bigtech": {
      "description": "US mega-cap tech",
      "benchmarks": ["^GSPC", "^NDX"],   // dashed reference lines; omit to auto-add ^GSPC
      "tickers": [
        { "symbol": "GOOG", "name": "Alphabet" },
        ...
      ]
    }
  },
  "indices": [
    { "symbol": "^GSPC", "name": "S&P 500" },
    ...
  ]
}
```

Current groups: `us-bigtech` · `us-semiconductor` · `us-software` · `us-entertainment` · `us-pharma` · `us-emerging` · `korean-bluechip` · `korean-tech` · `korean-defense` · `korean-space` · `asia-pacific` · `currencies`

---

## `/stocks` skill

`.claude/commands/stocks.md` defines the `/stocks` Claude skill. Usage from chat:

| Command | Effect |
|---------|--------|
| `/stocks` | Chart all groups at 5d |
| `/stocks 1mo` | All groups at 1 month |
| `/stocks korean-tech` | One group |
| `/stocks korean-tech 3mo` | One group, specific range |
| `/stocks GOOG 005930.KS` | Ad-hoc tickers |
| `/stocks add 035420.KS name="NAVER" group=korean-tech` | Add to watchlist |
| `/stocks remove IBM` | Remove from watchlist |
| `/stocks list` | Show current watchlist |

For the full-watchlist overview use `npm run overview-chart` directly.

---

## Static file serving

Generated SVGs are written to `server/data/charts/` — outside `server/public/` so they survive `npm run build` (which runs `emptyOutDir: true`).

The server registers a static route before the SPA catch-all:

```typescript
// server/src/app.ts (production only)
app.use('/charts', express.static(path.join(__dirname, '../data/charts')))
```

Charts are publicly accessible (no auth) at `https://steward.jradoo.com/charts/<filename>.svg`.
