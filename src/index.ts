import { Command } from "commander";
import pc from "picocolors";
import { Platform } from "./platform/platform";
import { configureLogger, log, isColor } from "./util/logger";
import { isRiqsError, exitCodeFor } from "./util/errors";
import { registerDoctor } from "./cli/doctor";
import { registerInit } from "./cli/init";
import { registerRun } from "./cli/run";
import { registerWorkers } from "./cli/workers";
import { registerAgents } from "./cli/agents";
import { registerAssignments } from "./cli/assignments";
import { registerResults } from "./cli/results";
import { registerCheckpoints } from "./cli/checkpoints";
import { registerResume } from "./cli/resume";
import { registerIntegrations } from "./cli/integrations";
import { registerAuth } from "./cli/auth";
import { registerWorkflowCmd } from "./cli/workflowCmd";
import { registerSetup } from "./cli/setup";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("gr-agent")
    .description("gR DEV AGENT — AI engineering, orchestrated (vendor-neutral parallel multi-agent orchestrator)")
    .version(VERSION, "-v, --version")
    .option("--no-color", "disable ANSI colour")
    .option("--non-interactive", "never prompt; fail closed on decisions that need input")
    .option("--workspace <path>", "target repository (default: current directory)", process.cwd())
    .option("--json", "machine-readable log output")
    .option("--debug", "verbose logging")
    .option("--tui <kind>", "interactive shell: ink (default) or legacy", "ink")
    .hook("preAction", (thisCommand) => {
      const o = thisCommand.opts();
      configureLogger({
        color: o.color !== false && isColor(),
        json: Boolean(o.json),
        level: o.debug ? "debug" : "info",
      });
    });

  registerInit(program);
  registerSetup(program);
  registerDoctor(program);
  registerRun(program);
  registerWorkflowCmd(program);
  registerWorkers(program);
  registerAgents(program);
  registerAssignments(program);
  registerResults(program);
  registerCheckpoints(program);
  registerResume(program);
  registerIntegrations(program);
  registerAuth(program);

  // `gr-agent` / `gr-agent .`  -> hero home screen, then an interactive session
  program
    .argument("[target]", "shorthand: `.` opens an interactive session on the workspace")
    .action(async (target: string | undefined) => {
      if (target === "." || target === undefined) {
        const { runInteractive } = await import("./cli/run");
        await runInteractive(program.opts());
        return;
      }
      program.help();
    });

  await program.parseAsync(process.argv);
}

process.on("SIGINT", () => {
  log.warn("Interrupted — persisting state and terminating child processes…");
  Platform.killAllChildren();
  process.exitCode = 130;
  setTimeout(() => process.exit(130), 500).unref();
});

main().catch((err) => {
  if (isRiqsError(err)) {
    log.error(err.message);
    if (err.hint) log.info(pc.dim(err.hint));
    process.exit(exitCodeFor(err.code));
  }
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
