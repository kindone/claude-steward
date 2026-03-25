Build the client and server, then hot-reload production.

Steps:
1. Run `npm run build` from the repo root. If it fails, stop and report the error — do not proceed to reload.
2. If the build succeeds, call `POST http://localhost:3001/api/admin/reload` with `Authorization: Bearer <API_KEY>` (from `.env`). The server will broadcast a `reload` SSE event then `process.exit(0)`; PM2 restarts it automatically.
3. Confirm recovery: run `npm run status` or `GET /api/meta`.

Note: browser tabs auto-refresh when they receive the `reload` SSE event.
