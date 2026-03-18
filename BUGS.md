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
- [ ] **No timeout on hung Claude process** — when the API stalls rather than cleanly erroring (e.g. context window exceeded causes the request to hang rather than return a result chunk), the Claude subprocess never exits and the SSE stream stays open indefinitely. The spinner spins forever with no feedback; the only escape is the Stop button. Fix: add a server-side timeout in `spawnClaude` (e.g. `setTimeout` of ~5 min) that SIGTERMs the child, then sends an `event: error` with a timeout message. Also note: new code is only active after a server reload — hitting the limit during a coding session before reload means the old (unfixed) code handles it.
- [x] **Last project/session not restored on reload** — after a page reload, the app often resets to the topmost session/project in the list instead of the one that was last active. The restore-on-load logic needs to persist and re-apply the last-active project + session IDs (e.g. via `localStorage`).

### Push Notifications
- [ ] **Push notifications unreliable in practice** *(hardening applied — monitor for recurrence)* — notifications are intermittently not delivered or arrive with significant delay. Root cause not yet fully isolated; the `setVapidDetails` reinit, swallowed error, VapidPkHashMismatch, and active-sender bugs have been fixed; if it persists investigate the watcher race condition.
- [ ] **`notified === 0` race condition** — if the SSE watcher tab closes just as Claude finishes, `notifyWatchers()` returns 0 and a push is fired even though the user was watching. Consider a short grace window (e.g. 2s) before deciding no watchers are active, or a persist-then-notify pattern.
