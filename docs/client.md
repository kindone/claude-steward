# Client Architecture

Vite 6 + React 19 + TypeScript. A single-page app served at `:5173` in development and as static files from `server/public/` in production.

---

## Directory Layout

```
client/src/
├── main.tsx              ← React root mount
├── index.css             ← dark theme, all styles (single file)
├── App.tsx               ← root component: global state, session/project handlers, SW message handler
├── lib/
│   ├── api.ts            ← fetch wrappers, SSE client, type definitions
│   └── markdownRenderer.ts ← splitContent, buildMarkedOptions, preprocessKaTeX (pure, tested)
└── components/
    ├── SessionSidebar.tsx ← project switcher + 3-tab bar (Sessions/Files/Term)
    ├── ProjectPicker.tsx  ← dropdown: select/create/delete projects
    ├── FileTree.tsx       ← collapsible file browser; openFile() → FileViewer portal
    ├── TerminalPanel.tsx  ← xterm.js terminal; runs commands via POST /exec SSE
    ├── ChatWindow.tsx     ← message history, streaming, stop, 🔔 push toggle, 🕐 schedule panel, ↓ scroll button
    ├── HtmlPreview.tsx    ← sandboxed <iframe srcdoc> with Source/Preview tab toggle; auto-sizes to content
    ├── ImageLightbox.tsx  ← fullscreen image/SVG viewer; scroll-to-zoom (cursor-anchored), drag-to-pan, Escape/backdrop to close
    ├── MessageBubble.tsx  ← rich rendering: markdown + hljs + mermaid + KaTeX + HTML preview + image rewriting + lightbox
    ├── MessageInput.tsx   ← textarea, Send / Stop button
    ├── AppsPanel.tsx      ← list/create/start/stop mini-apps; "View" button opens AppViewPanel inline
    └── AppViewPanel.tsx   ← side panel that embeds a running app in an iframe (½ or ⅔ split; full-screen on mobile)

hooks/
└── usePushNotifications.ts ← SW registration, subscribe/unsubscribe, PushState machine

client/public/
└── sw.js                 ← service worker: push → showNotification; notificationclick → postMessage or openWindow
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
├── AppViewPanel  (conditional; rendered alongside chat when an app is being viewed)
│   └── <iframe sandbox="…"> embedding the running app URL
│
└── ChatWindow  (keyed on sessionId — remounts on session switch)
    ├── session header bar   (always visible: ⚙ Prompt toggle left, ⊡ Compact + 🔔 Push + 🕐 Schedules + Plan/Edit/Full right)
    │   ├── token usage row  (shown after first response: "N ctx · M out · $X.XXXX"; ctx = input + cache_read + cache_creation; hover for breakdown)
    │   ├── system prompt editor  (collapsible; textarea + Save/Cancel/Clear + char counter, turns yellow above 2 000)
    │   └── schedule panel   (collapsible; list schedules with toggle/delete; next-fire display; "Times are in: {tz}" note)
    ├── "↑ Load older messages" button  (shown when hasMore=true; fetches cursor page)
    ├── MessageBubble[]      (one per message; streaming + error states + copy button)
    │   ├── rich content rendering  (mermaid SVG, KaTeX math, sandboxed HTML preview, inline images)
    │   ├── tool history strip   (collapsed by default; ▶ Bash · Read · Edit; click to expand with full command detail)
    │   ├── ⏰ Scheduled indicator  (shown above bubbles where messages.source = 'scheduler')
    │   └── "Compact & Continue" button  (shown only on context_limit error bubbles)
    ├── streaming indicator  (pulsing dots; assembled calls shown as "Bash: git log …"; active tool shown in blue)
    ├── ↓ scroll-to-bottom button  (floating; appears when scrolled >100px from bottom; hidden during streaming if already at bottom)
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
| `appPanel` | `{ url: string; name: string } \| null` | Currently-viewed app; set by `AppsPanel`'s "View" button, cleared by `AppViewPanel`'s close button |
| `appPanelPreset` | `'half' \| 'wide'` | Split ratio for the app panel (persisted as React state; not persisted to localStorage) |

Key refs (not state, so they don't trigger re-renders):

| Ref | Description |
|---|---|
| `sessionsRef` | Mirror of `sessions` state; used by the SW `message` handler so it always reads the latest list without re-registering the listener |
| `pendingSessionIdRef` | Reads `?session=` URL param once on mount (set by push notification tap); persists across multiple sessions-effect runs until the target session is confirmed active |
| `pendingProjectIdRef` | Reads `?project=` URL param once on mount; used in the projects-loading effect to prefer the notification's project over localStorage |

`ChatWindow` manages its own local state (messages, streaming flag, active tool name, accumulated tool calls) and is fully reset on session switch via React's `key` prop.

**Scroll behaviour** — a `scrollBehaviorRef` controls when and how the view scrolls to the bottom:
- `'instant'` on initial message load (snaps to bottom unconditionally)
- `'smooth'` for streaming deltas and new messages — but only when `wasAtBottomRef` is true and `userIsScrollingRef` is false
- `'none'` when `loadOlder` prepends messages — instead, `scrollTop` is adjusted by the new content height so the viewport stays anchored to the previously-top message

**iOS/mobile scroll architecture** — designed to never trigger React re-renders during scroll:
- **`wasAtBottomRef` + `userIsScrollingRef`** — updated by a passive `scroll` listener (ref-only, no state). `userIsScrollingRef` uses a 150ms debounce that covers iOS momentum deceleration. Auto-scroll fires only when both refs say it's safe.
- **`isAtBottomRef` + direct DOM toggle** — the scroll-to-bottom button's visibility is controlled by direct `classList` manipulation on `scrollBtnRef`, not React state. The previous `useState`-based approach caused mobile scroll stutter: `setIsAtBottom()` triggered re-renders that interrupted the browser's compositor mid-momentum-deceleration.
- **`skipNextScrollRef`** — set before every programmatic `scrollTop` assignment (initial load snap, rAF re-snaps, scroll-to-bottom button click). Without this, the resulting scroll event would set `userIsScrollingRef = true` and block auto-scroll or kill the initial-load rAF catchup loop.
- **Initial load rAF catchup** — after the first `scrollTop = 1e9` snap, a `requestAnimationFrame` loop runs for up to 5 seconds, re-snapping whenever `scrollHeight` grows (mermaid SVGs, images, KaTeX rendering asynchronously after React commit). Each re-snap sets `skipNextScrollRef` so it isn't misinterpreted as user scrolling.
- **`body { overscroll-behavior: none }`** — prevents iOS from elastically bouncing the page behind the scroll container.
- **`flex-1 min-h-0`** on the scroll container (not `h-full`) — more robust across iOS Safari versions; `h-full` on a flex child with implicit height can miscalculate `clientHeight`.

`App.tsx` persists `{ projectId, sessionId }` to `localStorage` under `steward:lastState` on every selection change and restores it on mount (validating IDs still exist). Since prod and dev run on separate origins, each environment independently tracks its own context.

**Push notification intelligence** — notifications are routed based on whether the user is actively looking at the app:

- **Foreground (app visible)** → in-app toast via SSE `pushTarget` event. The toast shows session title + message preview, is tappable to switch sessions, and auto-dismisses after 8 seconds.
- **Backgrounded (home screen)** → real push notification via web-push. Also stores the target via `setLastPushTarget()` for the iOS `visibilitychange` poll fallback.
- **App killed (swiped away)** → same as backgrounded; SSE drops, no active clients.

Visibility tracking: when the `/api/events` SSE connects, the server assigns a `connectionId` (sent via `connected` event). The client sets up a `visibilitychange` listener that reports state changes to `POST /api/events/visibility`. Hidden uses `navigator.sendBeacon()` (reliable even as iOS suspends the page); visible uses `fetch`. Server-side, `hasActiveClients()` checks `foregroundConnections` (not just `appConnections`), so a backgrounded tab with a live SSE connection is correctly treated as inactive.

iOS-specific: iOS Safari doesn't fire SW `notificationclick`, so push tap navigation uses a server-side poll: `GET /api/push/last-target` returns and clears the stored target on `visibilitychange` → `visible`.

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

---

## Rich Content Rendering

`MessageBubble` supports four content types beyond basic markdown, orchestrated by helpers in `client/src/lib/markdownRenderer.ts`.

### Pipeline

```
raw content string
  │
  ├─ stripScheduleBlocks()         strip <schedule>…</schedule> tags
  ├─ splitContent()                split out standalone ```html fences → HtmlPreview segments
  │
  └─ per markdown segment:
       preprocessKaTeX()           replace $…$ / $$…$$ with KaTeX HTML
       marked.parse(buildMarkedOptions(projectId))
         │  ├─ mermaid renderer    ```mermaid → <div class="mermaid-placeholder" data-graph="…">
         │  └─ image renderer      ./relative.png → /api/projects/:id/files/raw?path=…
       DOMPurify.sanitize()        ADD_ATTR: ['data-graph', 'style']
