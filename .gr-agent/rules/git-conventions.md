# Git Conventions

- Base branch: `main` — feature branches from it, PR back into it. No direct commits on `main` for anything non-trivial.
- Branch naming: `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`.
- Commits: Conventional Commits — `feat(scope): message`, `fix(scope): message`, `chore(scope): message`. Scope = the architecture seam touched (`platform`, `orchestrator`, `workers`, `llm`, `integrations`, `ui`, `cli`), see CONTRIBUTING.md's seam table.
- Never commit: secrets, `node_modules/`, `dist/`, `coverage/`.
- No force push to `main`.
