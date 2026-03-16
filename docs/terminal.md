# Terminal Panel

Part of the [Server](server.md) (exec endpoint) and [Client](client.md) (`TerminalPanel` component). Linked from [Architecture](architecture.md).

A lightweight shell panel embedded in the sidebar's **Term** tab. Lets you run one-off commands in the project directory without involving Claude — useful for `git status`, `npm test`, build scripts, log tailing, etc.

---

## Design Decisions

### No pseudo-terminal (no `node-pty`)

A full interactive pty (via `node-pty`) would support `vim`, persistent `cd`, arrow-key readline, etc. but requires a native C++ addon compiled against Node's ABI. This adds `node-gyp` build dependencies, breaks on Node version upgrades without `npm rebuild`, and mandates a WebSocket connection (SSE is one-way).

The current implementation uses plain `child_process.spawn` + SSE. This covers 95% of real usage (build tools, git, tests) without native dependencies.

`node-pty` is a clean future upgrade: once `TerminalPanel` already uses xterm.js for rendering, adding pty support means adding `node-pty` + switching the transport from SSE to WebSocket. The component interface would remain the same.

### ANSI colours without a pty

Without a pty, `isatty()` returns false in child processes, so many tools suppress colour by default. The exec endpoint injects these environment variables:

```
FORCE_COLOR=1       # chalk, npm scripts, jest, ESLint, many Node tools
COLORTERM=truecolor # some tools (e.g. git, delta) check this
TERM=xterm-256color # fallback for tools that read $TERM
COLUMNS=120         # line-wrapping hint (programs may ignore without pty)
LINES=40            # terminal height hint
```

This gets correct ANSI output from the majority of dev tools. Tools that call `isatty()` directly (e.g. `ls --color=auto`, `grep --color=auto`) still strip colours; use `--color=always` explicitly for those.

### xterm.js for rendering

`@xterm/xterm` interprets ANSI/VT100 escape sequences and renders them correctly in the browser — colours, bold, cursor movement. The alternative (raw `<pre>` output) would require a separate `ansi-to-html` conversion step and lose fidelity.

`@xterm/addon-fit` + `ResizeObserver` keeps the terminal sized to its container. Because the Term tab div uses CSS `hidden` instead of conditional unmounting, the xterm.js `Terminal` instance persists across tab switches, preserving scrollback history.

---

## Server Endpoint

```
POST /api/projects/:id/exec
Body: { command: string }
```

Responds with `Content-Type: text/event-stream`. Events:

| Event | Data | When |
|---|---|---|
| `output` | `{ text: string }` | Each stdout/stderr chunk |
| `done` | `{ exitCode: number }` | Process exits |
| `error` | `{ message: string }` | Spawn failure |

Implementation:

1. Validates the project exists and `command` is non-empty
2. Sets SSE headers, calls `res.flushHeaders()`
3. Spawns `sh -c <command>` with the project `path` as `cwd`; both `stdout` and `stderr` are piped and forwarded as `event: output`
4. On process `close`, sends `event: done` with the exit code
5. Kills the child with `SIGTERM` if the client disconnects (`res.on('close')`) or after 60 seconds (with a warning line printed to the terminal first)

The 60-second timeout is intentional for long-running tasks — use `npm run build` or a background job for anything expected to take longer.

---

## Client

### `execCommand(projectId, command, handlers)` (`api.ts`)

Sends the `POST /exec` request and parses the SSE stream. Returns a cancel function that calls `AbortController.abort()`, which triggers `res.on('close')` server-side and kills the subprocess.

```ts
type ExecHandlers = {
  onOutput: (text: string) => void
  onDone:   (exitCode: number) => void
  onError?: (message: string) => void
}
```

### `TerminalPanel` component

Lives in `SessionSidebar`'s Term tab. Receives `projectId` as its only prop.

**Layout:**
- xterm.js viewport (`flex-1 min-h-0`) fills the available height
- Input bar at the bottom: `$` prompt, text input, Run / Stop / Clear buttons

**Command lifecycle:**
1. User types command and presses Enter or clicks Run
2. `runCommand()` prints `$ <command>` to the terminal in bold, clears the input, sets `running = true`
3. Calls `execCommand()` with `onOutput → term.write()`, `onDone → print exit code badge`, `onError → print error line`
4. On done/error/cancel: `running = false`, cancel ref cleared

**Stop button:** calls `cancelRef.current()` (aborts the fetch), prints `[stopped]` in amber, sets `running = false`. The server kills the subprocess when the SSE connection drops.

**Clear button:** calls `term.clear()` — clears the visible area; xterm.js retains scrollback.

**Command history:** up/down arrows cycle through `historyRef` (array of past commands, most-recent-last). Pressing Up saves the current in-progress input as a draft; pressing Down back to index -1 restores it. Duplicates at the tail are skipped.

**Tab persistence:** the Term tab div is always rendered (CSS `hidden` when inactive) so the xterm.js `Terminal` instance is never destroyed. `FitAddon.fit()` is called via `ResizeObserver` — this fires when the div goes from hidden to visible, ensuring correct column/row calculation on tab switch.

---

## Limitations

- **No interactive programs** — `vim`, `top`, `python` REPL, `ssh` etc. receive no stdin and stall. The 60 s timeout will eventually kill them.
- **No persistent shell state** — each command runs in a fresh `sh -c` in the project `cwd`. `cd foo && pwd` works within one command, but a `cd` alone has no effect on the next command.
- **`COLUMNS` is advisory** — without a pty, some programs ignore it and output at their own default width (usually 80).
