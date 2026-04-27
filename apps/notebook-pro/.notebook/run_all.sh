#!/usr/bin/env bash
# Run all notebook cells in order.
# Usage: bash .notebook/run_all.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT_FILE="${SCRIPT_DIR}/port"

if [[ ! -f "$PORT_FILE" ]]; then
  echo "[run_all] ERROR: port file not found" >&2
  exit 1
fi

PORT=$(cat "$PORT_FILE")

# Fetch ordered cell list
cells=$(curl -s "http://localhost:${PORT}/api/cells")
count=$(echo "$cells" | grep -o '"id"' | wc -l)

echo "[run_all] Running $count cells..."

# Extract IDs in order using simple parsing
echo "$cells" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | while IFS= read -r cell_id; do
  echo ""
  echo "── cell $cell_id ──"
  bash "${SCRIPT_DIR}/run_cell.sh" "$cell_id"
done

echo ""
echo "[run_all] done."
