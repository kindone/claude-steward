# Scheduler — Tool Usage

How to create and manage schedules from a session. For internals, see `docs/scheduler.md`.

---

## Tools (steward-schedules MCP server)

```
schedule_list(session_id)
schedule_create(session_id, cron, prompt, label, once?, condition?, expires_at?)
schedule_update(id, cron?, prompt?, enabled?, condition?, expires_at?)
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

## Complex schedules: condition field

For patterns cron can't express natively, pass a `condition` object. The cron fires on its normal cadence; the condition skips the run if not met.

```
// Every 10 days from Apr 6
schedule_create(..., cron="0 9 * * *", condition={"type":"every_n_days","n":10,"ref":"2026-04-06"})

// Biweekly (every 14 days)
schedule_create(..., cron="0 9 * * 1", condition={"type":"every_n_days","n":14,"ref":"2026-04-06"})

// Last day of each month
schedule_create(..., cron="0 9 * * *", condition={"type":"last_day_of_month"})

// 2nd Tuesday of each month
schedule_create(..., cron="0 9 * * 2", condition={"type":"nth_weekday","n":2,"weekday":2})
```

Supported condition types:
| Type | Required fields | Meaning |
|---|---|---|
| `every_n_days` | `n`, `ref` (YYYY-MM-DD) | Every N days from the anchor date |
| `last_day_of_month` | — | Last day of each calendar month |
| `nth_weekday` | `n` (1–5), `weekday` (0=Sun…6=Sat) | Nth occurrence of weekday in month |

## Expiring schedules: expires_at field

For "run until X" patterns, pass `expires_at` as an ISO 8601 datetime. The schedule auto-deletes after the last fire before the expiry.

```
// Every 3 minutes until 5pm today
schedule_create(..., cron="*/3 * * * *", expires_at="2026-04-06T17:00:00+09:00")
```

The tool warns if `expires_at` is before the first fire (0 fires) or would result in only 1 fire.

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

## Cron notes

- **No "except"** — enumerate hours explicitly: "9am–5pm except 1pm" → `0 9,10,11,12,14,15,16,17 * * *`
- **No relative timing** ("3 hours after X") — cron is absolute only
- **Biweekly / every N days / last day of month / Nth weekday** — use `condition` field (see above)
- **"Until X time"** — use `expires_at` field (see above)

---

## What NOT to do

- ❌ Emit `<schedule>` text blocks — not processed
- ❌ Call `CronCreate` / `CronDelete` — session-only harness tools, not persisted
- ❌ Write directly to the DB — bypasses SSE notification and upsert logic
- ❌ Use `PATCH /api/schedules/:id` — bypasses label-upsert; use `schedule_update` instead
