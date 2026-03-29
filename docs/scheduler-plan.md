# Scheduler Feature — Implementation Plan

Scheduled conversation resume: attach a cron to a session, auto-inject a prompt at fire time, Claude responds, targeted push notification fires.

---

## Phases

### Phase 1: Push Targeting ✅ prerequisite
- [ ] `server/src/db/index.ts` — add `session_id TEXT` column to `push_subscriptions` (nullable, migration-safe); add `pushSubscriptionQueries.listBySession(sessionId)`
- [ ] `server/src/routes/push.ts` — accept optional `sessionId` in subscribe POST body; store it
- [ ] `server/src/lib/pushNotifications.ts` — add `notifySession(sessionId, payload)` alongside `notifyAll()`
- [ ] `client/src/lib/api.ts` — add optional `sessionId?` param to `savePushSubscription()`
- [ ] `client/src/hooks/usePushNotifications.ts` — thread `sessionId` through subscribe call
- [ ] Move/add "enable push" affordance into `ChatWindow` header (where `sessionId` is available); keep sidebar bell for global (untagged) subscriptions

### Phase 2: Schedules DB Schema
- [ ] `server/src/db/index.ts` — add `schedules` table:
  ```sql
  CREATE TABLE IF NOT EXISTS schedules (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    cron        TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )
  ```
- [ ] Add queries: `create`, `list`, `listBySession`, `listDue(now)`, `update`, `markRan(id, ranAt, nextRunAt)`, `delete`, `deleteBySession`
- [ ] `server/src/routes/sessions.ts` — call `scheduleQueries.deleteBySession(id)` before `sessionQueries.delete()` (cascade)

### Phase 3: Headless Send Path
- [ ] New `server/src/lib/sendToSession.ts`:
  - Signature: `sendToSession(sessionId, message, opts?) → Promise<{ content, errorCode? }>`
  - Prefers worker path: `workerClient.subscribe(sessionId, handler)` (already headless — see `recovery.ts`)
  - Falls back to direct-spawn with a duck-typed `res` shim (`write`, `end`, `writableEnded`) that discards SSE output
  - Does NOT call `notifyWatchers` / push — caller handles that
  - Updates `claude_session_id` on session (same logic as `chat.ts`)

### Phase 4: Scheduler Runner
- [ ] `npm install node-cron` + types in `server/package.json`
- [ ] Add `cron-parser` (or equivalent) for computing `nextFireAt(cron: string): number`
- [ ] New `server/src/lib/scheduler.ts`:
  - `startScheduler()` — `cron.schedule('* * * * *', ...)` ticks every minute
  - `runSchedule(schedule)`:
    1. Advance `next_run_at` immediately (prevents double-fire)
    2. Skip if session has a `status='streaming'` message (prevents collision with active chat)
    3. Call `sendToSession(session_id, prompt)`
    4. On success: `notifyWatchers` + `notifySubscribers` + `notifySession`
    5. On error: log; persist error row if useful
- [ ] `server/src/index.ts` — call `startScheduler()` after `workerClient.connect()`

### Phase 5: API Endpoints
- [ ] New `server/src/routes/schedules.ts`:
  ```
  GET    /api/schedules?sessionId=X    list schedules for session
  POST   /api/schedules                create { sessionId, cron, prompt, enabled? }
  PATCH  /api/schedules/:id            update { cron?, prompt?, enabled? }
  DELETE /api/schedules/:id
  POST   /api/schedules/:id/run        manual trigger (for testing)
  ```
  Validate cron with `node-cron.validate()` → 400 on bad expression.
  Response includes `session_title` (joined from sessions).
- [ ] `server/src/app.ts` — mount `schedulesRouter` under `/api/schedules`

### Phase 6: Client UI
- [ ] `client/src/lib/api.ts` — add: `listSchedules`, `createSchedule`, `updateSchedule`, `deleteSchedule`, `runScheduleNow`
- [ ] New `client/src/components/SchedulePanel.tsx`:
  - Collapsible panel (same pattern as system prompt editor in `ChatWindow`)
  - List view: cron expression, prompt preview, next-fire time in local timezone, enable toggle, delete
  - Add form: cron input + prompt textarea + save
  - Shows `new Date(next_run_at * 1000).toLocaleString()` for next fire
- [ ] `client/src/components/ChatWindow.tsx`:
  - Add `scheduleOpen` state + "⏰ Schedule" button in header (badge shows active count)
  - Render `<SchedulePanel sessionId={sessionId} />` when open

### Phase 7: Tests
- [ ] `server/src/__tests__/schedules.test.ts` — CRUD API contract tests (create, list, update, delete, run)
- [ ] `server/src/__tests__/scheduler.test.ts` — unit tests for `sendToSession` (mock worker) and `runSchedule` (mock db + time, skip-if-streaming guard)
- [ ] `client/src/__tests__/SchedulePanel.test.tsx` — RTL component tests for form + list rendering

---

## Risks & Gotchas

| Risk | Mitigation |
|------|------------|
| Concurrent schedule fire + active user chat | Skip-if-streaming guard in `runSchedule()` |
| Worker `subscribe` map overwrites on double-subscription | Same guard prevents it |
| `node-cron` has no public `next()` API | Use `cron-parser` package for `nextFireAt()` |
| Session delete leaves orphan schedules | `deleteBySession` before `sessionQueries.delete` |
| Cron runs in HTTP server process — lost on PM2 restart | Acceptable v1; `last_run_at` advanced before fire prevents double-fire |
| All cron in UTC | Display `next_run_at` in browser local timezone in UI |
| Push targeting: no subscribers for session | `notifySession` silently no-ops; correct |

---

## Dependency Order

```
Phase 1 (push targeting)
Phase 2 (DB schema)          ← can run in parallel with Phase 1
    ↓
Phase 3 (headless send)
    ↓
Phase 4 + 5 (scheduler + API)
    ↓
Phase 6 (client UI)
    ↓
Phase 7 (tests)
```
