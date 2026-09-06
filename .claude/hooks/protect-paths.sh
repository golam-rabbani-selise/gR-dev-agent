#!/bin/bash
# PreToolUse(Edit|Write): blocks edits to build artifacts & lockfiles
input=$(cat)
fp=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

case "$fp" in
  */node_modules/*|*/dist/*)
    echo "Blocked: $fp is a build artifact / dependency path — never edit these." >&2; exit 2 ;;
  *package-lock.json)
    echo "Blocked: package-lock.json is managed by npm — don't edit manually." >&2; exit 2 ;;
esac
exit 0