```

### Mermaid

- ` ```mermaid ` blocks are converted to placeholder divs by the `marked` renderer.
- A `useEffect` with **no dependency array** runs after every render to find un-rendered placeholders and call `mermaid.render(id, graph)` (async).
- Rendered SVGs are cached in a `useRef<Map<string, string>>` keyed by graph source. Cache hits are synchronous, so re-renders caused by scroll or parent state changes restore the SVG instantly without a second `mermaid.render()` call.
- New diagrams are only rendered after `streaming` is false, avoiding a race where rapid DOM resets (one per streaming chunk) keep wiping partially-injected SVGs.

### HTML Preview (`HtmlPreview.tsx`)

- `splitContent()` extracts top-level ` ```html ` fences into `HtmlPreviewSegment` values before markdown parsing.
- Each segment renders as `<HtmlPreview html={content} />` — a tabbed widget with **Preview** (`<iframe srcdoc sandbox="allow-scripts">`) and **Source** (`<pre>`) views.
- The iframe auto-sizes to `body.scrollHeight` (capped at 600 px) on load.
- `sandbox="allow-scripts"` permits JS execution within the iframe but denies DOM access to the parent.

### KaTeX

- `preprocessKaTeX()` runs before `marked.parse()` and replaces `$$…$$` (display) and `$…$` (inline) with KaTeX-rendered HTML.
- Content inside triple-backtick fences and inline code spans is excluded to avoid false positives on literal `$` characters.
- KaTeX output uses `style` attributes for sizing; DOMPurify is configured with `ADD_ATTR: ['style']` to preserve them.

### Image rewriting

- The `image` renderer in `buildMarkedOptions(projectId)` intercepts relative paths (anything that doesn't start with `https?:`, `data:`, or `/`) and rewrites them to `/api/projects/:id/files/raw?path=<encoded>`.
- Absolute URLs and data URIs pass through unchanged.
- When `projectId` is null (no active project) no rewriting happens.

---

### Image Lightbox (`ImageLightbox.tsx`)

Clicking any `<img>` or `<svg>` inside an assistant bubble opens a fullscreen lightbox.

- **Trigger**: delegated `onClick` on the `.prose` container catches clicks on `img` and `svg` elements (uses `closest()` since SVG click targets can be inner `<path>`/`<g>` children).
- **Zoom**: scroll wheel, cursor-anchored (point under cursor stays fixed). Range: 0.1×–20×. Non-passive wheel listener attached via `useEffect` so `preventDefault()` actually works.
- **Pan**: drag to move. `onMouseLeave` on the overlay ends the drag so it doesn't get stuck if the mouse exits.
- **Controls**: 1:1 reset button (top-right), close button (✕), Escape key, backdrop click.
- **Portal**: renders into `document.body` via `createPortal` at `z-[300]`, above the FileTree modal (`z-[200]`).
- **SVG content**: captured as `svg.outerHTML` (already DOMPurify-sanitized from the render pipeline) and re-injected via `dangerouslySetInnerHTML` — no second sanitization pass needed.
- **Cursor hint**: `.prose img`, `.prose svg`, and `.mermaid-placeholder svg` get `cursor: zoom-in` via plain CSS in `index.css` (Tailwind can't reach inside `dangerouslySetInnerHTML`).

---

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
| `savePushSubscription(sub, sessionId?)` | `POST /api/push/subscribe` with `PushSubscription` + optional session scope |
| `deletePushSubscription(endpoint)` | `DELETE /api/push/subscribe` |
| `listSchedules(sessionId)` | `GET /api/schedules?sessionId=` → `Schedule[]` |
| `createSchedule(opts)` | `POST /api/schedules` — `{ sessionId, cron, prompt, label?, once? }` |
| `updateSchedule(id, patch)` | `PATCH /api/schedules/:id` — `{ enabled?, cron?, prompt?, label? }` |
| `deleteSchedule(id)` | `DELETE /api/schedules/:id` |
| `runSchedule(id)` | `POST /api/schedules/:id/run` — manual fire |
| `subscribeToAppEvents(handlers)` | Starts events SSE; returns cancel fn |
| `startRegistration(opts?)` | `POST /api/auth/register/start`; optional `{ bootstrapKey }` sends `X-Bootstrap-Key` header |

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
