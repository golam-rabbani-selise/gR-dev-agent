import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { Git } from "../tools/git";
import { table } from "../ui/render";
import { log } from "../util/logger";
import { confirm } from "../ui/prompt";

export function registerCheckpoints(program: Command): void {
  const cmd = program.command("checkpoints").description("list persisted checkpoints (master plan §29)");
  cmd
    .command("list", { isDefault: true })
    .action(async () => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const list = await ctx.store.listCheckpoints();
      if (!list.length) {
        log.info("No checkpoints.");
        return;
      }
      log.info(
        table(
          ["taskId", "phase", "savedAt", "state", "results", "worktrees"],
          list.map((c) => [c.taskId, c.phase, c.savedAt, c.task.state, String(c.completedResults.length), String(c.worktrees.length)]),
        ),
      );
    });

  program
    .command("cleanup")
    .description("remove RIQS worktrees (refuses those with unmerged work, master plan §31)")
    .option("--force", "remove even worktrees with uncommitted/unmerged changes")
    .option("-y, --yes", "skip the per-worktree confirmation")
    .action(async (opts: { force?: boolean; yes?: boolean }) => {
      const g = program.opts<GlobalOpts>();
      const ctx = await resolveContext(g);
      const git = await Git.open(ctx.workspaceRoot);
      if (!git) {
        log.error("git unavailable");
        return;
      }
      const worktrees = (await git.worktreeList()).filter((w) => w.branch.startsWith("riqs/"));
      if (!worktrees.length) {
        log.info("No RIQS worktrees.");
        return;
      }
      for (const w of worktrees) {
        const sub = await Git.open(w.path);
        const dirty = sub ? !(await sub.isClean()) : false;
        if (dirty && !opts.force) {
          log.warn(`skip ${w.path} — has uncommitted changes (use --force)`);
          continue;
        }
        if (!opts.yes && !(await confirm(`Remove worktree ${w.path} (${w.branch})?`, false))) {
          log.warn(`skip ${w.path} — not confirmed (pass -y to confirm non-interactively)`);
          continue;
        }
        await git.worktreeRemove(w.path, opts.force);
        log.success(`removed ${w.path}`);
      }
    });
}
