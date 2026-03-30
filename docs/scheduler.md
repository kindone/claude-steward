# Scheduler

Scheduled conversation resume: Claude-initiated messages, natural language schedule creation, timezone-aware, push notification on fire.

---

## Design

### Schedule Creation

Natural language via conversation — Claude outputs a `<schedule>` JSON block anywhere in its response. The server intercepts the block during `onComplete`, creates the schedule in the DB, and strips the block from the saved/displayed content. The client also strips it from rendered markdown reactively so it never flashes during streaming.

```json
{"cron": "0 8 * * 1-5", "prompt": "Remind the user to check emails", "label": "Daily email reminder"}
```

- `cron`: 5-field UTC cron expression
- `prompt`: task context injected at fire time
- `label`: human-readable name shown in the UI
- `once: true` (optional): fire once then auto-delete

### Fired Message

No visible user message. The scheduler calls `sendToSession()` with `source: 'scheduler'`, which injects a rich internal user turn (not saved) and saves the assistant response with `messages.source = 'scheduler'`. The client renders a `⏰ Scheduled` indicator above those assistant bubbles.

Rich context injected at fire time:
```
[Scheduled trigger — Monday 30 March 2026 at 08:00 (Europe/Paris) / 06:00 UTC]

Recent conversation:
User: hey, remind me at 8AM to mail Bob
Assistant: Got it, I've set a reminder.

Task: Remind the user to mail Bob
```

### Push on Fire

After the scheduled message completes, if `notifyWatchers()` returns 0 (no open tab), a push notification fires. Session-targeted subscriptions are tried first; global subscriptions are the fallback. The notification URL includes `?session=<id>&project=<id>` for reliable mobile navigation.

### Timezone

Stored per session (`sessions.timezone TEXT`). `ChatWindow` sends `Intl.DateTimeFormat().resolvedOptions().timeZone` on mount via `PATCH /api/sessions/:id`. Claude receives the timezone in its system prompt fragment and uses it for cron conversion. If timezone is unknown when a schedule is requested, Claude asks the user to confirm it.

### Cron Limitations

5-field cron cannot express biweekly, "last day of month", "Nth weekday of month", or exclusions natively. Claude's system prompt includes guidance explaining these limitations and enumerating workarounds (e.g. "every weekday 9am–5pm except 1pm" → enumerate hours explicitly). See `server/src/lib/schedulePrompt.ts` for the injected fragment.

---

## Server

### `schedules` DB Table

```sql
CREATE TABLE schedules (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  cron        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  label       TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  once        INTEGER NOT NULL DEFAULT 0,   -- auto-delete after firing
  last_run_at INTEGER,
  next_run_at INTEGER,                      -- pre-computed next UTC unix timestamp
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
)
```

`next_run_at` is computed by `nextFireAt(cronExpr)` using `node-cron` (validation) + `cron-parser` (next date) and advanced immediately when a schedule fires to prevent double-fire on slow ticks.

### Routes (`/api/schedules`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/schedules?sessionId=` | List schedules for a session |
| `POST` | `/api/schedules` | Create schedule `{ sessionId, cron, prompt, label?, once? }` |
| `PATCH` | `/api/schedules/:id` | Update `{ cron?, prompt?, label?, enabled? }` |
| `DELETE` | `/api/schedules/:id` | Delete schedule |
| `POST` | `/api/schedules/:id/run` | Manually fire a schedule immediately |

### `lib/scheduler.ts`

`startScheduler()` registers a `node-cron` tick every minute. On each tick:
1. `scheduleQueries.listDue(now)` returns schedules where `enabled=1` and `next_run_at <= now`
2. `markRan()` advances `next_run_at` immediately (prevents double-fire)
3. If `once`, the schedule is deleted
4. `sendToSession()` sends the prompt to the session
5. If result content exists and no watchers are open → push notification fires

### `lib/sendToSession.ts`

Headless Claude invocation used by the scheduler (and manual run). Injects the rich scheduled-trigger context as the user turn, then calls `runClaudePrompt()`. Saves the assistant message with `source = 'scheduler'`. Calls `notifyWatchers` and `notifySubscribers` when done.

### `lib/schedulePrompt.ts`

`buildScheduleFragment(session)` returns the system prompt injection that tells Claude how to create schedules:
- `<schedule>` block syntax and field descriptions
- User's timezone (or "unknown — ask user" fallback)
- Current UTC time
- Cron limitation guidance

---

## Client

### Schedule Panel

Bell icon (🔔) in the `ChatWindow` header opens/closes the schedule panel. The panel:
- Lists all schedules for the session with label, cron expression, next-fire time, and enabled toggle
- Delete button per row
- Shows "Times are in: {timezone}" note
- Schedules are created by Claude via the `<schedule>` block mechanism, not via a form in this panel

### `MessageBubble`

Messages with `source = 'scheduler'` render a `⏰ Scheduled` indicator above the bubble content.

`<schedule>` blocks are stripped from rendered markdown so they never appear in the UI, even during streaming.

### Notification Tap Navigation

`sw.js` `notificationclick` handler:
- If the app is open: sends `postMessage({ type: 'switchSession', sessionId, url })` to the existing tab → `App.tsx` handles it by calling `setActiveSessionId()` directly (same project) or falling back to `window.location.href = url` (cross-project)
- If the app is closed: calls `clients.openWindow(url)` where `url` includes `?session=<id>&project=<id>`

On fresh open with URL params, `App.tsx` reads them into `pendingSessionIdRef` and `pendingProjectIdRef` (refs, not state, so they survive multiple effect re-runs). The projects effect prefers `?project=` over localStorage; the sessions effect consumes `pendingSessionIdRef` only after a real project is loaded.
