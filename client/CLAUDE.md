# Client — Agent Instructions

Vite 6 + React 19 + TypeScript (ESM) + Tailwind CSS v4. See `docs/client.md` for component tree and state management details.

## Commands

```bash
npm run dev --workspace=client       # Vite HMR on :5173
npm run build --workspace=client     # tsc + vite build → server/public/
npm test --workspace=client          # Vitest + React Testing Library
cd client && npx tsc --noEmit        # type-check only (run after every TS change)
```

**Always run `tsc --noEmit` after TypeScript changes.** The language server misses some errors that only surface at compile time.

## Key Patterns

**Tailwind v4** — config is in `client/src/index.css` (not `tailwind.config.js`). Utility classes only; no custom CSS unless unavoidable. Dark theme is the only theme.

**State** — all global state lives in `App.tsx` (projects, sessions, active IDs, auth status). Components receive state and callbacks as props; no global store library.

**API calls** — through `client/src/lib/api.ts`. All fetch calls include `credentials: 'include'` for the session cookie. SSE is consumed via a `ReadableStream` parser (not `EventSource` — it doesn't support custom headers).

**SSE client** — `sendMessage()` in `api.ts` returns a `ReadableStream`; `ChatWindow.tsx` reads chunks and updates state incrementally. Heartbeat timeout: 90s inactivity cancels the stream with a `connection_lost` error.

**Mobile** — fully responsive. Sidebar is a drawer on mobile. Touch targets ≥ 44px. Test layout changes at both mobile and desktop widths.

## Testing

Vitest + React Testing Library + MSW (Mock Service Worker). Mock handlers in `client/src/__tests__/msw-server.ts`. Run `npm test --workspace=client` — no server needed.

**jsproptest** is available for property-based tests alongside Vitest. Two modes:
- **Stateless**: pure utility functions and data transformations
- **Stateful**: model UI state machines with random interaction sequences (e.g. project/session selection flows, dropdown open/close/select cycles)
React component rendering and specific interaction scenarios are still better handled with example-based RTL tests.

## Build Output

`npm run build --workspace=client` outputs to `server/public/`. In production, Express serves this directory as static files. The client is a pure SPA — all routes fall through to `index.html`.
