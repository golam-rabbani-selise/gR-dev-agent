import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentWorker, WorkerContext } from "./worker";
import { baseResult } from "./worker";
import { AgentResultSchema, type AgentAssignment, type AgentResult } from "../riqs/contracts";
import { Platform } from "../platform/platform";
import { log } from "../util/logger";
import { withSpinner } from "../util/spinner";
import { roleVerb } from "../util/roleVerb";
import { CancelledError } from "../util/errors";
import { ManualWorker } from "./manualWorker";

export interface CliWorkerSpec {
  /** worker id, e.g. "claude". */
  id: string;
  /** executable name candidates, resolved via Platform.findExecutable (master plan §77). */
  executables: string[];
  /** how the prompt is handed to the CLI. */
  promptDelivery: "stdin" | "file" | "arg";
  /**
   * argv template. Placeholders: {prompt} {promptFile} {objective} {model} {cwd} {resultFile}.
   * Sourced from integrations.manifest.json so it can be corrected without code changes.
   */
  argv: string[];
  /** when true, pass the assignment worktree/workspace as cwd. */
  useWorktreeCwd?: boolean;
  /** the CLI is expected to itself write the structured result file. */
  writesResultFile?: boolean;
}

/**
 * Base adapter for an external coding-agent CLI acting as a worker (master plan §11, §12). If the
 * CLI is missing, the spawn fails, or its output cannot be turned into a valid result, we degrade
 * cleanly to the human-assisted handoff instead of guessing.
 */
export class CliWorker implements AgentWorker {
  readonly kind = "cli" as const;
  readonly name: string;

  constructor(private readonly spec: CliWorkerSpec) {
    this.name = spec.id;
  }

  async isAvailable(): Promise<boolean> {
    for (const exe of this.spec.executables) {
      if (await Platform.isCommandAvailable(exe)) return true;
    }
    return false;
  }

  private async resolveExe(): Promise<string | null> {
    for (const exe of this.spec.executables) {
      const found = await Platform.findExecutable(exe);
      if (found) return found;
    }
    return null;
  }

  async execute(a: AgentAssignment, ctx: WorkerContext): Promise<AgentResult> {
    const exe = await this.resolveExe();
    if (!exe) {
      log.warn(`${this.name} CLI not found — falling back to manual handoff for ${a.id}`);
      return new ManualWorker(this.name).execute(a, ctx);
    }
    if (ctx.signal?.aborted) throw new CancelledError();

    const result = baseResult(a, this.name);
    const promptFile = path.join(ctx.paths.workflowDir(), `prompt-${a.id}.txt`);
    await fs.mkdir(path.dirname(promptFile), { recursive: true });
    await fs.writeFile(promptFile, ctx.prompt, "utf8");

    const subs: Record<string, string> = {
      "{prompt}": ctx.prompt,
      "{promptFile}": promptFile,
      "{objective}": a.objective,
      "{model}": this.modelArg(ctx),
      "{cwd}": this.spec.useWorktreeCwd ? ctx.cwd : ctx.workspaceRoot,
      "{resultFile}": ctx.paths.resultFile(a.id),
    };
    const argv = this.spec.argv.map((t) => (subs[t] !== undefined ? subs[t]! : t)).filter((x) => x !== "");

    // The full prompt (often several KB — memory files, skills, rules) is already persisted to
    // promptFile; the raw CLI invocation is genuinely only useful for debugging, so it's --debug
    // only — everyone else just sees the spinner's plain-language phase name below.
    const summaryArgv = this.spec.argv.map((t) =>
      t === "{prompt}" ? `<prompt: ${ctx.prompt.length} chars, saved to ${path.basename(promptFile)}>` : subs[t] !== undefined ? subs[t]! : t,
    );
    log.debug(`${this.name}: ${path.basename(exe)} ${summaryArgv.join(" ")}`);
    log.debug(`${this.name} full argv: ${path.basename(exe)} ${argv.join(" ")}`);
    // This can genuinely take anywhere from seconds to several minutes with no output of its own in
    // the meantime — without a spinner the terminal just sits with a bare blinking cursor,
    // indistinguishable from having hung.
    const run = await withSpinner(`${roleVerb(a.role)}… (${this.name})`, () =>
      Platform.run(exe, argv, {
        cwd: this.spec.useWorktreeCwd ? ctx.cwd : ctx.workspaceRoot,
        input: this.spec.promptDelivery === "stdin" ? ctx.prompt : undefined,
        timeoutMs: 15 * 60_000,
        signal: ctx.signal,
      }),
    );

    // 1) preferred: the CLI wrote the structured result file itself
    if (this.spec.writesResultFile) {
      const fromFile = await readResult(ctx.paths.resultFile(a.id));
      if (fromFile) return normalize(a, fromFile, this.name);
    }
    // 2) structured JSON on stdout
    const fromStdout = extractResult(run.stdout);
    if (fromStdout) return normalize(a, fromStdout, this.name);

    // 3) unstructured output — capture as a single finding, mark partial for the merger
    if (run.exitCode === 0 && run.stdout.trim()) {
      result.status = "partial";
      result.findings.push({
        kind: "fact",
        subsystem: "external-worker-output",
        summary: `${this.name} produced unstructured output`,
        detail: run.stdout.slice(0, 4000),
        files: [],
        evidenceIds: [],
        confidence: 0.4,
      });
      result.finishedAt = new Date().toISOString();
      return result;
    }

    // 4) failed — hand to a human
    log.warn(`${this.name} exited ${run.exitCode}; falling back to manual handoff for ${a.id}`);
    return new ManualWorker(this.name).execute(a, ctx);
  }

  private modelArg(ctx: WorkerContext): string {
    return ctx.model && ctx.model !== "default" ? ctx.model : "";
  }
}

async function readResult(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function extractResult(stdout: string): unknown | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(stdout);
  const body = fence ? fence[1]! : stdout;
  const s = body.indexOf("{");
  const e = body.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(body.slice(s, e + 1));
  } catch {
    return null;
  }
}

function normalize(a: AgentAssignment, raw: unknown, worker: string): AgentResult {
  const base = baseResult(a, worker);
  const merged = { ...base, ...(typeof raw === "object" && raw ? raw : {}), taskId: a.taskId, id: a.id, role: a.role, worker, finishedAt: new Date().toISOString() };
  const parsed = AgentResultSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  base.status = "partial";
  base.error = `external worker returned a malformed result: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
  base.finishedAt = new Date().toISOString();
  return base;
}
