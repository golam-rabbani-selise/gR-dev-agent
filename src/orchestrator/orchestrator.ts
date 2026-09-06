import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Config, WorkersConfig, AgentsConfig, WorkflowMode } from "../config/schema";
import type { Role, Task, TaskState, Plan, PlanNode, AgentAssignment, AgentResult } from "../riqs/contracts";
import { TaskSchema } from "../riqs/contracts";
import { RiqsStore } from "../riqs/store";
import { RiqsPaths } from "../riqs/paths";
import { WorkspaceGuard } from "../tools/workspaceGuard";
import { Git } from "../tools/git";
import { LockManager } from "../riqs/locks";
import { loadMemoryText } from "../riqs/memory";
import { skillText } from "../riqs/skills";
import { buildPromptEnvelope } from "../llm/promptEnvelope";
import { buildWorkerRegistry, type WorkerRegistry, type WorkerEntry } from "../workers/registry";
import type { WorkerContext } from "../workers/worker";
import { DependencyGraph } from "./dependencyGraph";
import { Scheduler } from "./scheduler";
import { AssignmentStore } from "./assignmentStore";
import { Router } from "./router";
import { buildPlan } from "./planner";
import { mergeResults, type RootCauseModel } from "./resultMerger";
import { detectFileConflicts, needsTieBreak, tieBreakNode } from "./conflictDetector";
import { persistCheckpoint } from "./checkpoint";
import { renderReport } from "./report";
import { log } from "../util/logger";
import { roleVerb } from "../util/roleVerb";
import { CancelledError } from "../util/errors";

export interface OrchestratorRunInput {
  objective: string;
  category?: string;
  workflow?: string;
  mode?: WorkflowMode;
  parallelism?: number;
  skip?: string[];
  taskRouting?: Partial<Record<Role, string | string[]>>;
  disabledWorkers?: string[];
  acceptanceCriteria?: string[];
  nativeProviderOverride?: string;
  resumeTaskId?: string;
  isolateWrites?: boolean;
}

export interface OrchestratorDeps {
  workspaceRoot: string;
  config: Config;
  workers: WorkersConfig;
  agents: AgentsConfig;
  nonInteractive: boolean;
  signal?: AbortSignal;
}

interface Attribution {
  nodeId: string;
  role: string;
  workers: string[];
}

export class Orchestrator {
  private readonly store: RiqsStore;
  private readonly paths: RiqsPaths;
  private readonly locks: LockManager;
  private guard!: WorkspaceGuard;
  private registry!: WorkerRegistry;
  private router!: Router;
  private assignments!: AssignmentStore;
  private git: Git | null = null;
  private attribution: Attribution[] = [];
  private worktrees: { role: string; path: string; branch: string }[] = [];

  constructor(private readonly deps: OrchestratorDeps) {
    this.paths = new RiqsPaths(deps.workspaceRoot);
    this.store = new RiqsStore(deps.workspaceRoot);
    this.locks = new LockManager(this.paths);
  }

