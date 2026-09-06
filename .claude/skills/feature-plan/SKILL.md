---
name: feature-plan
description: Write a rough implementation plan to .gr-agent/plans/<name>-plan.md. First stage of the plan → spec → implement flow. Use when starting a new feature from a requirement.
---

Write a rough implementation plan for this requirement and save it to
`.gr-agent/plans/<name>-plan.md` (choose a short kebab-case name).

The plan is a draft contract — no spec, no code yet. Cover:
- Feature goal and user value
- Affected architecture seam(s) — see CONTRIBUTING.md's seam table (`src/platform/`, `src/orchestrator/`, `src/workers/`, `src/llm/`, `src/integrations/providers/`, `src/ui/`, `src/cli/`)
- Rough contract shape (exported functions/types, CLI flags, config, or `integrations.manifest.json` entries)
- Whether it touches a safety invariant (CONTRIBUTING.md "Safety invariants")
- Open questions that must be answered before the spec can be written

End with a clear list of decisions needed before writing the spec.

After saving the plan, show a summary and wait for approval before doing anything else.
