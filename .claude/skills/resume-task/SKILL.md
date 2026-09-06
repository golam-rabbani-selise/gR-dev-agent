---
name: resume-task
description: Resume interrupted work from .gr-agent/PROGRESS.md without reloading full conversation history. Use at the start of a new session to continue a task that was saved with save-progress.
---

Resume using ONLY `.gr-agent/PROGRESS.md` as context — do not reconstruct history by re-reading the whole codebase or the old conversation.

1. Read `.gr-agent/PROGRESS.md`. If missing or empty, say so and ask what to work on instead of guessing.
2. Read only the files listed under "Files touched".
3. State back the task and the next step in 2-3 lines, and wait for confirmation.
4. On confirmation, continue directly from "Next step" — don't re-plan or re-verify completed steps.
5. Once meaningful progress is made again (or before ending the session), run `save-progress`.
