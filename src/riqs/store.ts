import { promises as fs } from "node:fs";
import path from "node:path";
import { RiqsPaths } from "./paths";
import { readJson, writeJson, writeFileAtomic } from "../util/json";
import {
  AgentAssignmentSchema,
  AgentResultSchema,
  PlanSchema,
  TaskSchema,
  EvidenceSchema,
  CheckpointSchema,
  parseOrThrow,
  type AgentAssignment,
  type AgentResult,
  type Plan,
  type Task,
  type Evidence,
  type Checkpoint,
} from "./contracts";

/**
 * The one place that reads and writes `.riqs-agent/workflow/**`. All shared run state is plain files
 * so any tool — or a resumed session from another machine — sees the same thing (master plan §4).
 */
export class RiqsStore {
  readonly paths: RiqsPaths;

  constructor(workspaceRoot: string) {
    this.paths = new RiqsPaths(workspaceRoot);
  }

  async ensureRunDirs(): Promise<void> {
    for (const d of [
      this.paths.workflowDir(),
      this.paths.assignmentsDir(),
      this.paths.resultsDir(),
      this.paths.evidenceDir(),
      this.paths.locksDir(),
      this.paths.checkpointsDir(),
    ]) {
      await fs.mkdir(d, { recursive: true });
    }
  }

  // --- task ---
  async readTask(): Promise<Task | null> {
    const raw = await readJson<unknown>(this.paths.task(), null);
    return raw === null ? null : parseOrThrow(TaskSchema, raw, "task.json");
  }
  async writeTask(task: Task): Promise<void> {
    await writeJson(this.paths.task(), { ...task, updatedAt: new Date().toISOString() });
  }

  // --- plan ---
  async readPlan(): Promise<Plan | null> {
    const raw = await readJson<unknown>(this.paths.plan(), null);
    return raw === null ? null : parseOrThrow(PlanSchema, raw, "plan.json");
  }
  async writePlan(plan: Plan): Promise<void> {
    await writeJson(this.paths.plan(), parseOrThrow(PlanSchema, plan, "plan.json"));
  }

  // --- assignments ---
  async writeAssignment(a: AgentAssignment): Promise<void> {
    await writeJson(this.paths.assignmentJson(a.id), parseOrThrow(AgentAssignmentSchema, a, `assignment ${a.id}`));
  }
  async writeAssignmentBundle(id: string, markdown: string): Promise<void> {
    await writeFileAtomic(this.paths.assignmentMd(id), markdown);
  }
  async readAssignment(id: string): Promise<AgentAssignment | null> {
    const raw = await readJson<unknown>(this.paths.assignmentJson(id), null);
    return raw === null ? null : parseOrThrow(AgentAssignmentSchema, raw, `assignment ${id}`);
  }
  async listAssignments(): Promise<AgentAssignment[]> {
    const dir = this.paths.assignmentsDir();
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const out: AgentAssignment[] = [];
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const raw = await readJson<unknown>(path.join(dir, f), null);
      if (raw) out.push(parseOrThrow(AgentAssignmentSchema, raw, `assignment ${f}`));
    }
    return out;
  }

  // --- results ---
  async writeResult(r: AgentResult): Promise<void> {
    await writeJson(this.paths.resultFile(r.id), parseOrThrow(AgentResultSchema, r, `result ${r.id}`));
  }
  async readResult(id: string): Promise<AgentResult | null> {
    const raw = await readJson<unknown>(this.paths.resultFile(id), null);
    return raw === null ? null : parseOrThrow(AgentResultSchema, raw, `result ${id}`);
  }
  async listResults(): Promise<AgentResult[]> {
    const dir = this.paths.resultsDir();
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const out: AgentResult[] = [];
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const raw = await readJson<unknown>(path.join(dir, f), null);
      if (raw) out.push(parseOrThrow(AgentResultSchema, raw, `result ${f}`));
    }
    return out;
  }

  // --- evidence (master plan §21) ---
  async addEvidence(e: Evidence): Promise<void> {
    await writeJson(this.paths.evidenceFile(e.id), parseOrThrow(EvidenceSchema, e, `evidence ${e.id}`));
  }
  async listEvidence(): Promise<Evidence[]> {
    const dir = this.paths.evidenceDir();
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const out: Evidence[] = [];
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const raw = await readJson<unknown>(path.join(dir, f), null);
      if (raw) out.push(parseOrThrow(EvidenceSchema, raw, `evidence ${f}`));
    }
    return out;
  }

  // --- checkpoints (master plan §29) ---
  async writeCheckpoint(cp: Checkpoint): Promise<void> {
    await writeJson(this.paths.checkpointFile(cp.taskId), parseOrThrow(CheckpointSchema, cp, "checkpoint"));
  }
  async readCheckpoint(taskId: string): Promise<Checkpoint | null> {
    const raw = await readJson<unknown>(this.paths.checkpointFile(taskId), null);
    return raw === null ? null : parseOrThrow(CheckpointSchema, raw, "checkpoint");
  }
  async listCheckpoints(): Promise<Checkpoint[]> {
    const dir = this.paths.checkpointsDir();
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const out: Checkpoint[] = [];
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const raw = await readJson<unknown>(path.join(dir, f), null);
      if (raw) out.push(parseOrThrow(CheckpointSchema, raw, `checkpoint ${f}`));
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  // --- audit log (non-secret metadata only, master plan §86, §121) ---
  async appendAudit(entry: Record<string, unknown>): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    await fs.mkdir(path.dirname(this.paths.auditLog()), { recursive: true });
    await fs.appendFile(this.paths.auditLog(), line, "utf8");
  }

  async writeReport(taskId: string, markdown: string): Promise<string> {
    const file = this.paths.reportFile(taskId);
    await writeFileAtomic(file, markdown);
    return file;
  }
}
