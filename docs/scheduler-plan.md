# Scheduler Feature — Implementation Plan (v2)

Scheduled conversation resume: agent-initiated messages, natural language schedule creation, timezone-aware.

---

## Agreed Design

### Schedule creation
Natural language via conversation — Claude outputs a `<schedule>` JSON block in its response. Server intercepts it, creates the schedule, strips the block before saving/displaying. Panel is management-only (list, toggle, delete).

### Fired message
No visible user message. A subtle `⏰ Scheduled` indicator appears above the agent's response. The assistant message is saved with `source = 'scheduler'`. Push fires if no watcher tab is open.

### Claude context at fire time (B+)
Rich context injection as the internal user turn (not saved):
```
[Scheduled trigger]
Current time: Monday 30 March 2026 at 08:00 (Europe/Paris) / 06:00 UTC

Recent conversation:
User: hey, remind me at 8AM to mail Bob
Assistant: Got it, I've set a reminder.

Task: Remind the user to mail Bob
```

### Timezone
Stored per session (`sessions.timezone TEXT`). Client sends `Intl.DateTimeFormat().resolvedOptions().timeZone` on session open. Claude receives it in system prompt and uses it for cron conversion. If unknown when schedule is created → Claude asks user to confirm timezone or refresh.

---

## What Needs to Be Built

### Phase 1 — DB + types ✅ done (v1)
Foundation already in place. Additions needed:
- [ ] `sessions.timezone TEXT` migration
- [ ] `messages.source TEXT` migration (null = user, `'scheduler'` = scheduled trigger)
- [ ] `sessionQueries.updateTimezone()`
- [ ] Update `Session` + `Message` types

### Phase 2 — Timezone on client
- [ ] `client/src/lib/api.ts` — `updateSessionTimezone(sessionId, tz)`
- [ ] `client/src/components/ChatWindow.tsx` — on mount, detect `Intl` timezone, call update if changed

### Phase 3 — Schedule awareness system prompt
- [ ] `server/src/lib/schedulePrompt.ts` — `buildScheduleFragment(session)` helper
  - Includes `<schedule>` syntax explanation
  - Includes user's timezone (or "unknown — ask user" if null)
  - Includes current UTC time
- [ ] Wire into `chat.ts` (append to session.system_prompt before spawning)
- [ ] Wire into `sendToSession.ts` (same for headless path)

### Phase 4 — `<schedule>` block interception
- [ ] `server/src/lib/parseScheduleBlocks.ts` — extract + strip `<schedule>` JSON blocks from text
- [ ] `server/src/routes/chat.ts` — in `onComplete`/`done` handler: parse blocks, create schedules, strip from saved content
- [ ] `client/src/components/MessageBubble.tsx` — strip `<schedule>` blocks from rendered markdown (prevents flash during streaming)

### Phase 5 — Fired message redesign
- [ ] `server/src/lib/sendToSession.ts` — add `source?` param; when `'scheduler'`: skip user message insert, build rich context injection from session timezone + recent messages
- [ ] `server/src/lib/scheduler.ts` — pass `source: 'scheduler'`; message saved with source column

### Phase 6 — UI
- [ ] `client/src/components/MessageBubble.tsx` — render `source = 'scheduler'` with `⏰ Scheduled` indicator above bubble
- [ ] `client/src/components/SchedulePanel.tsx` — remove "Add schedule" form; show "Times are in: {timezone}" note; management only

---

## Key Details

### `<schedule>` block format
```json
{"cron": "0 6 * * 1-5", "prompt": "Remind the user to mail Bob", "label": "Mail Bob reminder"}
```
- `cron`: UTC
- `prompt`: task context injected at fire time
- `label`: human-readable name shown in panel

### Schedule awareness fragment (injected into every session's system prompt)
```
---
You can create scheduled reminders. When asked to schedule something, include this block anywhere in your response (hidden from the UI):
<schedule>{"cron": "0 6 * * *", "prompt": "task description", "label": "human-readable name"}</schedule>
Cron is UTC. User's timezone: {timezone or "unknown — ask user to confirm timezone before scheduling"}.
Current UTC time: {datetime}.
---
```

### Fired message context format
```
[Scheduled trigger — {local datetime} / {UTC datetime}]

Recent conversation:
{last 6 messages}

Task: {schedule.prompt}
```

### Streaming + `<schedule>` strip
The block will appear in streamed SSE chunks to the client. Client strips it from rendered markdown immediately. Server strips from `finalizeMessage`/`insert` content. No permanent storage of the block.

---

## Risks
| Risk | Mitigation |
|------|------------|
| Claude puts `<schedule>` mid-sentence | Strip regex is greedy across newlines; remaining text still valid |
| Claude invents wrong UTC cron | System prompt fragment emphasizes UTC conversion with examples |
| Timezone not set when user schedules | Claude is told to ask for confirmation rather than guess |
| Streamed block flashes in UI | Client strips from rendered output reactively |
