---
name: save-progress
description: Save current task progress to .gr-agent/PROGRESS.md before ending a session or hitting a token/cost limit. Use before closing the terminal or when a task is only partially done.
---

Overwrite `.gr-agent/PROGRESS.md` (create if missing) with a SHORT checkpoint — not a transcript:

1. **Task** — one line (name the spec file in `.gr-agent/specs/` if there is one).
2. **Last completed step** — one line, the last thing finished and verified.
3. **Next step** — one line, specific enough to act on with no other context.
4. **Files touched** — bullet list of the files that matter.
5. **Branch** — current branch name if on a feature branch.
6. **Notes / blockers** — anything non-obvious. Omit if none.

Keep it under ~25 lines. This is the ONLY thing `resume-task` reads.
