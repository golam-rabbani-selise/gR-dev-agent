import { promises as fs } from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../util/json";
import { RiqsPaths } from "../riqs/paths";
import { Platform } from "../platform/platform";
import {
  ConfigSchema,
  WorkersConfigSchema,
  AgentsConfigSchema,
  ProfileSchema,
  type Config,
  type WorkersConfig,
  type AgentsConfig,
  type Profile,
} from "./schema";
import { defaultConfig, defaultWorkersConfig, defaultAgentsConfig } from "./defaults";
import { parseOrThrow } from "../riqs/contracts";

export interface LoadedConfig {
  paths: RiqsPaths;
  config: Config;
  workers: WorkersConfig;
  agents: AgentsConfig;
  initialised: boolean;
}

/** Load project config, merging a thin user-global layer (master plan §55). Project always wins. */
export async function loadConfig(workspaceRoot: string): Promise<LoadedConfig> {
  const paths = new RiqsPaths(workspaceRoot);
  const initialised = await fs
    .stat(paths.dir)
    .then((s) => s.isDirectory())
    .catch(() => false);

  const userGlobal = await loadUserGlobalConfig();

  const projectRaw = await readJson<unknown>(paths.config(), {});
  const config = parseOrThrow(ConfigSchema, deepMerge(userGlobal, projectRaw as Record<string, unknown>), "config.json");

  const workers = parseOrThrow(
    WorkersConfigSchema,
    (await readJson<unknown>(paths.workers(), null)) ?? defaultWorkersConfig(),
    "workers.json",
  );
  const agents = parseOrThrow(
    AgentsConfigSchema,
    (await readJson<unknown>(paths.agents(), null)) ?? defaultAgentsConfig(),
    "agents.json",
  );

  return { paths, config, workers, agents, initialised };
}

async function loadUserGlobalConfig(): Promise<Record<string, unknown>> {
  const file = path.join(Platform.userPaths().config, "config.json");
  return readJson<Record<string, unknown>>(file, {});
}

export async function loadProfile(paths: RiqsPaths, name: string): Promise<Profile> {
  const raw = await readJson<unknown>(paths.profileFile(name), null);
  if (raw === null) {
    const { RiqsError } = await import("../util/errors");
    throw new RiqsError("CONFIG", `Profile not found: ${name}`, { hint: `Looked in ${paths.profilesDir()}` });
  }
  return parseOrThrow(ProfileSchema, raw, `profile ${name}`);
}

export async function writeConfig(paths: RiqsPaths, config: Config): Promise<void> {
  await writeJson(paths.config(), config);
}
export async function writeWorkers(paths: RiqsPaths, workers: WorkersConfig): Promise<void> {
  await writeJson(paths.workers(), workers);
}
export async function writeAgents(paths: RiqsPaths, agents: AgentsConfig): Promise<void> {
  await writeJson(paths.agents(), agents);
}

export function scaffoldConfigDefaults() {
  return { config: defaultConfig(), workers: defaultWorkersConfig(), agents: defaultAgentsConfig() };
}

function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    const cur = out[k];
    if (isPlainObject(cur) && isPlainObject(v)) out[k] = deepMerge(cur, v);
    else out[k] = v;
  }
  return out;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
