# MEMORY

Quick-reference notes for Claude across sessions. Update when features land.

---

## Stock chart scripts

See `docs/scripts.md` for full details.

- `npm run stock-chart -- TICKER` — single-ticker 7-day SVG
- `npm run compare-chart -- [range] T1 T2 ...` — multi-ticker normalised % change chart
- `npm run overview-chart -- [range]` — 4×3 small-multiples grid of all watchlist groups
- Watchlist lives in `scripts/watchlist.json` (groups + per-group benchmarks)
- Shared fetch cache: `server/data/cache/` — TTL 15 min (1h bars) / 2 hr (1d) / 12 hr (1wk)
- Charts served from `server/data/charts/` at `/charts/*` (survives builds)
- `/stocks` skill: `.claude/commands/stocks.md`

## Static charts route

`server/src/app.ts` registers `app.use('/charts', express.static(...))` before the SPA catch-all.
`chartsDir = path.join(__dirname, '../data/charts')` — `__dirname` is `server/dist/` in production.
