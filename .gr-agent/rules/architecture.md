# Architecture pointer

The seam table, safety invariants, and cross-platform rules are canonical in `CONTRIBUTING.md` at
the repo root — read it before non-trivial work. This file does not repeat it; it only adds
workflow-level notes that CONTRIBUTING.md doesn't cover:

- New feature → a spec in `.gr-agent/specs/` (see `/feature-plan`, `/feature-spec` below) before code.
- `integrations.manifest.json` changes: only add an entry after checking the value against the
  vendor's current official docs, and set `"verified": true` only then — never guess an install
  command, login flow, or worker argv.
- `.gr-agent/` (this directory) is the single source of truth for workflow and project knowledge —
  `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, and the OpenCode config are thin adapters that point
  back here. Don't add project/business rules directly into a tool-specific file — add them here
  and let the adapters reference them.
