import { promises as fs } from "node:fs";
import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { AgentResultSchema } from "../riqs/contracts";
import { mergeResults } from "../orchestrator/resultMerger";
import { table } from "../ui/render";
import { log } from "../util/logger";
import { RiqsError } from "../util/errors";

export function registerResults(program: Command): void {
  const cmd = program.command("results").description("view and import structured worker results");

  cmd
    .command("list", { isDefault: true })
    .action(async () => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const list = await ctx.store.listResults();
      if (!list.length) {
        log.info("No results yet.");
        return;
      }
      log.info(
        table(
          ["id", "role", "worker", "status", "confidence", "findings"],
          list.map((r) => [r.id, r.role, r.worker, r.status, String(r.confidence), String(r.findings.length)]),
        ),
      );
    });

  cmd
    .command("merge")
    .description("show the merged root-cause model")
    .action(async () => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const model = mergeResults(await ctx.store.listResults());
      log.info(JSON.stringify(model, null, 2));
    });

  cmd
    .command("import <file>")
    .description("import a worker result JSON (manual handoff, master plan §152)")
    .option("--id <id>", "assignment id to file it under")
    .action(async (file: string, opts: { id?: string }) => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const raw = JSON.parse(await fs.readFile(file, "utf8"));
      const parsed = AgentResultSchema.safeParse(raw);
      if (!parsed.success) throw new RiqsError("CONTRACT", `Invalid result: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      const result = { ...parsed.data, id: opts.id ?? parsed.data.id };
      await ctx.store.writeResult(result);
      log.success(`imported result ${result.id}`);
    });
}
