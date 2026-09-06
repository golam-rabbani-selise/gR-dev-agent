# gR DEV AGENT

**AI engineering, orchestrated.**

A vendor-neutral, parallel multi-agent engineering workflow orchestrator.

> **Core principle:** the repository owns the workflow. Individual AI tools are only workers.

`gR DEV AGENT` splits an engineering task into a dependency graph of assignments, runs the
independent ones in parallel (read-only by default), merges structured findings into one root-cause
model, then drives implementation, tests and review. Every piece of shared state lives in plain
JSON / Markdown / YAML under the agent directory (`.gr-agent/`), so the same workflow can be operated
from the native provider worker, Claude Code, Codex CLI, OpenCode, Cursor, Antigravity, or a manual
copy/paste handoff.

## Install

Requirements:

- Node.js 20 or newer
- npm
- Git, if you want worktree isolation, diffs and normal repository workflows

Install the CLI globally:

```bash
npm install -g gr-dev-agent
gr-agent --version
```

The package installs two command names:

```bash
gr-agent --version
gra --version
```

Use it inside any repository:

```bash
cd <your repository>
gr-agent init
gr-agent doctor
gr-agent
```

Update to the latest published version:

```bash
npm install -g gr-dev-agent@latest
```

Works the same from macOS Terminal / iTerm2 and Windows PowerShell / Windows Terminal. No Docker,
WSL, Homebrew or Chocolatey required for the core CLI.

## Uninstall

If any runs created isolated Git worktrees, clean them up from the repository before removing the
CLI or scaffold:

```bash
gr-agent checkpoints cleanup
```

Remove the global CLI package:

```bash
npm uninstall -g gr-dev-agent
```

Confirm the commands are gone:

```bash
gr-agent --version
gra --version
```

If you ran `gr-agent init` in a repository and also want to remove that repository's gR DEV AGENT
scaffold, delete the generated agent directory and thin adapter files from that repository:

```bash
rm -rf .gr-agent .riqs-agent .cursor/rules/gr-dev-agent.mdc .opencode/instructions.md AGENTS.md CLAUDE.md
```

PowerShell equivalent:

```powershell
Remove-Item -Recurse -Force .gr-agent,.riqs-agent,.cursor/rules/gr-dev-agent.mdc,.opencode/instructions.md,AGENTS.md,CLAUDE.md -ErrorAction SilentlyContinue
```

For a local development install from this source tree, unlink the package instead:

```bash
npm unlink -g gr-dev-agent
```

## Quick start

```bash
cd <your repository>
gr-agent init          # scaffold .gr-agent/ + thin tool adapters
gr-agent doctor        # check platform, tools and worker readiness
gr-agent               # open the home screen + an interactive session
gr-agent run --workflow permission-bug "Investigate why Cockpit shows an item without read permission"
```

## The native worker

The native worker talks to a configured LLM provider directly — Anthropic, OpenAI, OpenRouter, or a
local Ollama endpoint — selected via environment variables (see `.env.example`). It never shells out
to another vendor's CLI. External CLI workers are optional plug-ins detected and (with explicit
consent) installed by `gr-agent integrations setup`.

## Workspaces

`gR DEV AGENT` is a global engineering agent. Any repository or multi-repo workspace is supported —
RIQS, Recyclium, personal projects, any existing Git repository. RIQS is a first-class **workspace**
(RIQS backend / Angular / Scheduler / React, RIQS repository skills, permission auditing, Cockpit and
subscription tracing) — not the product identity.

## Source of truth

`.gr-agent/` is canonical (a legacy `.riqs-agent/` directory is still discovered and used if present;
nothing is migrated or deleted automatically). `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, and
OpenCode config are thin adapters that only point back to it — never duplicate workflow rules into
them.

## Development

```bash
npm install
npm run build      # tsup -> dist/index.js
npm test           # vitest
npm run lint
npm run typecheck
```

This repository currently implements Milestone 1 (core runtime, DAG orchestration, native + external
+ manual workers, integration detection/install/auth, user-controlled routing/agents) plus the
branded home screen.
