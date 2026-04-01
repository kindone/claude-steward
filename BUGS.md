# Claude Steward — Bug Tracker

Known defects. Fixed bugs → `archived_tasks.md` (§ Fixed Bugs). New features → `TODO.md`.

---

## Open

### UI
- [x] **Bash tool output collapsed by default** — tool call results (e.g. `git diff`, logs, shell output) are rendered as collapsed blocks in the UI. Fixed: tool output is now captured end-to-end (`process.ts` → `api.ts` → `ChatWindow.tsx`) and displayed inline in the expanded tool view as a `<pre>` block (truncated at 2000 chars).

### Security

### Auth
- [ ] **"User verification required" error on passkey register/finish** — intermittently throws `"User verification was required, but user could not be verified"` during WebAuthn registration. Not consistently reproducible; investigate if it resurfaces and check authenticator UV flag handling in the server's `@simplewebauthn` call.

### Core UX
- [x] **Mobile scroll stutter on touch-end** — when touch-scroll momentum settled near the bottom, `setIsAtBottom(true)` triggered a React re-render that interrupted the browser's compositor mid-deceleration, causing visible stutter. Fixed by converting `isAtBottom` from `useState` to a ref with direct DOM class manipulation on the scroll-to-bottom button — zero re-renders during and after scroll.
- [ ] **No timeout on hung Claude process** *(client-side partially fixed — monitor)* — when the API stalls, the Claude subprocess never exits and the SSE stream stays open indefinitely. Client-side fix applied: 90s inactivity timeout in `api.ts` cancels the reader and shows `process_error` banner; unexpected stream-close (server restart) now shows "Connection lost" error instead of silently calling `onDone`. Remaining gap: server-side timeout in `spawnClaude` to SIGTERM the child process itself (prevents resource leak even after client gives up).
- [x] **Response lost when closing app mid-stream** — closing the browser while Claude was responding dropped the worker subscription, so `finalize()` and `notifyWatchers()` were never called; the message stayed `status='streaming'` forever and the watchSession recovery spinner never resolved. Fix: worker path `res.on('close')` no longer unsubscribes — the handler stays alive so completion/error events still fire and DB + watchers are updated correctly.
- [x] **Last project/session not restored on reload** — after a page reload, the app often resets to the topmost session/project in the list instead of the one that was last active. The restore-on-load logic needs to persist and re-apply the last-active project + session IDs (e.g. via `localStorage`).

### Push Notifications
- [ ] **Push notifications unreliable in practice** *(hardening applied — monitor for recurrence)* — notifications are intermittently not delivered or arrive with significant delay. Root cause not yet fully isolated; the `setVapidDetails` reinit, swallowed error, VapidPkHashMismatch, and active-sender bugs have been fixed; if it persists investigate the watcher race condition.
- [x] **Push fires on every response, even when user is watching** — `onComplete` used `res.writableEnded` to detect "client gone", but in the worker path `res.end()` is called just before `onComplete`, so `res.writableEnded` was always true. Fix: replaced with a `clientDisconnectedEarly` flag set only when the SSE connection drops before the job finishes.
- [x] **`notified === 0` race condition (partial)** — fixed by the `clientDisconnectedEarly` flag: if the watcher tab closes just before completion, `clientDisconnectedEarly` remains false (the original SSE was still open), so no spurious push fires.
- [x] **Duplicate assistant message in worker path** — `onComplete` always called `messageQueries.insert`, but the worker path already persists via `finalizeMessage` (UPDATE on the streaming row). Fix: added `persistMsg` param to `onComplete`; worker path passes `false`.