  async run(input: OrchestratorRunInput): Promise<{ task: Task; reportPath: string; model: RootCauseModel }> {
    await this.store.ensureRunDirs();
    this.guard = await WorkspaceGuard.create(this.deps.workspaceRoot);
    this.git = await Git.open(this.deps.workspaceRoot);

    const mode: WorkflowMode = input.mode ?? this.deps.config.mode;
    const parallelism = mode === "sequential" || mode === "single-worker" || mode === "manual" ? 1 : input.parallelism ?? this.deps.config.parallelism;
    const skip = [...new Set([...(this.deps.config.skip ?? []), ...(input.skip ?? [])])];

    // --- task ---
    let task = input.resumeTaskId ? await this.store.readTask() : null;
    const resumeCp = input.resumeTaskId ? await this.store.readCheckpoint(input.resumeTaskId) : null;
    if (!task || task.taskId !== input.resumeTaskId) {
      task = TaskSchema.parse({
        taskId: input.resumeTaskId ?? shortId(),
        objective: input.objective,
        category: input.category ?? "general",
        workflow: input.workflow,
        state: "CREATED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        skipped: skip,
        acceptanceCriteria: input.acceptanceCriteria ?? [],
      });
    }
    await this.store.writeTask({ ...task, state: "PLANNING" });

    // --- plan ---
    let plan: Plan =
      resumeCp?.plan ??
      (await this.store.readPlan().then((p) => (p && p.taskId === task!.taskId ? p : null))) ??
      (await buildPlan(
        { taskId: task.taskId, objective: task.objective, category: task.category, workflow: input.workflow, mode, skip },
        { paths: this.paths, config: this.deps.config },
      ));
    await this.store.writePlan(plan);
    log.step(`Plan (${plan.source}): ${plan.nodes.map((n) => `${n.id}[${n.role}]`).join(" → ")}`);

    // --- workers + routing ---
    this.registry = await buildWorkerRegistry({
      config: this.deps.config,
      workers: this.deps.workers,
      agents: this.deps.agents,
      nativeProviderOverride: input.nativeProviderOverride,
    });
    this.router = new Router(this.deps.config, this.registry);
    logWorkerTable(this.registry);

    // --- assignment state + resume ---
    this.assignments = new AssignmentStore(this.store);
    let persistChain: Promise<unknown> = Promise.resolve();
    this.assignments.bindPersist(async () => {
      persistChain = persistChain
        .catch(() => {})
        .then(() =>
          persistCheckpoint(this.store, {
            phase: "running",
            task: task!,
            plan,
            assignments: this.assignments,
            worktrees: this.worktrees,
          }),
        );
      await persistChain;
    });
    if (resumeCp) {
      this.assignments.hydrate(resumeCp.assignmentStates);
      this.worktrees = resumeCp.worktrees;
      log.info(`Resuming ${task.taskId} from phase "${resumeCp.phase}"`);
    }

    await this.store.writeTask({ ...task, state: "RUNNING" });
    await this.executeGraph(plan, task, parallelism, mode, input, skip);

    // --- merge ---
    await this.store.writeTask({ ...task, state: "MERGING" });
    let results = await this.store.listResults();
    let model = mergeResults(results);

    // --- tie-break (§20) ---
    if (needsTieBreak(model) && !plan.nodes.some((n) => n.id === "tie-break")) {
      log.warn("Contradictory findings — running a tie-break assignment");
      const tb = tieBreakNode(model, plan.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.id));
      plan = { ...plan, nodes: [...plan.nodes, tb] };
      await this.store.writePlan(plan);
      await this.runSingleNode(tb, task, mode, input);
      results = await this.store.listResults();
      model = mergeResults(results);
    }

    // --- final report ---
    const finalState: TaskState = this.assignments.failed().size > 0 ? "FAILED" : "COMPLETED";
    const finalTask: Task = { ...task, state: finalState };
    await this.store.writeTask(finalTask);
    const reportPath = await this.finalReport(finalTask, plan, results, model, skip);
    await persistCheckpoint(this.store, { phase: "completed", task: finalTask, plan, assignments: this.assignments, worktrees: this.worktrees, reason: finalState });

