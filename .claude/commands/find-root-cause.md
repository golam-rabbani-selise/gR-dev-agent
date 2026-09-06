---
description: Investigate why an issue happened, when it was introduced, and how it happens — read-only, no fix
---
Issue: $ARGUMENTS

Pure investigation. Do **not** change any code in this command — the output is a report, not a patch. If the user wants it fixed after, they'll run `/fix-issue`.

1. **Locate** — use the `quick-search` subagent to trace the symptom to its seam and module (cheap lookup only; you do the reasoning after it returns file locations).
2. **How it happens** — read the located code path and explain the exact mechanism: which condition, which line, which piece of state or input triggers it. Be specific (`path:line`).
3. **Why it happened (root cause)** — state the underlying cause, not the symptom. If several are plausible, rank them and say which evidence supports the top one.
4. **When it was introduced** — `git log -p --follow -- <file>` / `git blame` on the exact lines. Report: commit hash, author, date, message.
5. **Impact** — note other call sites touching the same code path that could share the same root cause.
6. **Report back**:
   - **How:** ...
   - **Why / root cause:** ...
   - **When introduced:** commit `<hash>` — `<date>` — "<message>"
   - **Impact:** ...
   - **Suggested next step:** usually "run `/fix-issue` with this root cause"

Do not guess the commit or the cause without evidence — if `git blame`/`git log` doesn't give a clean answer, say so explicitly rather than fabricating a date or author.
