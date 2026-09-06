import { promises as fs } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { RiqsPaths } from "../riqs/paths";
import { writeJson } from "../util/json";
import { scaffoldConfigDefaults } from "../config/loader";
import { ADAPTER_FILES, AGENT_DOC_FILES, WORKFLOW_FILES, renderTemplate } from "../templates/scaffold";
import { log } from "../util/logger";
import { table } from "../ui/render";
import type { GlobalOpts } from "./context";

export interface ScaffoldResult {
  root: string;
  dir: string;
  created: string[];
  skipped: string[];
}

/**
 * The actual `gr-agent init` scaffold, factored out so both the CLI command and the interactive
 * "/setup" composer suggestion (src/cli/run.ts) share one implementation. Never overwrites existing
 * files unless `force` is set.
 */
export async function scaffoldWorkspace(root: string, opts: { force?: boolean } = {}): Promise<ScaffoldResult> {
  const paths = new RiqsPaths(root);
  const created: string[] = [];
  const skipped: string[] = [];

  const write = async (rel: string, content: string) => {
    const abs = path.join(root, rel);
    const exists = await fs.stat(abs).then(() => true).catch(() => false);
    if (exists && !opts.force) {
      skipped.push(rel);
      return;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    created.push(rel);
  };

  const { config, workers, agents } = scaffoldConfigDefaults();
  const writeJsonRel = async (rel: string, value: unknown) => {
    const abs = path.join(root, rel);
    const exists = await fs.stat(abs).then(() => true).catch(() => false);
    if (exists && !opts.force) {
      skipped.push(rel);
      return;
    }
    await writeJson(abs, value);
    created.push(rel);
  };

  const dir = paths.dirName;
  await writeJsonRel(path.relative(root, paths.config()), config);
  await writeJsonRel(path.relative(root, paths.workers()), workers);
  await writeJsonRel(path.relative(root, paths.agents()), agents);

  for (const [rel, content] of Object.entries(AGENT_DOC_FILES)) await write(path.join(dir, rel), renderTemplate(content, dir));
  for (const [rel, content] of Object.entries(WORKFLOW_FILES)) await write(path.join(dir, rel), content);
  for (const [rel, content] of Object.entries(ADAPTER_FILES)) await write(rel, renderTemplate(content, dir));

  for (const d of [paths.assignmentsDir(), paths.resultsDir(), paths.evidenceDir(), paths.checkpointsDir(), paths.locksDir()]) {
    await fs.mkdir(d, { recursive: true });
  }
  await write(path.join(dir, "workflow", ".gitkeep"), "");

  return { root, dir, created, skipped };
}

export function logScaffoldResult(result: ScaffoldResult): void {
  log.success(`gR DEV AGENT initialised in ${result.root} (${result.dir}/)`);
  if (result.created.length) log.info("\n" + table(["created"], result.created.map((c) => [c])));
  if (result.skipped.length) log.info(`\n${result.skipped.length} existing file(s) left untouched (use --force to overwrite).`);
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("scaffold the agent directory (.gr-agent/) and thin tool adapters in the workspace")
    .option("--force", "overwrite existing generated files")
    .action(async (opts: { force?: boolean }) => {
      const g = program.opts<GlobalOpts>();
      const root = path.resolve(g.workspace ?? process.cwd());
      const result = await scaffoldWorkspace(root, opts);
      logScaffoldResult(result);
      log.info("\nNext: `gr-agent doctor`, then `gr-agent run --workflow bug-fix \"<task>\"`.");
    });
}
