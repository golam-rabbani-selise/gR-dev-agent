/**
 * Files written by `gr-agent init`. The agent directory (`__AGENT_DIR__`, resolved at init time to
 * `.gr-agent/` or a legacy `.riqs-agent/`) is the single source of truth; the adapter files only
 * point back to it (master plan §3, §15, §39, §227).
 *
 * Use `renderTemplate()` to substitute `__AGENT_DIR__` before writing.
 */

export function renderTemplate(content: string, agentDir: string): string {
  return content.replace(/__AGENT_DIR__/g, agentDir);
}

const ADAPTER_BODY = `gR DEV AGENT owns this repository's engineering workflow. Do not duplicate workflow rules here.

Always read, in order:
- __AGENT_DIR__/memory/project.md
- __AGENT_DIR__/config.json
- __AGENT_DIR__/workflow/task.json (when a run is active)

Follow the active assignment under:
- __AGENT_DIR__/workflow/assignments/

Use the skills under:
- __AGENT_DIR__/skills/

Write structured results to the path named in your assignment's \`outputFile\`.
Never rely on hidden conversation state for handoff — the assignment file is the input, the result file is the output.
`;

export const ADAPTER_FILES: Record<string, string> = {
  "CLAUDE.md": `# CLAUDE.md\n\n${ADAPTER_BODY}`,
  "AGENTS.md": `# AGENTS.md\n\n${ADAPTER_BODY}`,
  ".cursor/rules/gr-dev-agent.mdc": `---\ndescription: gR DEV AGENT source of truth\nalwaysApply: true\n---\n\n${ADAPTER_BODY}`,
  ".opencode/instructions.md": `# OpenCode instructions\n\n${ADAPTER_BODY}`,
};

export const AGENT_DOC_FILES: Record<string, string> = {
  "README.md": `# __AGENT_DIR__/

Canonical workflow + knowledge for gR DEV AGENT. Plain JSON / Markdown / YAML so every tool —
native worker, Claude Code, Codex, Cursor, Antigravity, OpenCode, or a manual handoff — reads the
same thing.

- \`config.json\`  — mode, routing, parallelism, native provider config
- \`workers.json\` — which workers are enabled and which roles they hold
- \`agents.json\`  — named worker+model personas
- \`memory/\`      — project facts, architecture, conventions, decisions
- \`skills/\`      — reusable investigation playbooks
- \`workflows/\`   — parallel workflow presets
- \`workflow/\`    — live run state (task, plan, assignments, results, evidence, checkpoints)
`,
  "memory/project.md": `# Project memory

_One paragraph: what this repository is, its primary language(s) and frameworks, how it is built and
tested. Keep it current — every worker reads this first._
`,
  "memory/architecture.md": `# Architecture

_Key modules, the main request/data flow, and where the important boundaries are._
`,
  "memory/conventions.md": `# Conventions

_Naming, error handling, logging, testing patterns a worker should match._
`,
  "memory/permissions.md": `# Permissions model

_How authorization works in this codebase: roles, per-artifact checks, dynamic role expansion,
where the enforcement points are._
`,
  "memory/known-issues.md": `# Known issues

_Recurring bug classes, fragile areas, flaky tests._
`,
  "memory/decisions.md": `# Decisions

_Dated architectural decisions and their rationale._
`,
  "prompts/planner.md": `You are the planner. Decide whether the task can be parallelised, which investigations are
independent, which assignments are read-only vs writers, and the dependency graph. Output the plan
as JSON matching the Plan contract.
`,
  "prompts/backend-agent.md": `Role: backend investigator. Trace Controller → Command → Handler → Service → Repository for the
described behaviour. Report facts (with file:line), then hypotheses, then recommendations.
`,
  "prompts/frontend-agent.md": `Role: frontend investigator. Determine whether the UI independently renders or requests data it
should not, or only reflects what the server returns.
`,
  "prompts/reviewer.md": `Role: reviewer. Check the proposed change against the acceptance criteria, the call chain, and
regression risk. Approve, request changes, or block — with reasons.
`,
  "prompts/tester.md": `Role: tester. Locate existing tests for the affected area, identify gaps, add targeted tests, and
run them. Report pass/fail with output.
`,
  "prompts/security-agent.md": `Role: security / permission auditor. Follow the permission-audit skill. Focus on authorization
bypass, missing artifact-level filters, and dynamic role expansion.
`,
  "skills/permission-audit.md": `# Permission audit

## Purpose
Find authorization bypasses: an actor seeing or changing data they lack permission for.

## Inputs
- The entity/screen where the bypass is observed
- The actor's roles and the expected permission

## Search strategy
1. Locate the read/query path for the entity (controller → service → repository).
2. Find where RolesAllowedToRead / IdsAllowedToRead (or equivalent) are applied.
3. Check dynamic role expansion and inherited/parent permissions.
4. Compare the Cockpit/list query filter with the single-item query filter.

## Checks
- Is an artifact-level read filter applied on every path, including list/summary endpoints?
- Are dynamic roles resolved consistently between endpoints?
- Do feature flags or environment config change the enforcement?

## Output format
facts (file:line) → hypotheses → recommended minimal fix → regression risks

## Validation
Add a test where the unauthorized actor must receive 403 / an empty result.
`,
  "skills/trace-endpoint.md": `# Trace endpoint

## Purpose
Map an HTTP endpoint end-to-end.

## Search strategy
1. Find the route/attribute matching the path + verb.
2. Follow to the command/handler, then the service, then the repository/query.
3. Note every authorization, validation and mapping step.

## Output format
An ordered call chain with file:line for each hop, plus the DB/query that ultimately runs.
`,
  "skills/async-audit.md": `# Async audit

## Purpose
Find fire-and-forget async, missing awaits, and unhandled rejections.

## Search strategy
- Search for calls returning a Promise/Task that are not awaited.
- Check background jobs and event handlers for error propagation.

## Output format
List of sites (file:line), the risk, and the fix.
`,
  "skills/regression-review.md": `# Regression review

## Purpose
Before finalising, check the diff for unintended behaviour change.

## Checks
- Does the change alter a shared code path used elsewhere?
- Are there callers relying on the old behaviour?
- Are line endings and unrelated formatting untouched?

## Output format
Regression risks with severity, and what to test.
`,
};

