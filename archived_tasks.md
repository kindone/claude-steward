# Claude Steward — Archived TODO

## Done

- [x] **MVP: monorepo scaffold** — npm workspaces, `server/` + `client/`, `concurrently` dev script
- [x] **Express server** — auth middleware, CORS, dotenv with explicit root path, prod static serving
- [x] **SQLite sessions** — `node:sqlite` (built-in), WAL mode, two-ID session design (`id` + `claude_session_id`)
- [x] **Claude CLI subprocess** — `stream-json --verbose --include-partial-messages`, env cleanup (`CLAUDE*` stripped, `CI=true`), stdin closed
- [x] **SSE streaming endpoint** — `POST /api/chat`, `res.flushHeaders()`, `res.on('close')` cleanup
- [x] **Fetch-based SSE client** — manual line parser (not `EventSource`); handles `chunk`, `done`, `error` events
- [x] **Session continuity** — `--resume <claude_session_id>` on subsequent messages
- [x] **Markdown + syntax highlight** — `marked` + `highlight.js` in `MessageBubble`; streaming cursor blink
- [x] **Session sidebar** — list + new session button; `key={activeSessionId}` on `ChatWindow` for clean resets
- [x] **Auto-generated session titles** — truncated first message (≤40 chars, word boundary); DB update + `title` SSE event; sidebar updates before first token
- [x] **architecture.md** — repo structure, request flow diagrams, config reference, SSE protocol, claude CLI gotchas, planned features
- [x] **Safe-mode core** — `safe/server.js` (zero deps, plain Node.js) + `safe/index.html` (vanilla JS, red theme, tool-activity display); separate PM2 process on `:3003`; frozen after stabilization
- [x] **App-level SSE stream** — `GET /api/events`; `server/src/lib/connections.ts` registry (`Set<Response>`); `broadcastEvent()` helper
- [x] **Reload endpoint** — `POST /api/admin/reload`; broadcasts `event: reload` to all app connections; `process.exit(0)`; `GET /api/admin/version`
- [x] **Client reload handler** — `subscribeToAppEvents()` in `api.ts` with auto-reconnect; "Restarting…" overlay in `App.tsx`; `window.location.reload()` after 1.5s
- [x] **PM2 ecosystem config** — `ecosystem.config.cjs`; `steward-main` (:3001, restartable) + `steward-safe` (:3003, frozen)
- [x] **Projects milestone** — `projects` table + `project_id` FK on `sessions`; CRUD API (`/api/projects`); file listing + content endpoints with path traversal guard; project switcher in sidebar (dropdown picker, create/delete); session scoping by project; `--cwd` passed to claude spawn; collapsible file tree with directory expand and file viewer modal
- [x] **Stop/cancel streaming** — Stop button in `MessageInput`; `AbortController` on client fetch; `SIGTERM` on child process; `signal?: AbortSignal` in `SpawnOptions`
- [x] **Message persistence** — `messages` table in SQLite; user + assistant messages inserted on send/complete; `GET /api/sessions/:id/messages`; history loaded in `ChatWindow` on mount
- [x] **Delete sessions** — `DELETE /api/sessions/:id`; cascade-delete messages; delete button in sidebar (hover, with confirm)
- [x] **PM2 daemon mode for dev and prod** — `ecosystem.dev.config.cjs` (steward-server via tsx watch, steward-client via Vite, steward-safe); `scripts/up.js` checks required ports before starting and prints a clear conflict error with `npm run down` guidance; new root scripts: `up`, `up:dev`, `down`, `logs`, `restart`; docs updated in `self-management.md` and `architecture.md`
- [x] **HTTPS** — nginx installed on EC2; Let's Encrypt certs via certbot for `steward.jradoo.com` (→ `:5173` dev / `:3001` prod) and `safe.steward.jradoo.com` (→ `:3003`); HTTP→HTTPS redirect; auto-renewing via certbot systemd timer; WebSocket + SSE proxy settings (`proxy_buffering off`, `proxy_read_timeout 86400s`, WebSocket upgrade map)
- [x] **Passkeys (WebAuthn)** — `@simplewebauthn/server` + `@simplewebauthn/browser`; `passkey_credentials` and `auth_sessions` DB tables; `/api/auth/register|login/start|finish`, `/api/auth/logout`, `/api/auth/status` routes; `HttpOnly; Secure; SameSite=Strict` session cookie (30-day); `requireAuth` middleware (cookie-first, bearer API key fallback for transition); `AuthPage` component gates entire UI (first-run shows Register flow, returning devices show Login); also fixed Express 5 `*` wildcard → `/{*path}` and updated nginx to point at `:3001` for production
- [x] **Tool activity indicator** — streaming indicator reads `content_block_start.content_block.name` and displays the actual tool name (Bash, Read, Edit, WebSearch, etc.); clears on first `text_delta`; fixed stale name bug where Stop/error left previous tool name set, causing it to flash on the next send
- [x] **Dual-mode dev/prod setup** — dev server on `:3002`, prod on `:3001`; separate `ecosystem.dev.config.cjs` with `PORT=3002`, `VITE_API_PORT=3002`, `steward-dev.db`; `scripts/up.js` checks both port sets; `docs/nginx-dev.steward.conf` template + certbot instructions for `dev.steward.jradoo.com` subdomain
- [x] **Per-environment last-state persistence** — `steward:lastState` in `localStorage` saves `{ projectId, sessionId }` on every selection change; restored on next app load (validates IDs still exist); prod and dev origins are naturally isolated so each environment independently tracks its own context
- [x] **Tailwind CSS v4 mobile-responsive migration** — replaced monolithic `index.css` with Tailwind utilities across all components; sidebar is now a fixed drawer on mobile (slides in/out) and inline on desktop (md+); hamburger toggle + mobile header bar; `100dvh` throughout for iOS dynamic toolbar fix; all inputs bumped to 16px to prevent iOS Safari auto-zoom; send/stop buttons `min-h-[44px]`; session/project delete buttons and message copy button made permanently visible on touch devices via `[@media(hover:none)]`; file tree touch targets enlarged; also fixed pre-existing build blockers (missing `vite-env.d.ts`, stale test fixtures, unused imports)
