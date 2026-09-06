---
description: Diagnose and fix a bug from a description or error
---
Bug: $ARGUMENTS

1. Locate: use the `quick-search` subagent to trace symptom → module → root cause (cheap lookup, not analysis — you do the reasoning after it returns file locations).
2. State the root cause before changing anything. If it took real digging, say `recommend /model opus` before going deeper.
3. Fix at the root (not the symptom), following CONTRIBUTING.md's seam boundaries. If the fix changes the public contract (CLI surface, exported API, `integrations.manifest.json`), update or create a spec first and tell the user.
4. Add or adjust a test that would have caught it — mandatory if a safety invariant was involved.
5. Verify via the `build-check` subagent (full gate: build/test/lint/typecheck).
