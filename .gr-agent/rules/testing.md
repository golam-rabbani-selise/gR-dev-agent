# Testing

- Vitest. Test files live in `test/`, named `<subject>.test.ts`.
- Every new module/function gets tests: happy path + at least one edge case; for anything touching a safety invariant (workspace boundary, destructive-command approval, secret redaction, installer/login consent, write-conflict protection — CONTRIBUTING.md "Safety invariants") a regression test is mandatory, not optional.
- Run: `npm test` (all) or `npx vitest run <path>` (scoped).
- Gate before calling anything done: `npm run build && npm test && npm run lint && npm run typecheck` all green (see CONTRIBUTING.md "Dev loop").

## Definition of done
Spec checklist fully ticked + build/test/lint/typecheck green.
