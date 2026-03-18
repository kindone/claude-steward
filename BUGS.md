# Claude Steward — Bug Tracker

Known defects. Fixed bugs → `archived_tasks.md` (§ Fixed Bugs). New features → `TODO.md`.

---

## Open

### Security
### Auth
- [ ] **"User verification required" error on passkey register/finish** — intermittently throws `"User verification was required, but user could not be verified"` during WebAuthn registration. Not consistently reproducible; investigate if it resurfaces and check authenticator UV flag handling in the server's `@simplewebauthn` call.

### Core UX
- [ ] **Last project/session not restored on reload** — after a page reload, the app often resets to the topmost session/project in the list instead of the one that was last active. The restore-on-load logic needs to persist and re-apply the last-active project + session IDs (e.g. via `localStorage`).
- [ ] **Interrupted session handling is brittle** — if a Claude run errors (token limit, process crash, etc.) while no tab is actively watching (e.g. page was reloaded mid-stream), the error is never persisted to the DB. On reload the conversation ends on the user's message with no reply and no error shown — there is no way to tell if Claude is still running, errored, or simply hasn't replied yet. The watcher path (`watchSession`) also has no way to distinguish "done" from "errored". Needs: (1) persist error messages to DB in `onError` so the UI can render them after reload, (2) pass an error signal through the watch SSE so the client can show an error state rather than silently stalling.

### Push Notifications
- [ ] **Push notifications unreliable in practice** — notifications are intermittently not delivered or arrive with significant delay. Root cause not yet isolated; likely related to one or more of the specific bugs below (`setVapidDetails` reinit, swallowed send errors, watcher race). Needs end-to-end logging of the full send path (watcher count, VAPID send result, subscription state) to diagnose which failure mode is triggering.
- [ ] **`setVapidDetails` re-initialised on every send** — `notifyAll()` calls `webpush.setVapidDetails(...)` on every invocation. Move to a one-time lazy init so the keys are set once per process lifetime.
- [ ] **Transient send failures silently swallowed** — non-410/404 errors from `webpush.sendNotification` are caught and logged with `console.error` but otherwise ignored. Add structured error logging and at minimum a retry for transient failures (5xx, network error).
- [ ] **`notified === 0` race condition** — if the SSE watcher tab closes just as Claude finishes, `notifyWatchers()` returns 0 and a push is fired even though the user was watching. Consider a short grace window (e.g. 2s) before deciding no watchers are active, or a persist-then-notify pattern.
