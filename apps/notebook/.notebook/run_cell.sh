#!/usr/bin/env bash
# Run a single notebook cell via the kernel API.
# Usage: bash .notebook/run_cell.sh <cellId>
#
# Called by Claude CLI: bash .notebook/run_cell.sh <cellId>
# Reads the port from .notebook/port (written by server on startup).

set -euo pipefail

CELL_ID="${1:?Usage: run_cell.sh <cellId>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT_FILE="${SCRIPT_DIR}/port"

if [[ ! -f "$PORT_FILE" ]]; then
  echo "[run_cell] ERROR: port file not found at ${PORT_FILE}" >&2
  echo "[run_cell] Is the notebook server running?" >&2
  exit 1
fi

PORT=$(cat "$PORT_FILE")

# Stream SSE output, strip event/data framing, print raw lines
curl -s -N -X POST "http://localhost:${PORT}/api/kernel/run/${CELL_ID}" \
  -H "Accept: text/event-stream" | while IFS= read -r line; do
  # Strip SSE framing — print data payloads
  if [[ "$line" == data:* ]]; then
    payload="${line#data: }"
    # Extract the "line" field from JSON if present, else print raw
    if echo "$payload" | grep -q '"line"'; then
      echo "$payload" | sed 's/.*"line":"\(.*\)".*/\1/' | sed 's/\\n/\n/g'
    elif echo "$payload" | grep -q '"ok"'; then
      # compile event
      ok=$(echo "$payload" | grep -o '"ok":[a-z]*' | cut -d: -f2)
      output=$(echo "$payload" | sed 's/.*"output":"\(.*\)".*/\1/')
      if [[ "$ok" == "false" ]]; then
        echo "[compile error] $output"
      fi
    fi
  fi
done
