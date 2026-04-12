# Notebook Integration

This document describes the design for integrating notebook-style code execution into steward chat. The goal is to let users run code blocks inline during a conversation and, when useful, promote those blocks into persistent, versioned cell files — all without leaving the chat interface.

---

## File Structure

Notebooks live on the filesystem under `~/notebooks/<name>/`:

```
~/notebooks/<name>/
  cells/
    01_load.py
    02_clean.sh
    03_analyse.py
  outputs/
    01_load.out        # stdout/stderr from last run
    01_load.meta       # exit code, duration, timestamp
  .index.db            # lightweight metadata cache (gitignored)
  .gitignore           # covers outputs/ and .index.db
```

Cell ordering is determined by the numeric filename prefix (`01_`, `02_`, …). Reordering cells means renaming files — no separate ordering field in the DB.

---

## Storage Design

Files are canonical. The DB is a cache.

- **Cell source** lives only in `cells/` on disk. The DB never holds cell content.
- **The index** (`node:sqlite`) caches: filename, language override, `last_run_at`, exit code, dirty flag.
- **Startup reindex**: on every start the server scans `cells/`, diffs against the index, and updates accordingly. Loss of `.index.db` means loss of last-run metadata only — nothing else.
- **File watcher** keeps the index live between restarts.

Because the DB is a pure cache, reindexing is expected and cheap.

---

## Git Management

Notebooks are git-managed by default.

- `git init` runs on notebook creation.
- `.gitignore` covers `outputs/` and `.index.db`.
- `cells/` files are versioned — Claude can commit them with meaningful messages using its existing file tools.

Two embedding modes:

| Mode | Location | Repo |
|---|---|---|
| Standalone | `~/notebooks/<name>/` | Own git repo |
| Project-embedded | `~/myproject/notebook/` | Lives inside existing repo |

---

## Reindexing

Reindexing is triggered:

1. On server startup (always)
2. On file watcher events (create, modify, delete)
3. On manual resync request

Process: scan `cells/`, diff filenames against the index, insert/update/delete rows as needed. The operation is idempotent and safe to run repeatedly.

---

## Rename Handling

The file watcher detects renames as a delete event followed by a create event. When this occurs:

- Log a warning: `cell '02_clean.sh' may have been renamed to '02_normalise.sh' — last-run metadata reset`
- Last-run metadata (exit code, duration, timestamp) resets for the renamed cell.
- Nothing else breaks — source is still on disk, ordering prefix is still in the filename.

**Hard rule:** renaming a currently-executing cell is blocked. The kernel holds the filename reference for the duration of execution.

---

## Steward Chat Integration

Two execution modes are supported:

### 1. Ephemeral Run

Claude writes a code block in chat. The user clicks **Run**. The block executes in a transient kernel scoped to that message. Output (stdout, stderr, exit code) appears inline below the code block inside the message bubble. Nothing is written to disk.

This is the fast path for quick experiments and one-off checks.

### 2. Save as Cell

The user clicks **Save as cell** on any code block (run or not). This promotes the block to a named file in a notebook workspace, creating the notebook if it does not exist. From that point the cell is persistent, versionable, and re-runnable outside of chat.

Claude can read and write cell files directly using its existing file tools — no special notebook API is needed for authoring.

---

## Kernel Design

- **Persistent kernel per steward session** — variables, imports, and state carry across messages within the same session.
- Kernel runners are reused from `apps/notebook/` (Bash, Node, Python).
- An **idle timeout** cleans up kernels that have had no activity for a configurable period.
- The kernel holds a reference to the filename of the currently-executing cell. Rename is blocked for the duration.

Kernel lifecycle:

1. First **Run** in a session spawns the kernel.
2. Subsequent runs in the same session reuse it.
3. Idle timeout or session end tears it down.

---

## UI Changes

Changes are confined to `MessageBubble` and supporting components:

- **Run button** on every fenced code block.
- **Inline output panel** below the code block — shows stdout, stderr, exit code, and duration.
- **Send to Claude** action on the output panel — feeds the output back into the conversation as a follow-up user message.
- **Save as cell** button — triggers the notebook/workspace picker and writes the file.

---

## What Needs Building

| Item | Notes |
|---|---|
| File-based cell store | Replace/augment the current DB-only notebook app with the file-canonical design above |
| Kernel manager | Session-scoped manager in the main server; reuses runners from `apps/notebook/` |
| Run button + inline output | `MessageBubble` UI changes; output displayed below the triggering code block |
| Session kernel lifecycle | Spawn on first run, idle timeout, teardown on session end |
| Save as cell flow | Notebook/workspace picker, file write, index update |

---

## What Does Not Need Building

- A special Claude API for reading or writing cell content — Claude uses its existing file tools directly.
- A custom diff or merge tool — rename detection via delete+create is sufficient.
- A separate ordering field in the DB — filename prefix is the single source of truth for order.

---

## Notebook Mini-App Cell Editor (`apps/notebook/`)

Code cells in the notebook mini-app use CodeMirror 6 via `CodeMirrorEditor.tsx`. Each cell is an independent editor instance.

### Cell header controls (right-aligned)

| Control | Shown when | Action |
|---|---|---|
| ⛶ Fullscreen | Markdown cells | Side-by-side fullscreen editor/preview |
| Preview / Edit | Markdown cells | Toggle crossfade preview |
| Save | Cell is dirty | Save cell to disk |
| `↵` wrap toggle | Code cells | Toggle line wrapping (default OFF) |
| ▶ Run / ■ Stop | Code cells | Execute / abort kernel run |
| ✕ | Always | Show delete confirmation |

### Line-wrap toggle (`↵`)

- Per-cell state, not persisted (resets to OFF on page reload).
- Default OFF — code cells rarely benefit from wrapping.
- Same `Compartment`-based approach as the artifact editor: no editor recreation on toggle.
- `.cm-scroller { overflow: auto }` is explicitly set in the cell editor theme so horizontal scroll works when wrap is OFF. The outer cell card uses `overflow: hidden` (not `overflow-x: hidden`) to correctly clip content at the rounded corners without blocking the scroller's internal scroll.
