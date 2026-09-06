---
description: Create a rough implementation plan in .gr-agent/plans/ — first stage of the plan → spec → implement flow
---
Create a plan for: $ARGUMENTS

## Steps

1. Map the requirement to an architecture seam via CONTRIBUTING.md's seam table (`src/platform/`, `src/orchestrator/`, `src/workers/`, `src/llm/`, `src/integrations/providers/`, `src/ui/`, `src/cli/`).
2. Create `.gr-agent/plans/<kebab-case-feature-name>-plan.md`.
3. The plan must cover:
   - **Requirement summary** — what and why, in 2-3 lines
   - **Affected areas** — seam(s), files/modules likely to change
   - **Proposed contract (draft)** — exported functions/types, CLI surface, config or `integrations.manifest.json` shape — not final, `/feature-spec` finalizes this
   - **Approach** — order of work, whether it touches a safety invariant
   - **Risks / open questions** — anything needing a human decision
4. STOP after writing the plan. Do NOT create a spec or write code.
5. Tell the user: "Plan ready at `.gr-agent/plans/<name>-plan.md` — review it, then run `/feature-spec <name>` to generate the spec."

## Rules
- Plans live ONLY in `.gr-agent/plans/` — never in `.gr-agent/specs/`
- One plan file per feature, same name as the future spec
