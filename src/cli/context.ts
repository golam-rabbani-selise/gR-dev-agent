import path from "node:path";
import { promises as fs } from "node:fs";
import { Platform } from "../platform/platform";
import { loadConfig, type LoadedConfig } from "../config/loader";
import { RiqsStore } from "../riqs/store";
import { RiqsError } from "../util/errors";

export interface CliContext extends LoadedConfig {
  workspaceRoot: string;
  store: RiqsStore;
  nonInteractive: boolean;
}

export interface GlobalOpts {
  workspace?: string;
  nonInteractive?: boolean;
  color?: boolean;
  json?: boolean;
  debug?: boolean;
  /** Which interactive shell `runInteractive` boots: the original hand-rolled readline/composer
   * ("legacy", the default), or the opt-in Ink-based one ("ink") — see `src/ui/ink/`. */
  tui?: "legacy" | "ink";
}

export async function resolveContext(opts: GlobalOpts, requireInit = true): Promise<CliContext> {
  const workspaceRoot = path.resolve(opts.workspace ?? process.cwd());
  const stat = await fs.stat(workspaceRoot).catch(() => null);
  if (!stat?.isDirectory()) throw new RiqsError("WORKSPACE", `Not a directory: ${workspaceRoot}`);

  await Platform.loadDotEnv(workspaceRoot);
  const loaded = await loadConfig(workspaceRoot);
  if (requireInit && !loaded.initialised) {
    throw new RiqsError("CONFIG", `No agent directory (.gr-agent/ or .riqs-agent/) in ${workspaceRoot}`, {
      hint: "Run `gr-agent init` first.",
    });
  }
  return {
    ...loaded,
    workspaceRoot,
    store: new RiqsStore(workspaceRoot),
    nonInteractive: Boolean(opts.nonInteractive) || Platform.isNonInteractive(),
  };
}
