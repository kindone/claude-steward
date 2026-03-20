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
    ├── SessionSidebar.tsx ← project switcher + 3-tab bar (Sessions/Files/Term)
    ├── ProjectPicker.tsx  ← dropdown: select/create/delete projects
    ├── FileTree.tsx       ← collapsible file browser; openFile() → FileViewer portal
    ├── TerminalPanel.tsx  ← xterm.js terminal; runs commands via POST /exec SSE
    ├── ChatWindow.tsx     ← message history, streaming deltas, stop button, 🔔 push toggle
    ├── MessageBubble.tsx  ← markdown (marked) + syntax highlight (hljs) + error states
    └── MessageInput.tsx   ← textarea, Send / Stop button

hooks/
└── usePushNotifications.ts ← SW registration, subscribe/unsubscribe, PushState machine
```

---

## Component Tree

```
App
├── SessionSidebar
│   ├── ProjectPicker        (dropdown for project select/create/delete; delete hidden for protected project)
│   ├── tab bar              (Sessions / Files / Term)
│   │
│   ├── [Sessions tab]
│   │   ├── session list
│   │   │   ├── inline rename    (double-click title → input field)
│   │   │   ├── inline delete confirmation
│   │   │   └── clear-all button (header; 2+ sessions only)
│   │   └── FileTree collapsed   (toggle at bottom; quick reference)
│   │
│   ├── [Files tab]
│   │   └── FileTree alwaysExpanded  (fills sidebar height; lazy directory loading)
│   │       └── FileViewer portal    (createPortal → document.body; escapes transform containing block)
│   │           ├── view mode  (hljs syntax + line numbers | marked markdown | <img> for images)
│   │           └── edit mode  (monospace textarea; Save/Cancel; ● dirty; Cmd+S; conflict banner)
│   │
│   └── [Term tab]  ← always mounted (CSS hidden), xterm.js instance persists
│       └── TerminalPanel    (xterm.js viewport + input bar + history)
│
└── ChatWindow  (keyed on sessionId — remounts on session switch)
    ├── session header bar   (always visible: ⚙ Prompt toggle left, ⊡ Compact button + Plan/Edit/Full mode selector right)
    │   ├── token usage row  (shown after first response: "N ctx · M out · $X.XXXX"; ctx = input + cache_read + cache_creation; hover for breakdown)
    │   └── system prompt editor  (collapsible; textarea + Save/Cancel/Clear + char counter, turns yellow above 2 000)
    ├── "↑ Load older messages" button  (shown when hasMore=true; fetches cursor page)
    ├── MessageBubble[]      (one per message; streaming + error states + copy button)
    │   ├── tool history strip   (collapsed by default; ▶ Bash · Read · Edit; click to expand with full command detail)
    │   └── "Compact & Continue" button  (shown only on context_limit error bubbles)
    ├── streaming indicator  (pulsing dots; assembled calls shown as "Bash: git log …"; active tool shown in blue)
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
| `sessions[].permission_mode` | `PermissionMode` | Per-session; controls `--permission-mode` passed to Claude CLI |
| `loading` | `boolean` | Session list loading indicator |
| `restarting` | `boolean` | Overlay shown during app-level reload |

`ChatWindow` manages its own local state (messages, streaming flag, active tool name, accumulated tool calls) and is fully reset on session switch via React's `key` prop.

**Scroll behaviour** — a `scrollBehaviorRef` controls when and how the view scrolls to the bottom:
- `'instant'` on initial message load (avoids iOS smooth-scroll interruption when tab becomes active)
- `'smooth'` for streaming deltas and new messages
- `'none'` when `loadOlder` prepends messages — instead, `scrollTop` is adjusted by the new content height so the viewport stays anchored to the previously-top message

`App.tsx` persists `{ projectId, sessionId }` to `localStorage` under `steward:lastState` on every selection change and restores it on mount (validating IDs still exist). Since prod and dev run on separate origins, each environment independently tracks its own context.

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
> The browser's built-in `EventSource` API does not support `credentials: 'include'` for cross-origin requests, nor custom request headers. All requests must carry the session cookie, so a manual fetch-based parser is used instead.

`sendMessage()` in `api.ts` reads the response body as a stream and parses SSE lines manually:

```
buffer accumulates chunks from ReadableStream
→ on first read: onActivity?() fires (session reorder)
→ split on '\n'
→ 'event: '  lines set pendingEvent
→ 'data: '   lines dispatch based on pendingEvent:
    title   → onTitle()
    chunk (stream_event)
            → content_block_start (tool_use) → onToolActivity(toolName)   [live indicator, name only]
            → content_block_delta (text_delta) → onToolActivity(null) + onTextDelta()
    chunk (assistant)
            → content[].type === 'tool_use'  → onToolCall({ name, detail })  [full call with command/path]
              detail extracted per tool: Bash→command, Read/Edit/Write→file_path,
              WebSearch→query, WebFetch→url (capped at 80–100 chars)
    done    → onDone()
    error   → onError(message, code?)
→ if stream ends without done/error (e.g. dev server restarted): onError('Connection lost…', 'connection_lost')
```

**`connection_lost`** — synthesized client-side only. `ChatWindow` treats it as a soft disconnect: it starts **`watchSession`** and **`getMessages`** so the UI can pick up a completed assistant row from the DB when the **worker** finished the job after an HTTP restart (see [Server](server.md)).

