# Steward — Bug Tracker

Known defects. Fixed bugs → `archived_tasks.md` (§ Fixed Bugs). New features → `TODO.md`.

---

## Open

### Auth
- [ ] **"User verification required" error on passkey register/finish** — intermittently throws `"User verification was required, but user could not be verified"` during WebAuthn registration. Not consistently reproducible; investigate if it resurfaces and check authenticator UV flag handling in the server's `@simplewebauthn` call.

### Core UX
- [ ] **No timeout on hung Claude process** *(client-side partially fixed — monitor)* — when the API stalls, the Claude subprocess never exits and the SSE stream stays open indefinitely. Client-side fix applied: 90s inactivity timeout in `api.ts` cancels the reader and shows `process_error` banner; unexpected stream-close (server restart) now shows "Connection lost" error instead of silently calling `onDone`. Remaining gap: server-side timeout in `spawnClaude` to SIGTERM the child process itself (prevents resource leak even after client gives up).

### Push Notifications
- [ ] **Push notifications unreliable in practice** *(hardening applied — monitor for recurrence)* — notifications are intermittently not delivered or arrive with significant delay. Root cause not yet fully isolated; the `setVapidDetails` reinit, swallowed error, VapidPkHashMismatch, and active-sender bugs have been fixed; if it persists investigate the watcher race condition.
