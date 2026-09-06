---
description: Implement an approved spec via subagents — implement, test, verify
---
Implement the spec `.gr-agent/specs/$ARGUMENTS.md`.

1. Read the spec. If status is not `approved`/`in-progress`, or the contract is ambiguous, stop and ask. Otherwise set status to `in-progress`. The contract section is locked — code against it.
2. **Implement**: `implement` subagent builds the checklist against the locked contract.
3. **Tests**: `test-writer` subagent writes Vitest tests for what `implement` built.
4. **Verify**: `build-check` subagent runs the full gate (build/test/lint/typecheck). On FAIL, diagnose and fix here yourself, re-run until green. Tick checklist items as they pass.
5. If implementation forces a contract change: STOP, update the spec's contract section, tell the user, get confirmation before continuing.
6. When the gate is green: set spec status `done`, summarize files changed.
