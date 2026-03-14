# Client Architecture

Vite 6 + React 19 + TypeScript. A single-page app served at `:5173` in development and as static files from `server/public/` in production.

---

## Directory Layout

```
client/src/
├── main.tsx              ← React root mount
├── index.css             ← dark theme, all styles (single file)
├── App.tsx               ← root component: global state, session/project handlers
├── lib/
│   └── api.ts            ← fetch wrappers, SSE client, type definitions
└── components/
    ├── SessionSidebar.tsx ← project switcher + session list + file tree
    ├── ProjectPicker.tsx  ← dropdown: select/create/delete projects
    ├── FileTree.tsx       ← collapsible file browser + inline file viewer
    ├── ChatWindow.tsx     ← message history, streaming deltas, stop button
    ├── MessageBubble.tsx  ← markdown (marked) + syntax highlight (hljs) + error states
    └── MessageInput.tsx   ← textarea, Send / Stop button
```

---

## Component Tree

```
App
├── SessionSidebar
│   ├── ProjectPicker        (dropdown for project select/create/delete; no "No project" option; delete hidden for protected project)
│   ├── session list
│   │   ├── inline rename    (double-click title → input field)
│   │   ├── inline delete confirmation
│   │   └── clear-all button (header; 2+ sessions only)
│   └── FileTree             (shown when a project is active)
│       └── file viewer      (inline, opens on file click)
└── ChatWindow  (keyed on sessionId — remounts on session switch)
    ├── system prompt bar    (collapsible; ⚙ toggle; textarea + Save/Cancel/Clear)
    ├── MessageBubble[]      (one per message; streaming + error states + copy button)
    └── MessageInput         (textarea + Send/Stop)
```

---

## State Management

All global state lives in `App.tsx`. No external store.

| State | Type | Description |
|---|---|---|
| `projects` | `Project[]` | Loaded once on mount |
| `activeProjectId` | `string \| null` | Active project; auto-set to first project on load; null only while loading or when no projects exist |
| `sessions` | `Session[]` | Reloaded whenever `activeProjectId` changes |
| `activeSessionId` | `string \| null` | Which session is open in ChatWindow |
| `appRoot` | `string \| null` | Server's `APP_ROOT` from `/api/meta`; used to suppress delete on the steward project |
| `loading` | `boolean` | Session list loading indicator |
| `restarting` | `boolean` | Overlay shown during app-level reload |

`ChatWindow` manages its own local state (messages, streaming flag) and is fully reset on session switch via React's `key` prop.

### Session list behaviour

- **Reordering** — when the first SSE byte arrives from a `sendMessage` call, `onActivity()` fires and the session is moved to index 0 in the `sessions` array. The list always reflects recency.
- **Inline rename** — double-clicking a session title shows an `<input>` in-place. Enter or blur commits via `PATCH /api/sessions/:id`; Escape cancels.
- **Inline delete confirmation** — clicking × shows "Delete? Yes / No" within the row; no browser dialog.
- **Clear all** — appears in the section header when 2+ sessions exist; uses `window.confirm` for this destructive bulk action.
- **Session count badge** — displayed next to the "Sessions" label.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+N` | New session |
| `Cmd/Ctrl+[` | Previous session (down the list) |
| `Cmd/Ctrl+]` | Next session (up the list) |

Implemented as a `keydown` listener in `App.tsx` (registered once per `activeSessionId`/`sessions` change).

---

## SSE Client

The server chat stream uses `Content-Type: text/event-stream`, but the client uses `fetch()` + `ReadableStream` instead of `EventSource`:

> **Why not `EventSource`?**  
> The browser's built-in `EventSource` API does not support custom request headers. Since every request must carry `Authorization: Bearer <API_KEY>`, a manual fetch-based parser is required.

`sendMessage()` in `api.ts` reads the response body as a stream and parses SSE lines manually:

```
buffer accumulates chunks from ReadableStream
→ on first read: onActivity?() fires (session reorder)
→ split on '\n'
→ 'event: '  lines set pendingEvent
→ 'data: '   lines dispatch based on pendingEvent:
    title   → onTitle()
    chunk   → extract content_block_delta text → onTextDelta()
    done    → onDone()
    error   → onError(message, code?)
```

The same pattern is used in `subscribeToAppEvents()` for the `/api/events` connection, which auto-reconnects after a 3-second backoff on unexpected drops.

---

## Error Handling

Claude errors carry a `code` field:

| Code | UI | Meaning |
|---|---|---|
| `session_expired` | Amber warning banner ⚠ | `--resume` failed; next message starts fresh |
| `process_error` | Red fatal banner ✕ | Claude exited non-zero for another reason |
| `http_error` | Red fatal banner ✕ | Non-2xx HTTP response from the server |

`MessageBubble` renders errors as styled banners rather than attempting markdown parsing.

### Copy button

Completed assistant messages show a copy-to-clipboard button (⎘) on hover, positioned top-right of the bubble. It copies the raw markdown source (not the rendered HTML). After copying it briefly shows ✓ for 1.5s.

---

## Vite Configuration

```ts
// client/vite.config.ts
proxy: {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
}
build: {
  outDir: '../server/public',   // production build goes into the server package
}
```

In production there is no Vite process — Express serves `server/public/index.html` for all non-API routes.

---

## API Wrappers (`api.ts`)

All functions accept/return typed objects and throw on non-OK responses.

| Function | Description |
|---|---|
| `fetchMeta()` | `GET /api/meta` — `{ appRoot }` |
| `listProjects()` | `GET /api/projects` |
| `createProject(name, path)` | `POST /api/projects` |
| `deleteProject(id)` | `DELETE /api/projects/:id` |
| `listFiles(projectId, path?)` | Directory listing |
| `getFileContent(projectId, path)` | File content (string) |
| `listSessions(projectId?)` | `GET /api/sessions?projectId=` |
| `createSession(projectId)` | `POST /api/sessions` — `projectId` required |
| `renameSession(id, title)` | `PATCH /api/sessions/:id` with `{ title }` |
| `updateSystemPrompt(id, prompt)` | `PATCH /api/sessions/:id` with `{ systemPrompt }` |
| `deleteSession(id)` | `DELETE /api/sessions/:id` |
| `getMessages(sessionId)` | `GET /api/sessions/:id/messages` |
| `sendMessage(sessionId, text, handlers)` | Starts chat SSE; returns cancel fn |
| `subscribeToAppEvents(handlers)` | Starts events SSE; returns cancel fn |

---

## Testing

Client tests use **Vitest + React Testing Library + msw (Mock Service Worker)**.

`msw-server.ts` provides mock handlers for every API endpoint so tests run without a real server. `setup.ts` configures `@testing-library/jest-dom` and wires `msw` to listen before/after each test.

```bash
npm test --workspace=client    # run client tests only
npm run test:coverage          # with coverage report
```

E2E smoke tests (Playwright) live in `e2e/` at the monorepo root and test the full stack with both dev servers running. See `playwright.config.ts`.