Two separate signals per tool invocation:
- `onToolActivity(name)` fires from `stream_event → content_block_start` — name only, fires immediately as the tool input starts streaming; used for the live blue indicator
- `onToolCall({ name, detail })` fires from `assistant` chunks — fires when the full input is assembled; accumulated into the persistent `toolUses[]` list attached to the message

The same pattern is used in `subscribeToAppEvents()` for the `/api/events` connection, which auto-reconnects after a 3-second backoff on unexpected drops, and in `execCommand()` for the terminal exec stream.

**`watchSession()`** is the exception: it uses native `EventSource` (with `withCredentials: true`) because it is a simple GET stream that only needs to receive a single `event: done`. No custom request headers or body are needed, so the simpler built-in API suffices.

---

## Error Handling

Claude errors carry a `code` field:

| Code | UI | Meaning |
|---|---|---|
| `context_limit` | Yellow warning banner ⚠ + "Compact & Continue" button | Claude's context window is full; compact to continue |
| `session_expired` | Amber warning banner ⚠ | `--resume` failed; next message starts fresh |
| `process_error` | Red fatal banner ✕ | Claude exited non-zero for another reason |
| `http_error` | Red fatal banner ✕ | Non-2xx HTTP response from the server |
| `connection_lost` | *(special)* — not a red banner; triggers **`watchSession`** recovery path | SSE closed without terminal event (often `tsx watch` / HTTP restart mid-stream) |

`MessageBubble` renders errors as styled banners rather than attempting markdown parsing. **`connection_lost`** is handled in **`handleSend`** before the generic error styling.

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
| `listFiles(projectId, path?)` | Directory listing → `FileEntry[]` |
| `getFileContent(projectId, path)` | Returns `{ content: string, lastModified: number }` |
| `patchFile(projectId, path, content, lastModified?, force?)` | Atomic write; throws `FileConflictError` on 409 |
| `execCommand(projectId, command, handlers)` | Streams exec output; returns cancel fn |
| `listSessions(projectId?)` | `GET /api/sessions?projectId=` |
| `createSession(projectId)` | `POST /api/sessions` — `projectId` required |
| `renameSession(id, title)` | `PATCH /api/sessions/:id` with `{ title }` |
| `updateSystemPrompt(id, prompt)` | `PATCH /api/sessions/:id` with `{ systemPrompt }` |
| `updatePermissionMode(id, mode)` | `PATCH /api/sessions/:id` with `{ permissionMode }` |
| `deleteSession(id)` | `DELETE /api/sessions/:id` |
| `getMessages(sessionId, opts?)` | Paginated: `{ limit?, before? }` → `{ messages, hasMore }` (default limit 50) |
| `watchSession(sessionId, onDone, onError?)` | `EventSource` on `GET /watch`; returns cancel fn |
| `sendMessage(sessionId, text, handlers)` | Starts chat SSE; returns cancel fn. See `ChunkHandler` below |
| `stopChat(sessionId)` | `DELETE /api/chat/:id` — kills the subprocess; fire-and-forget |
| `compactSession(sessionId)` | `POST /api/sessions/:id/compact` — summarizes session via Claude, forks new session primed with summary; returns `{ sessionId: string }` |
| `getVapidPublicKey()` | `GET /api/push/vapid-public-key` → `string` |
| `savePushSubscription(sub)` | `POST /api/push/subscribe` with `PushSubscription` object |
| `deletePushSubscription(endpoint)` | `DELETE /api/push/subscribe` |
| `subscribeToAppEvents(handlers)` | Starts events SSE; returns cancel fn |

**Key exported types**

| Type | Fields |
|---|---|
| `ToolCall` | `name: string`, `detail?: string` — one assembled tool invocation |
| `ChunkHandler` | All SSE callbacks for `sendMessage`: `onTextDelta`, `onTitle`, `onDone`, `onError`, `onToolActivity`, `onToolCall`, `onActivity`, `onUsage` |
| `UsageInfo` | `input_tokens`, `output_tokens`, `cache_read_input_tokens?`, `cache_creation_input_tokens?`, `total_cost_usd?` — fired via `onUsage` when the result chunk arrives |
| `ClaudeErrorCode` | `'context_limit' \| 'session_expired' \| 'process_error' \| 'http_error' \| 'connection_lost'` |
| `FileContent` | `{ content: string, lastModified: number }` — returned by `getFileContent` |
| `FileConflictError` | `Error` subclass; thrown by `patchFile` on 409 Conflict |
| `MessagesPage` | `{ messages: Message[], hasMore: boolean }` — returned by `getMessages` |
| `ExecHandlers` | `{ onOutput, onDone, onError? }` — callbacks for `execCommand` |

---

## Testing

Client tests use **Vitest + React Testing Library + msw (Mock Service Worker)**.

`msw-server.ts` provides mock handlers for every API endpoint so tests run without a real server. `setup.ts` configures `@testing-library/jest-dom` and wires `msw` to listen before/after each test.

```bash
npm test --workspace=client    # run client tests only
npm run test:coverage          # with coverage report
```

E2E smoke tests (Playwright) live in `e2e/` at the monorepo root and test the full stack with both dev servers running. See `playwright.config.ts`.
