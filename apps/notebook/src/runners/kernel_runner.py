#!/usr/bin/env python3
"""
Persistent Python kernel for the notebook.
Protocol (stdin):  RUN <cellId> <base64-encoded source>\n
                   INTERRUPT <cellId>\n
Protocol (stdout): ... output lines ...
                   DONE <cellId>\n   or   ERR <cellId>\n
"""
import sys
import base64
import traceback
import io
import signal as _signal

# Unbuffered output is critical for streaming
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, line_buffering=True)
sys.stderr = sys.stdout  # merge stderr into stdout

_globals: dict = {}
_current_cell_id: str | None = None
_executing: bool = False  # True only while exec() is running


class _CellInterrupt(BaseException):
    pass


def _sigint_handler(signum, frame):
    # Only interrupt if we're inside an exec — otherwise ignore the signal
    if _executing:
        raise _CellInterrupt("interrupted")


_signal.signal(_signal.SIGINT, _sigint_handler)


class _CellStdout(io.TextIOWrapper):
    """Wraps stdout to ensure output flushes line by line."""
    pass


for line in sys.stdin:
    line = line.rstrip('\n')
    if not line:
        continue

    parts = line.split(' ', 2)
    cmd = parts[0]

    if cmd == 'RUN' and len(parts) == 3:
        cell_id = parts[1]
        b64 = parts[2]
        _current_cell_id = cell_id

        try:
            source = base64.b64decode(b64).decode('utf-8')
        except Exception as e:
            print(f'[kernel] failed to decode source: {e}', flush=True)
            print(f'ERR {cell_id}', flush=True)
            continue

        try:
            compiled = compile(source, f'<cell_{cell_id}>', 'exec')
            _executing = True
            exec(compiled, _globals)
            _executing = False
            sys.stdout.flush()
            print(f'DONE {cell_id}', flush=True)
        except _CellInterrupt:
            _executing = False
            sys.stdout.flush()
            print(f'ERR {cell_id}', flush=True)
        except SystemExit as e:
            _executing = False
            sys.stdout.flush()
            print(f'[kernel] SystemExit: {e.code}', flush=True)
            print(f'DONE {cell_id}', flush=True)
        except Exception:
            _executing = False
            traceback.print_exc()
            sys.stdout.flush()
            print(f'ERR {cell_id}', flush=True)

        _current_cell_id = None

    elif cmd == 'INTERRUPT' and len(parts) >= 2:
        # Send SIGINT to self — will interrupt running cell if any
        _signal.raise_signal(_signal.SIGINT)

    elif cmd == 'RESET':
        _globals.clear()
        print('RESET_DONE', flush=True)
