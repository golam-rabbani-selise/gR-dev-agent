---
name: feature-implement
description: Implement an approved feature spec end-to-end against its locked contract, then write tests and run the full verification gate. Use after .gr-agent/specs/<name>.md has been reviewed and approved.
---

Implement the spec at `.gr-agent/specs/<name>.md`.

1. Confirm status is `approved` (or `in-progress`) — if not, or the contract is ambiguous, stop and ask. Set status to `in-progress`. The contract section is locked — code against it.
2. Implement against the contract, in the architecture seam it belongs to (CONTRIBUTING.md's seam table) — never bypass the registry/interface for that seam. Any installer/login/worker-argv string goes ONLY in `integrations.manifest.json`.
3. Write Vitest tests in `test/<subject>.test.ts` — happy path, an edge case, and an explicit regression test if a safety invariant is involved.
4. Run the full gate: `npm run build && npm test && npm run lint && npm run typecheck`. Fix and re-run until green.
5. If implementation forces a contract change: stop, update the spec's contract section, tell the user, get confirmation before continuing.
6. When green: set spec status `done`, summarize files changed.
