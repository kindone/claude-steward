Build the client and server, then hot-reload production.

Steps:
1. Run `npm run build --workspace=client` then `npm run build --workspace=server` sequentially (never concurrently — memory constraint). If either fails, stop and report the error — do not proceed to reload.
2. If the build succeeds, run `pm2 restart steward-main --update-env`. Do NOT use `npm run restart` or restart the worker — that kills the in-flight job executing this command.
3. Confirm recovery: run `npm run status`.

Note: browser tabs will reconnect automatically via SSE reconnect logic within ~3 seconds.