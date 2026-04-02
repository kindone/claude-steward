#!/usr/bin/env bash
# Persistent Bash kernel for the notebook.
# Protocol (stdin):  RUN <cellId> <base64-encoded source>
# Protocol (stdout): ... output lines ...
#                    DONE <cellId>   or   ERR <cellId>

while IFS= read -r line; do
  [[ -z "$line" ]] && continue

  cmd="${line%% *}"
  rest="${line#* }"

  if [[ "$cmd" == "RUN" ]]; then
    cell_id="${rest%% *}"
    b64="${rest#* }"

    # Decode base64 source
    source=$(printf '%s' "$b64" | base64 -d 2>/dev/null)
    if [[ $? -ne 0 ]]; then
      echo "[kernel] failed to decode source"
      echo "ERR $cell_id"
      continue
    fi

    # Run in the same shell (preserves state between cells)
    eval "$source"
    exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
      echo "DONE $cell_id"
    else
      echo "ERR $cell_id"
    fi

  elif [[ "$cmd" == "RESET" ]]; then
    # Unset all non-essential variables (best-effort)
    unset $(compgen -v | grep -v '^(BASH|FUNCNAME|GROUPS|PIPESTATUS|SHELLOPTS|IFS|PATH|HOME|PWD|OLDPWD|_)') 2>/dev/null
    echo "RESET_DONE"
  fi

done
