---
name: feature-spec
description: Convert an approved .gr-agent/plans/<name>-plan.md into a full feature spec in .gr-agent/specs/<name>.md. Second stage of the plan → spec → implement flow. Use after a plan has been reviewed and approved.
---

Read the approved plan at `.gr-agent/plans/<name>-plan.md` and the template at
`.gr-agent/specs/_template.md`.

Produce `.gr-agent/specs/<name>.md` following the template:
- Finalize the contract from the plan's draft — this becomes the source of truth for implementation. Be precise: exported function/type signatures, CLI flags, config shape, or exact `integrations.manifest.json` entries.
- Expand into an implementation checklist with concrete file paths, following the architecture seam the feature belongs to.
- Flag anything touching a safety invariant — it needs an explicit regression test, not just a happy-path one.

Save with status `draft`. Do NOT implement anything — the spec must be fully reviewable before any code is written.
