# Code Style

- TypeScript, strict mode, Node >= 20, ESM (`"type": "module"`).
- Follow `eslint.config.js` — `no-explicit-any` is off, unused vars must be prefixed `_` to suppress the warning intentionally, not silenced globally.
- Cross-platform rules are non-negotiable (see CONTRIBUTING.md "Cross-platform rules"): `node:path` for every path, never string-concatenate; `spawn`/`execFile` with argv arrays and `shell: false` (a real shell only when the user typed a shell expression); no native addons — pure JS/TS deps only; preserve a file's existing line endings on write (`src/util/lineEndings.ts`); `os.tmpdir()`, never `/tmp`.
- No new dependency without asking — check `package.json` first; this is a CLI users install globally, so the dependency tree matters.
- Follow the architecture seams in CONTRIBUTING.md — new code goes in the seam it belongs to (`src/platform/`, `src/orchestrator/`, `src/workers/`, `src/llm/`, `src/integrations/providers/`, `src/ui/`), never bypassing the registry/interface for that seam.
- `integrations.manifest.json` is the ONLY place installer/login/worker-argv strings live — the model never constructs these inline in code.
