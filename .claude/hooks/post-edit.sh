#!/bin/bash
# PostToolUse(Edit|Write): auto-fix lint on edited TS/JS files (fast, no full build).
input=$(cat)
fp=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

case "$fp" in
  *.ts|*.tsx|*.js|*.mjs)
    command -v npx >/dev/null 2>&1 && npx --no-install eslint --fix "$fp" >/dev/null 2>&1
    ;;
esac
exit 0
