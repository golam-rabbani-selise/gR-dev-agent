#!/bin/bash
# PreToolUse(Bash): blocks a couple of genuinely dangerous commands.
input=$(cat)
cmd=$(echo "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

block() { echo "$1" >&2; exit 2; }

case "$cmd" in
  *"rm -rf"*) block "Blocked: rm -rf. Delete specific files instead." ;;
esac
echo "$cmd" | grep -qE "git push.*(--force|-f)\b" && block "Blocked: force push."

exit 0