    if (this.deps.signal?.aborted) throw new CancelledError();
    return { task: finalTask, reportPath, model };
  }

  private async executeGraph(plan: Plan, task: Task, parallelism: number, mode: WorkflowMode, input: OrchestratorRunInput, skip: string[]): Promise<void> {
    const graph = new DependencyGraph(plan.nodes);
    const fileConflicts = detectFileConflicts(plan.nodes);
    const mutex: [string, string][] = fileConflicts.map((c) => [c.a, c.b]);
    if (mutex.length) log.warn(`Serialising writer pairs with overlapping paths: ${mutex.map((m) => m.join("↔")).join(", ")}`);

    const scheduler = new Scheduler(graph, this.assignments);
    await scheduler.run(
      async (node) => {
        if (skip.includes(node.id) || skip.includes(node.role)) {
          log.info(`skip ${node.id} (${node.role})`);
          return "COMPLETED";
        }
        return this.runNode(node, task, mode, input);
      },
      { parallelism, mutex, signal: this.deps.signal },
    );
  }

  private async runSingleNode(node: PlanNode, task: Task, mode: WorkflowMode, input: OrchestratorRunInput): Promise<void> {
    await this.assignments.set(node.id, "RUNNING");
    const outcome = await this.runNode(node, task, mode, input).catch((e) => {
      if (e instanceof CancelledError) throw e;
      log.error(`${node.id}: ${(e as Error).message}`);
      return "FAILED" as const;
    });
    await this.assignments.set(node.id, outcome);
  }

  private async runNode(node: PlanNode, task: Task, mode: WorkflowMode, input: OrchestratorRunInput): Promise<"COMPLETED" | "FAILED"> {
    const manualEntry: WorkerEntry = {
      id: "manual",
      worker: this.registry.manual,
      roles: [] as Role[],
      enabled: true,
      ready: true,
      present: true,
      backing: "manual",
    };

    let decision = this.router.route({
      node,
      taskCategory: task.category,
      taskRouting: input.taskRouting,
      disabledWorkers: input.disabledWorkers,
    });

    // Mode overrides routing (master plan §131): every node goes to one place.
    if (mode === "manual") {
      decision = { nodeId: node.id, role: node.role, workers: [manualEntry], reason: "manual mode" };
    } else if (mode === "single-worker") {
      const id =
        (typeof input.taskRouting?.[node.role] === "string" ? (input.taskRouting[node.role] as string) : undefined) ??
        this.deps.config.primaryWorker ??
        "native";
      const e = this.registry.get(id);
      if (!e || !e.enabled || !(e.ready || e.present)) {
        log.error(`${node.id}: single-worker "${id}" is not available`);
        return "FAILED";
      }
      decision = { nodeId: node.id, role: node.role, workers: [e], reason: `single-worker (${id})` };
    }

    if (decision.strictUnavailable) {
      log.error(`${node.id}: strict routing — required worker(s) unavailable: ${decision.strictUnavailable}`);
      return "FAILED";
    }
    const chosen = decision.workers.length ? decision.workers : [manualEntry];
    this.attribution.push({ nodeId: node.id, role: node.role, workers: chosen.map((c) => c.id) });
    // Plain-language phase banner for everyone; the routing mechanics (which worker, why) are one
    // --debug flag away instead of in front of every user by default.
    log.step(`${roleVerb(node.role)}…`);
    log.debug(`${node.id} (${node.role}) → ${chosen.map((c) => c.id).join(" + ")}  [${decision.reason}]`);

    const isWriter = !node.readOnly && node.role !== "reviewer";
    const worktree = isWriter && (input.isolateWrites ?? true) ? await this.ensureWorktree(node) : undefined;

    const memory = await loadMemoryText(this.paths).catch(() => "");
    const skills = await skillText(this.paths, node.skills).catch(() => "");
    const evidence = (await this.store.listEvidence())
      .slice(0, 20)
      .map((e) => `- [${e.id}] ${e.file}${e.lines ? ":" + e.lines : ""} — ${e.claim} (${e.sourceAgent})`)
      .join("\n");

    const outcomes: ("COMPLETED" | "FAILED")[] = [];
    for (const entry of chosen) {
      const ensembleSuffix = chosen.length > 1 ? `__${entry.id}` : "";
      const assignment: AgentAssignment = {
        taskId: task.taskId,
        id: node.id + ensembleSuffix,
        role: node.role,
        objective: node.objective,
        workspace: ".",
        allowedPaths: node.allowedPaths,
        readOnly: node.readOnly,
        dependencies: node.dependsOn,
        outputFile: this.paths.resultFile(node.id + ensembleSuffix),
        skills: node.skills,
        context: {},
        worktree,
      };
      await this.store.writeAssignment(assignment);
      const prompt = buildPromptEnvelope(assignment, { memory, skills, evidence, workspaceRoot: this.deps.workspaceRoot });

      const guard = worktree ? await WorkspaceGuard.create(worktree) : this.guard;
      const ctx: WorkerContext = {
        workspaceRoot: this.deps.workspaceRoot,
        guard,
        store: this.store,
        paths: this.paths,
        cwd: worktree ?? this.deps.workspaceRoot,
        signal: this.deps.signal,
        nonInteractive: this.deps.nonInteractive || mode === "manual",
        prompt,
        model: entry.model,
      };

      const lockKey = isWriter ? `writer:${node.allowedPaths.join("|")}` : `read:${node.id}`;
      const result = await this.locks.withLock(lockKey, `${node.id}:${entry.id}`, () => entry.worker.execute(assignment, ctx));
      await this.store.writeResult(result);
      await this.recordEvidence(result);
      outcomes.push(result.status === "failed" ? "FAILED" : "COMPLETED");
      log.success(`${assignment.id}: ${result.status} (confidence ${result.confidence})`);
    }
    return outcomes.every((o) => o === "COMPLETED") ? "COMPLETED" : outcomes.includes("COMPLETED") ? "COMPLETED" : "FAILED";
  }

  private async ensureWorktree(node: PlanNode): Promise<string | undefined> {
    if (!this.git) {
      log.warn(`${node.id}: git unavailable — writer will operate on the main working tree`);
      return undefined;
    }
    const existing = this.worktrees.find((w) => w.role === node.id);
    if (existing) return existing.path;
    const dir = this.paths.worktreeDir(node.id);
    const branch = `riqs/${node.id}-${shortId()}`;
    try {
      await fs.mkdir(this.paths.worktreesDir(), { recursive: true });
      await this.git.worktreeAdd(dir, branch);
      this.worktrees.push({ role: node.id, path: dir, branch });
      log.info(`  worktree: ${path.relative(this.deps.workspaceRoot, dir)} (${branch})`);
      return dir;
    } catch (e) {
      log.warn(`${node.id}: could not create worktree (${(e as Error).message}) — using main tree`);
      return undefined;
    }
  }

  private async recordEvidence(result: AgentResult): Promise<void> {
    for (const f of result.findings.slice(0, 10)) {
      if (f.kind !== "fact" || f.files.length === 0) continue;
      await this.store.addEvidence({
        id: `EV-${shortId()}`,
        file: f.files[0]!,
        claim: f.summary,
        sourceAgent: result.worker,
        createdAt: new Date().toISOString(),
      });
    }
  }

  private async finalReport(task: Task, plan: Plan, results: AgentResult[], model: RootCauseModel, skip: string[]): Promise<string> {
    let diff = "";
    if (this.git) diff = await this.git.diff().catch(() => "");
    const testsRun = results.some((r) => r.role === "tester");
    const reviewRun = results.some((r) => r.role === "reviewer");
    const report = renderReport({
      task,
      plan,
      results,
      model,
      attribution: this.attribution,
      validation: {
        tests: skip.includes("tester") || skip.includes("tests") ? "SKIPPED by user" : testsRun ? "tester assignment completed" : "no tester assignment in plan",
        review: skip.includes("reviewer") ? "SKIPPED by user" : reviewRun ? "reviewer assignment completed" : "no reviewer assignment in plan",
      },
      diff,
      unresolved: model.contradictions.map((c) => `${c.subsystem}: unresolved disagreement`),
      skipped: skip,
    });
    const file = await this.store.writeReport(task.taskId, report);
    log.success(`Report: ${path.relative(this.deps.workspaceRoot, file)}`);
    return file;
  }
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}

function logWorkerTable(registry: WorkerRegistry): void {
  for (const e of registry.list()) {
    const flag = !e.enabled ? "disabled" : e.ready ? "ready" : "not ready";
    log.info(`  worker ${e.id.padEnd(14)} ${flag.padEnd(10)} ${e.backing}`);
  }
}
