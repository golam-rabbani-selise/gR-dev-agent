#!/bin/bash
# Stop hook: nudges a learnings entry into .gr-agent/LEARNINGS.md before the
# session actually stops. Uses stop_hook_active to avoid looping forever —
# Claude Code sets it true on the re-entrant Stop call after a block.
# Gated on the mark-work.sh marker so plain conversational turns (no tool
# use) don't trigger a reflection prompt every single time.
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$( [ -t 0 ] && echo "{}" || cat )
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")

[ "$ACTIVE" = "true" ] && exit 0

MARKER="${CLAUDE_PROJECT_DIR:-.}/.claude/.stop-hook-work-marker"
[ -f "$MARKER" ] || exit 0
rm -f "$MARKER"

cat <<'EOF'
{"decision": "block", "reason": "Before stopping: if this task produced a non-obvious learning (a wrong assumption you had to correct, a gotcha in this codebase, a decision and why, something that would help next time), append one dated bullet to .gr-agent/LEARNINGS.md under today's date heading (create the heading if it doesn't exist yet). Keep it to 1-2 sentences, no fluff, no restating what the task was. If nothing non-trivial was learned, don't write anything — just stop again."}
EOF
