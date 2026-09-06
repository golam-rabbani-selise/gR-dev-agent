---
name: fix-issue
description: Root-cause trace and fix a bug with a regression test. Use when something is broken, throwing, or behaving unexpectedly.
---

1. Locate: trace the symptom to its architecture seam and module — cheap lookup first (Glob/Grep), reasoning after.
2. State the root cause before changing anything.
3. Fix at the root, not the symptom, following CONTRIBUTING.md's seam boundaries. If the fix changes the public contract (CLI surface, exported API, `integrations.manifest.json`), update or create a spec first.
4. Add or adjust a test that would have caught it — mandatory if a safety invariant was involved.
5. Verify: `npm run build && npm test && npm run lint && npm run typecheck`, all green.
