import { ConfigSchema, WorkersConfigSchema, AgentsConfigSchema, type Config, type WorkersConfig, type AgentsConfig } from "./schema";

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

/** Sensible starting roles (master plan §126 — defaults only, always overridable). */
export function defaultWorkersConfig(): WorkersConfig {
  return WorkersConfigSchema.parse({
    workers: {
      native: { enabled: true, roles: ["planner", "investigator", "backend", "frontend", "coder", "tester", "reviewer", "general"] },
      claude: { enabled: false, roles: ["planner", "permission", "security", "reviewer"] },
      codex: { enabled: false, roles: ["backend", "coder", "tester"] },
      cursor: { enabled: false, roles: ["frontend", "coder"] },
      opencode: { enabled: false, roles: ["reviewer", "regression"] },
      antigravity: { enabled: false, roles: [] },
    },
  });
}

export function defaultAgentsConfig(): AgentsConfig {
  return AgentsConfigSchema.parse({ agents: {} });
}
