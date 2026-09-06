import { promises as fs } from "node:fs";
import type { AgentWorker, WorkerContext } from "./worker";
import { baseResult } from "./worker";
import { AgentResultSchema, type AgentAssignment, type AgentResult } from "../riqs/contracts";
import { log } from "../util/logger";
import { CancelledError, RiqsError } from "../util/errors";

/**
 * Human-assisted handoff (master plan §13, §152). Emits a self-contained assignment bundle, then
 * waits for a standardized result JSON to appear. This is the universal-compatibility fallback:
 * open the bundle in any tool, paste the result back.
 */
export class ManualWorker implements AgentWorker {
  readonly kind = "manual" as const;
  readonly name: string;

  constructor(name = "manual", private readonly opts: { pollMs?: number; timeoutMs?: number } = {}) {
    this.name = name;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(a: AgentAssignment, ctx: WorkerContext): Promise<AgentResult> {
    const resultPath = ctx.paths.resultFile(a.id);
    await ctx.store.writeAssignmentBundle(a.id, this.bundle(a, ctx));

    log.step(`Manual handoff for "${a.id}" (${a.role}).`);
    log.info(`  Assignment: ${ctx.paths.assignmentMd(a.id)}`);
    log.info(`  Write the result JSON to: ${resultPath}`);

    if (ctx.nonInteractive) {
      const existing = await this.tryRead(resultPath);
      if (existing) return existing;
      throw new RiqsError("WORKER", `Manual assignment ${a.id} has no result and the session is non-interactive`, {
        hint: `Provide ${resultPath} then re-run, or use \`gr-agent result import\`.`,
      });
    }

    const deadline = Date.now() + (this.opts.timeoutMs ?? 30 * 60_000);
    const poll = this.opts.pollMs ?? 2000;
    let mtime = 0;
    for (;;) {
      if (ctx.signal?.aborted) throw new CancelledError();
      const stat = await fs.stat(resultPath).catch(() => null);
      if (stat && stat.mtimeMs !== mtime) {
        mtime = stat.mtimeMs;
        const parsed = await this.tryRead(resultPath);
        if (parsed) {
          log.success(`Received manual result for ${a.id}`);
          return parsed;
        }
        log.warn(`  ${a.id}: result file present but not yet valid — still waiting`);
      }
      if (Date.now() > deadline) {
        const fallback = baseResult(a, this.name);
        fallback.status = "blocked";
        fallback.error = "manual handoff timed out";
        return fallback;
      }
      await new Promise((r) => setTimeout(r, poll));
    }
  }

  private async tryRead(file: string): Promise<AgentResult | null> {
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8"));
      const parsed = AgentResultSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private bundle(a: AgentAssignment, ctx: WorkerContext): string {
    const meta = [
      `- Task: ${a.taskId}`,
      `- Role: ${a.role}`,
      `- Read-only: ${a.readOnly}`,
      `- Allowed paths: ${a.allowedPaths.join(", ")}`,
      ...(a.worktree ? [`- Worktree: ${a.worktree}`] : []),
    ];
    return [
      `# gR DEV AGENT assignment — ${a.id}`,
      "",
      ...meta,
      "",
      "## Prompt",
      "",
      ctx.prompt,
      "",
      "## How to return your result",
      "",
      "Write a JSON object matching the RIQS AgentResult contract to:",
      "",
      "```",
      ctx.paths.resultFile(a.id),
      "```",
      "",
      "Then re-run `gr-agent resume` (or the orchestrator will pick it up automatically).",
      "",
    ].join("\n");
  }
}
