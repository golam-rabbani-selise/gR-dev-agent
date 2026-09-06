# CLAUDE.md — gR DEV AGENT

Thin adapter — `.gr-agent/` is the single source of truth for workflow and project knowledge (see
`CONTRIBUTING.md` "The one rule"). This file only points back to it; don't add project rules here.

gR DEV AGENT is a vendor-neutral, parallel multi-agent engineering workflow orchestrator (see
`README.md`). This repo is its own source — a TypeScript CLI (`src/`, `adapters/`, `test/`), built
with `tsup`, tested with `vitest`.

## Rules (always follow)

@.gr-agent/rules/git-conventions.md
@.gr-agent/rules/code-style.md
@.gr-agent/rules/testing.md
@.gr-agent/rules/architecture.md

Also read `CONTRIBUTING.md` before non-trivial work — it owns the architecture seam table and the
safety invariants that must never regress.

## Spec-driven workflow

Feature specs live in `.gr-agent/specs/` (template: `.gr-agent/specs/_template.md`), rough plans in
`.gr-agent/plans/` — one file per feature in each.

| Command | Does |
|---|---|
| `/feature-plan <requirement>` | Write a rough plan (draft contract) to `.gr-agent/plans/<name>-plan.md` — no spec, no implementation |
| `/feature-spec <name>` | Convert an approved `.gr-agent/plans/<name>-plan.md` into the final `.gr-agent/specs/<name>.md` (contract locked) |
| `/feature-implement <name>` | Implement the approved spec via subagents: implement → test → verify |
| `/fix-issue <bug>` | Root-cause trace and fix with a test |
| `/find-root-cause <issue>` | Investigate only — no fix |
| `/save-progress` | Save current progress to `.gr-agent/PROGRESS.md` — run before ending a session or hitting a token/cost limit |
| `/resume-task` | Resume from `.gr-agent/PROGRESS.md` only, without reloading full history |

Flow: `/feature-plan` → review/approve → `/feature-spec` → review/approve → `/feature-implement`.

Hard rules:
1. The spec's contract is the source of truth — code against it; contract changes go to the spec first.
2. Tests before calling anything done — build-check gate (`npm run build && npm test && npm run lint && npm run typecheck`) must be green.
3. Never weaken a safety invariant (CONTRIBUTING.md) to make an implementation simpler.
4. If a session may get cut off, run `/save-progress` first; start the next session with `/resume-task`.

## Agents

- `spec-writer` (sonnet) — called by `/feature-spec` to finalize an approved plan into a full spec.
- `implement` (sonnet) — called by `/feature-implement`; writes the feature against the spec's contract. Does not write or run tests.
- `test-writer` (haiku) — called by `/feature-implement` after `implement`; writes Vitest tests for what was just built.
- `build-check` (haiku) — called by `/feature-implement` after `test-writer`; runs the full verification gate and relays raw pass/fail, no diagnosis.
- `quick-search` (haiku) — cheap "where is X defined" lookup; use before bigger tasks to scope files without burning main-thread reads.

## Verification

`npm run build && npm test && npm run lint && npm run typecheck` — all four green (see CONTRIBUTING.md "Dev loop").
