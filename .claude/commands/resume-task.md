---
description: Resume work from the last /save-progress without reloading full conversation history or the whole codebase
---
Resume the interrupted task using ONLY `.gr-agent/PROGRESS.md` as context. This command exists specifically to keep token cost low after a session was cut off — do NOT try to reconstruct history by re-reading the whole codebase, re-running `git log`, or asking to see the prior conversation.

Steps:
1. Read `.gr-agent/PROGRESS.md`. If it doesn't exist or its Task section is empty, say so and stop — ask what to work on instead of guessing.
2. Read ONLY the files listed under "Files touched" — just enough to re-orient.
3. State back, in 2-3 lines, what the task is and what the next step is, so the user can confirm before you proceed.
4. On confirmation, continue directly from "Next step". Don't re-plan the whole feature or re-verify already-completed steps.
5. Once you make meaningful further progress (or before ending the session again), run `/save-progress` — don't wait to be asked.

Constraints: minimize tool calls that pull in large context (avoid broad `Read` of unrelated files, avoid re-running the full test suite unless verifying the next step's change specifically).
