import type { Role } from "../riqs/contracts";

/**
 * A short, friendly present-participle phrase for a role — what shows next to the spinner and in
 * the phase banner instead of raw routing/CLI internals ("investigate (investigator) → opencode
 * [global preference order]"). Matches the plain-language style of how Claude Code itself narrates
 * a running step, rather than exposing orchestration machinery to every user.
 */
const ROLE_VERBS: Record<Role, string> = {
  planner: "Planning",
  investigator: "Investigating",
  backend: "Working on the backend",
  frontend: "Working on the frontend",
  database: "Working on the database",
  permission: "Auditing permissions",
  security: "Reviewing security",
  performance: "Profiling performance",
  coder: "Implementing",
  tester: "Testing",
  reviewer: "Reviewing",
  regression: "Checking for regressions",
  documentation: "Writing docs",
  git: "Working with git",
  release: "Preparing the release",
  general: "Working",
};

export function roleVerb(role: string): string {
  return ROLE_VERBS[role as Role] ?? "Working";
}