export const WORKFLOW_FILES: Record<string, string> = {
  "workflows/bug-fix.yaml": `name: bug-fix
description: Generic investigate → implement → test + review.
parallel:
  - id: investigate
    role: investigator
after:
  - id: implement
    role: coder
  - id: test
    role: tester
  - id: review
    role: reviewer
`,
  "workflows/permission-bug.yaml": `name: permission-bug
description: Parallel permission investigation, then minimal fix + targeted tests + security review.
parallel:
  - id: api-authorization
    role: permission
    skills: [trace-endpoint]
  - id: artifact-permissions
    role: permission
    skills: [permission-audit]
  - id: dynamic-role-resolution
    role: permission
    skills: [permission-audit]
  - id: frontend-visibility
    role: frontend
after:
  - id: root-cause-merge
    role: investigator
  - id: implementation
    role: coder
  - id: targeted-tests
    role: tester
  - id: security-review
    role: security
    skills: [permission-audit, regression-review]
`,
  "workflows/endpoint-change.yaml": `name: endpoint-change
description: Change an endpoint safely — trace, implement, test contract, review.
parallel:
  - id: trace
    role: backend
    skills: [trace-endpoint]
  - id: callers
    role: investigator
after:
  - id: implement
    role: coder
  - id: contract-tests
    role: tester
  - id: review
    role: reviewer
`,
  "workflows/frontend-backend-trace.yaml": `name: frontend-backend-trace
description: Follow one behaviour across the FE/BE boundary.
parallel:
  - id: frontend
    role: frontend
  - id: backend
    role: backend
    skills: [trace-endpoint]
after:
  - id: merge
    role: investigator
  - id: review
    role: reviewer
`,
  "workflows/regression-review.yaml": `name: regression-review
description: Read-only review of the current diff for regressions.
parallel:
  - id: diff-review
    role: reviewer
    skills: [regression-review]
  - id: caller-impact
    role: investigator
after:
  - id: summary
    role: reviewer
`,
};
