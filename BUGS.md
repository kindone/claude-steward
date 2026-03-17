# Claude Steward — Bug Tracker

Known defects. Fixed bugs → `archived_tasks.md` (§ Fixed Bugs). New features → `TODO.md`.

---

## Open

### Security
- [ ] **XSS in MessageBubble** — `marked.parse()` output is inserted via `dangerouslySetInnerHTML` with no sanitization. A session where Claude returns crafted HTML could execute arbitrary scripts. Fix: wrap with `DOMPurify.sanitize()` before insertion. Do this before any untrusted content can reach the renderer.

### Auth
- [ ] **"User verification required" error on passkey register/finish** — intermittently throws `"User verification was required, but user could not be verified"` during WebAuthn registration. Not consistently reproducible; investigate if it resurfaces and check authenticator UV flag handling in the server's `@simplewebauthn` call.

### Core UX
- [ ] **Last project/session not restored on reload** — after a page reload, the app often resets to the topmost session/project in the list instead of the one that was last active. The restore-on-load logic needs to persist and re-apply the last-active project + session IDs (e.g. via `localStorage`).

### Push Notifications
- [ ] **`setVapidDetails` re-initialised on every send** — `notifyAll()` calls `webpush.setVapidDetails(...)` on every invocation. Move to a one-time lazy init so the keys are set once per process lifetime.
- [ ] **Transient send failures silently swallowed** — non-410/404 errors from `webpush.sendNotification` are caught and logged with `console.error` but otherwise ignored. Add structured error logging and at minimum a retry for transient failures (5xx, network error).
- [ ] **`notified === 0` race condition** — if the SSE watcher tab closes just as Claude finishes, `notifyWatchers()` returns 0 and a push is fired even though the user was watching. Consider a short grace window (e.g. 2s) before deciding no watchers are active, or a persist-then-notify pattern.
