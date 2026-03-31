Stock watchlist skill — fetch, chart, and manage tracked tickers.

## Watchlist file
All tracked tickers live in `scripts/watchlist.json`. Groups have:
- `tickers` — the main series (colored solid lines)
- `benchmarks` — optional reference overlays (dashed muted lines); if omitted, ^GSPC is added automatically by the script

## What you can ask

### Fetch & chart
- `/stocks` — chart every group at default range (5d)
- `/stocks 1mo` — chart every group at a specific range (1d | 5d | 1mo | 3mo | 6mo | 1y | 2y)
- `/stocks korean` — chart one group
- `/stocks korean 3mo` — chart one group at a specific range
- `/stocks GOOG 005930.KS` — ad-hoc tickers (not from watchlist), default range
- `/stocks GOOG 005930.KS 1y` — ad-hoc tickers at a specific range

### Manage watchlist
- `/stocks add TICKER name="Label" group=groupname` — add a ticker to a group (create group if missing)
- `/stocks remove TICKER` — remove a ticker from wherever it appears
- `/stocks list` — show the current watchlist

---

## How to execute

Read `scripts/watchlist.json` first to get current state.

**Charting**: run `npm run compare-chart -- [range] TICKER1 TICKER2 ...`
- Always pass tickers as space-separated positional args
- Range (if given) comes first, before tickers
- When charting a group, pass all tickers + all benchmarks from that group
- Any ^-prefixed ticker is automatically rendered as a dashed benchmark line
- If no ^-prefixed ticker is passed, the script auto-adds ^GSPC — so for groups with explicit benchmarks, always include them to avoid double-adding ^GSPC
- When charting all groups, run one compare-chart per group (in parallel with & and wait in a single bash call)
- Embed each resulting image with the markdown URL the script prints

**Listing**: pretty-print the groups and tickers from `scripts/watchlist.json`

**Adding a ticker**:
1. Read `scripts/watchlist.json`
2. Edit it to add the ticker under the right group (create group if needed)
3. Confirm what was added

**Removing a ticker**:
1. Read `scripts/watchlist.json`
2. Edit it to remove the matching symbol
3. Confirm what was removed

## Notes
- Korean tickers end in .KS — Yahoo Finance supports them natively
- FX pairs use Yahoo Finance syntax: KRW=X (USD/KRW), EURKRW=X (EUR/KRW), JPYKRW=X, etc.
- Point counts differ between KS (~31/wk) and US (~36/wk) due to different market hours — expected, the chart handles it
- Charts are saved to server/data/charts/ and served at https://steward.jradoo.com/charts/
