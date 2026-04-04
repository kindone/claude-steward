# Scheduler — Tool Usage

How to create and manage schedules from a session. For internals, see `docs/scheduler.md`.

---

## Tools (steward-schedules MCP server)

```
schedule_list(session_id)
schedule_create(session_id, cron, prompt, label, once?)
schedule_update(id, cron?, prompt?, enabled?)
schedule_delete(id, session_id)
```

**Always pass `session_id`** — it's injected into the system prompt as `Current session_id: <uuid>`. No DB query needed.

**Near-future one-shots: target at least 3–4 minutes out.** LLM processing + MCP transport takes ~1–2 minutes. If the pinned minute has already passed when the server computes `next_run_at`, cron-parser returns next year. The tool will warn if this happens.

---

## Creating a schedule

```
schedule_create(
  session_id = "<current session id>",
  cron       = "0 9 * * 1-5",   // 5-field UTC cron
  prompt     = "Run the daily report and show results.",
  label      = "Daily report",   // required — upsert key
  once       = false             // omit for recurring; true = fire once then delete
)
```

- `label` is the upsert key: calling `schedule_create` with an existing label **updates** it in-place. No need to delete first.
- `prompt` is a clear instruction written to yourself — it's injected verbatim at fire time.
- Confirm back to the user with the local-timezone time, not UTC.

## Updating a schedule

If you know the ID (from `schedule_list`):
```
schedule_update(id = "abc-123", cron = "0 10 * * 1-5")
```

If you only know the label, re-call `schedule_create` with the same label — it upserts.

## Deleting a schedule

```
schedule_list(session_id)          // find the ID first
schedule_delete(id, session_id)
```

## Listing schedules

```
schedule_list(session_id)
```

---

## Cron quick reference (UTC)

| Goal | Expression |
|---|---|
| Weekdays at 9 AM | `0 9 * * 1-5` |
| Every day at midnight | `0 0 * * *` |
| Every hour | `0 * * * *` |
| Every 30 minutes | `*/30 * * * *` |
| Once: Apr 5 at 3 PM | `0 15 5 4 *` + `once: true` |

**Always convert the user's local time to UTC before writing the cron expression.**

## Cron limitations

- **No "except"** — enumerate hours explicitly: "9am–5pm except 1pm" → `0 9,10,11,12,14,15,16,17 * * *`
- **No biweekly** — offer two separate schedules or a fixed cadence
- **No "last day of month"** — suggest a fixed date
- **No relative timing** ("3 hours after X") — cron is absolute only

---

## What NOT to do

- ❌ Emit `<schedule>` text blocks — not processed
- ❌ Call `CronCreate` / `CronDelete` — session-only harness tools, not persisted
- ❌ Write directly to the DB — bypasses SSE notification and upsert logic
- ❌ Use `PATCH /api/schedules/:id` — bypasses label-upsert; use `schedule_update` instead
