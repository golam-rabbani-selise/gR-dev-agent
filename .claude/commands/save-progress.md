---
description: Save current task progress to .gr-agent/PROGRESS.md so work can resume later without reloading full context
---
Overwrite `.gr-agent/PROGRESS.md` (create it if missing) with a SHORT checkpoint of exactly where things stand right now. Do not write a transcript or summary of the whole conversation — only what's needed to pick the task back up cold, in as few lines as possible:

1. **Task** — one line: what feature/bug/spec this is (name the spec file in `.gr-agent/specs/` if there is one).
2. **Last completed step** — one line: the last concrete thing that was finished and verified.
3. **Next step** — one line: the exact next action, specific enough to act on with no other context.
4. **Files touched** — bullet list of file paths changed or central to the task so far.
5. **Branch** — current branch name if work is on a feature branch.
6. **Notes / blockers** — anything non-obvious the next session needs to know. Omit if none.

Update the `_Last updated_` line at the bottom to the current date/time.

Keep the whole file under ~25 lines. This file is the ONLY thing `/resume-task` will read — if it's missing, resuming will be expensive and error-prone, so be precise, not verbose.
