# AGENTS.md — gR DEV AGENT

Thin adapter — `.gr-agent/` is the single source of truth for workflow and project knowledge (see
`CONTRIBUTING.md` "The one rule"). Full conventions: `.gr-agent/rules/`. Architecture seams and
safety invariants: `CONTRIBUTING.md` at the repo root — read it before non-trivial work.

## What this repo is

gR DEV AGENT — a vendor-neutral, parallel multi-agent engineering workflow orchestrator, published
as an npm CLI (`gr-agent` / `gra`). This repo is the tool's own source, a TypeScript project:

```
src/            # runtime: platform/, orchestrator/, workers/, llm/, integrations/, ui/, cli/
adapters/       # thin per-tool adapter templates gr-agent scaffolds into a target repo
test/           # vitest specs
integrations.manifest.json   # ONLY place installer/login/worker-argv strings live
```

## Skills

`.agents/skills/` mirrors `.claude/skills/` — generic engineering skills (API design, debugging,
security hardening, TDD, code review, etc.) plus this project's spec-driven workflow skills
(`feature-plan`, `feature-spec`, `feature-implement`, `fix-issue`, `save-progress`, `resume-task`).
Invoke explicitly with `$skill-name`, or describe the task and let the tool match by description.

## Workflow

Specs live in `.gr-agent/specs/`, plans in `.gr-agent/plans/`. Flow: plan → review/approve → spec
→ review/approve → implement. The spec's contract is the source of truth once approved — code
against it; a contract change goes to the spec first, never straight to code.

Before ending a session, checkpoint progress to `.gr-agent/PROGRESS.md` (mirrors `/save-progress`
in Claude Code) so the next session can resume cheaply from `.gr-agent/PROGRESS.md` alone.

## Verification

`npm run build && npm test && npm run lint && npm run typecheck` — all four green before calling
anything done.

## Never

Weaken a safety invariant (workspace boundary, destructive-command approval, secret redaction,
installer/login consent, write-conflict protection — CONTRIBUTING.md) to make something simpler;
add an `integrations.manifest.json` entry without checking it against the vendor's current official
docs; force-push or commit directly on `main` for anything non-trivial; edit `node_modules/`,
`dist/`, or `package-lock.json` by hand.
