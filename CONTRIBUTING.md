# Contributing

## The one rule

`.gr-agent/` is the single source of truth for workflow and project knowledge. `CLAUDE.md`,
`AGENTS.md`, `.cursor/rules/`, and OpenCode config are **thin adapters** — they may only point back
to `.gr-agent/`. Never duplicate business rules or workflow logic into a tool-specific file
(master plan §3, §39, §227).

## Architecture seams

| Area | Where | Extend by |
|---|---|---|
| Platform differences | `src/platform/` | add to `PlatformService`; never read `process.platform` elsewhere |
| Shared run state | `src/riqs/store.ts` + `src/riqs/contracts.ts` | add a zod schema + store method |
| LLM providers | `src/llm/` | implement `LlmProvider`, register in `llm/registry.ts` |
| Workers | `src/workers/` | implement `AgentWorker`; register in `workers/registry.ts` |
| External CLIs | `integrations.manifest.json` + `src/integrations/providers/` | manifest entry (the only place install/login/argv strings live) |
| Orchestration | `src/orchestrator/` | DAG nodes, router priority chain, merge/tie-break |
| Rendering | `src/ui/` | isolated so a richer TUI can replace it (Milestone 2) |

## Dev loop

```bash
npm install
npm run dev -- doctor      # run the CLI from source
npm run build && npm test && npm run lint && npm run typecheck
```

## Cross-platform rules (master plan §42–67)

- `node:path` for every path; never string-concatenate.
- `spawn`/`execFile` with argv arrays and `shell: false`; a shell only when the user typed a shell expression.
- No native addons. Pure JS/TS dependencies only.
- Preserve a file's existing line endings on write (`src/util/lineEndings.ts`).
- `os.tmpdir()`, never `/tmp`.

## Safety invariants that must never regress

Workspace boundary, destructive-command approval, secret redaction, installer consent, login
consent, and write-conflict protection cannot be disabled through routing or `--skip`
(master plan §137, §159).
