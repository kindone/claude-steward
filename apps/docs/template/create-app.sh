#!/usr/bin/env bash
# create-app.sh — clone this template into a new docs project and register it
# as a Steward mini app.
#
# Usage:
#   bash create-app.sh <app-name> [destination-dir]
#
# Example:
#   bash create-app.sh my-api-docs ~/my-api-docs
#
# If destination-dir is omitted, the app is created at ~/<app-name>.

set -euo pipefail

TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# apps/docs/dist/server.js lives one level up from this template directory.
# Resolve the parent dir absolutely so the printed curl command is clean
# (no unresolved `..` component).
DOCS_SERVER="$(cd "$TEMPLATE_DIR/.." && pwd)/dist/server.js"

APP_NAME="${1:-}"
DEST_DIR="${2:-$HOME/$APP_NAME}"

if [[ -z "$APP_NAME" ]]; then
  echo "Usage: bash create-app.sh <app-name> [destination-dir]"
  exit 1
fi

if [[ -d "$DEST_DIR" ]]; then
  echo "ERROR: destination already exists: $DEST_DIR"
  exit 1
fi

# ── Copy template ──────────────────────────────────────────────────────────────
cp -r "$TEMPLATE_DIR" "$DEST_DIR"
rm -f "$DEST_DIR/create-app.sh"          # don't copy this script into the project
rm -f "$DEST_DIR/README.md"
rm -f "$DEST_DIR/.docs-chat.db"          # never inherit template's chat session state
rm -f "$DEST_DIR/.docs-chat.db-shm"
rm -f "$DEST_DIR/.docs-chat.db-wal"

# Patch site_name in mkdocs.yml
sed -i "s/site_name: 'My Docs'/site_name: '$APP_NAME'/" "$DEST_DIR/mkdocs.yml"

echo ""
echo "✓ Created docs project at: $DEST_DIR"
echo ""
echo "Next steps:"
echo ""
echo "  1. Customise mkdocs.yml and docs/ content."
echo ""
echo "  2. Register it as a Steward mini app via the API:"
echo ""
echo "     curl -s -X POST http://localhost:3001/api/projects/<PROJECT_ID>/apps \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -H 'Authorization: Bearer <TOKEN>' \\"
echo "       -d '{"
echo "         \"name\": \"$APP_NAME\","
echo "         \"type\": \"docs\","
echo "         \"commandTemplate\": \"node $DOCS_SERVER {port} --docs-dir $DEST_DIR\","
echo "         \"workDir\": \"$DEST_DIR\""
echo "       }'"
echo ""
echo "  3. Start the app from the Steward Apps panel, or:"
echo "     curl -X POST http://localhost:3001/api/apps/<CONFIG_ID>/start -H 'Authorization: Bearer <TOKEN>'"
echo ""
