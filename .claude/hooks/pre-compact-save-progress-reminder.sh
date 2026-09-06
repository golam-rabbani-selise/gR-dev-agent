#!/bin/bash
# PreCompact hook: fires right before context gets compacted (auto, when the
# context window is filling up, or manual via /compact). This is the closest
# thing to an "approaching limit" signal Claude Code exposes, so we use it to
# nudge a /save-progress before detail gets summarized away.
cat <<'EOF'
{"hookSpecificOutput": {"hookEventName": "PreCompact", "additionalContext": "[save-progress-reminder] Context is about to be compacted. If .gr-agent/PROGRESS.md is stale or empty, run /save-progress now before continuing — compaction can drop details that /resume-task would otherwise need to pick the task back up cheaply."}}
EOF
