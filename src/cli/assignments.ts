import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { table } from "../ui/render";
import { log } from "../util/logger";

export function registerAssignments(program: Command): void {
  const cmd = program.command("assignments").description("list assignments for the active task");
  cmd
    .command("list", { isDefault: true })
    .action(async () => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const list = await ctx.store.listAssignments();
      const cp = (await ctx.store.readTask())?.taskId ? await ctx.store.readCheckpoint((await ctx.store.readTask())!.taskId) : null;
      if (list.length === 0) {
        log.info("No assignments. Run a workflow first.");
        return;
      }
      log.info(
        table(
          ["id", "role", "state", "readOnly", "deps", "output"],
          list.map((a) => [
            a.id,
            a.role,
            cp?.assignmentStates[a.id] ?? "PENDING",
            String(a.readOnly),
            a.dependencies.join(",") || "-",
            a.outputFile.replace(ctx.workspaceRoot + "/", ""),
          ]),
        ),
      );
    });

  cmd
    .command("show <id>")
    .action(async (id: string) => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const a = await ctx.store.readAssignment(id);
      if (!a) {
        log.error(`No assignment ${id}`);
        return;
      }
      log.info(JSON.stringify(a, null, 2));
    });
}
