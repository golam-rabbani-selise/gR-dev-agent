import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { Orchestrator } from "../orchestrator/orchestrator";
import { log } from "../util/logger";
import { RiqsError } from "../util/errors";

export function registerResume(program: Command): void {
  program
    .command("resume [taskId]")
    .description("resume a task from its last checkpoint (master plan §29, §375)")
    .option("-y, --yes", "skip confirmation")
    .action(async (taskId: string | undefined, _opts: { yes?: boolean }) => {
      const g = program.opts<GlobalOpts>();
      const ctx = await resolveContext(g);

      const checkpoints = await ctx.store.listCheckpoints();
      const target = taskId
        ? checkpoints.find((c) => c.taskId === taskId)
        : checkpoints.find((c) => c.task.state !== "COMPLETED") ?? checkpoints[0];
      if (!target) throw new RiqsError("CONFIG", taskId ? `No checkpoint for ${taskId}` : "No checkpoints to resume");

      log.step(`Resuming ${target.taskId} (phase: ${target.phase}, state: ${target.task.state})`);

      const controller = new AbortController();
      process.once("SIGINT", () => controller.abort());
      const orch = new Orchestrator({
        workspaceRoot: ctx.workspaceRoot,
        config: ctx.config,
        workers: ctx.workers,
        agents: ctx.agents,
        nonInteractive: ctx.nonInteractive,
        signal: controller.signal,
      });
      const { task, reportPath } = await orch.run({
        objective: target.task.objective,
        category: target.task.category,
        workflow: target.task.workflow,
        skip: target.task.skipped,
        acceptanceCriteria: target.task.acceptanceCriteria,
        resumeTaskId: target.taskId,
      });
      log.success(`Task ${task.taskId}: ${task.state}`);
      log.info(`Report: ${reportPath}`);
    });
}
