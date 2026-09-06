#!/bin/bash
# PostToolUse hook: touches a marker file whenever a "real work" tool runs
# (edits, shell commands, agent/skill delegation, web fetches). Read by
# learnings-reminder.sh so the Stop hook only asks for a learning after a
# turn that actually did something — not after a plain conversational reply.
MARKER="${CLAUDE_PROJECT_DIR:-.}/.claude/.stop-hook-work-marker"
mkdir -p "$(dirname "$MARKER")" 2>/dev/null
touch "$MARKER" 2>/dev/null
exit 0
