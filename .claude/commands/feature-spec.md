---
description: Convert an approved .gr-agent/plans/<name>-plan.md into a full .gr-agent/specs/<name>.md — second stage of the feature-plan → feature-spec → implement flow
---
Generate a spec from: `.gr-agent/plans/$ARGUMENTS-plan.md`

## Steps

1. Read `.gr-agent/plans/$ARGUMENTS-plan.md`. If it doesn't exist, list available plans in `.gr-agent/plans/` and stop.
2. Confirm with the user that the plan is APPROVED. If not approved, stop.
3. Use the `spec-writer` agent to create `.gr-agent/specs/$ARGUMENTS.md` from `.gr-agent/specs/_template.md`:
   - Finalize the contract from the plan's draft (this becomes the source of truth)
   - Expand into an implementation checklist with concrete file paths
   - Flag anything touching a safety invariant — it needs a regression test
4. Mark the plan file header: `> Status: SPEC CREATED → .gr-agent/specs/$ARGUMENTS.md`
5. Tell the user: "Spec ready at `.gr-agent/specs/$ARGUMENTS.md` — review, then `/feature-implement $ARGUMENTS`."
6. STOP. Do not write or edit any code in this command — implementation only happens in `/feature-implement`.

## Rules
- A spec is ONLY created from an approved plan — never directly
- Once the spec exists, the spec's contract wins; the plan is historical reference
- Changing the contract later = change the spec first (never the code first)
