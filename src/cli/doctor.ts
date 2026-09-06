import path from "node:path";
import { promises as fs } from "node:fs";
import type { Command } from "commander";
import { Platform } from "../platform/platform";
import { resolveAgentDirName } from "../riqs/paths";
import { detectAll } from "../integrations/detector";
import { table, heading } from "../ui/render";
import { log } from "../util/logger";
import type { GlobalOpts } from "./context";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("check platform, tools and worker readiness (never prints secrets)")
    .action(async () => {
      const g = program.opts<GlobalOpts>();
      const root = path.resolve(g.workspace ?? process.cwd());

      log.info(heading("gR DEV AGENT Doctor"));
      log.info("");
      log.info(`Platform      ${Platform.platform} ${process.arch}`);
      log.info(`Node          ${process.version}`);

      const tools = ["git", "npm", "node", "dotnet", "rg", "pwsh"];
      const toolRows: string[][] = [];
      for (const t of tools) {
        const found = await Platform.findExecutable(t);
        let version = "";
        if (found) {
          const res = await Platform.run(found, ["--version"], { timeoutMs: 8000 }).catch(() => null);
          version = res ? (res.stdout || res.stderr).split(/\r?\n/)[0]!.trim() : "";
        }
        toolRows.push([t, found ? "found" : "-", version]);
      }
      log.info("\n" + table(["tool", "status", "version"], toolRows));

      const git = await Platform.findExecutable("git");
      if (!git) log.warn("git not found — worktree isolation and diff features are disabled.");

      log.info("\n" + heading("AI workers"));
      const statuses = await detectAll();
      const rows = statuses.map((s) => [
        s.displayName,
        s.installed ? "installed" : "missing",
        s.installed ? s.auth : "-",
        s.readiness.toUpperCase(),
        s.version ?? "",
      ]);
      log.info(table(["worker", "install", "auth", "readiness", "version"], rows));

      log.info("\n" + heading("Workspace"));
      const dirName = resolveAgentDirName(root);
      const agentDir = path.join(root, dirName);
      const initialised = await fs.stat(agentDir).then((s) => s.isDirectory()).catch(() => false);
      log.info(`Path          ${root}`);
      log.info(`Agent dir     ${initialised ? `${dirName}/ (present)` : "missing (run `gr-agent init`)"}`);

      const ollamaUrl = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
      const ollamaUp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) })
        .then((r) => r.ok)
        .catch(() => false);
      const provider =
        process.env.ANTHROPIC_API_KEY ? "anthropic (ANTHROPIC_API_KEY)" :
        process.env.OPENAI_API_KEY ? "openai (OPENAI_API_KEY)" :
        process.env.OPENROUTER_API_KEY ? "openrouter (OPENROUTER_API_KEY)" :
        ollamaUp ? `ollama (${ollamaUrl})` : "none — set a provider key or run Ollama";
      log.info(`Native LLM    ${provider}`);

      const ready = statuses.filter((s) => s.readiness === "ready").length;
      const nativeOk = provider.startsWith("none") ? "needs a provider" : "available";
      log.info(`\n${ready} external worker(s) auto-routable. Native worker ${nativeOk}. Installed CLIs can still be routed to explicitly.`);
    });
}
