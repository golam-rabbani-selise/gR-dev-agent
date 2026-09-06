import type { AgentAssignment, AgentResult } from "../riqs/contracts";
import type { WorkspaceGuard } from "../tools/workspaceGuard";
import type { RiqsStore } from "../riqs/store";
import type { RiqsPaths } from "../riqs/paths";

export interface WorkerContext {
  workspaceRoot: string;
  guard: WorkspaceGuard;
  store: RiqsStore;
  paths: RiqsPaths;
  /** worktree to operate in for isolated writers (master plan §7); defaults to workspaceRoot. */
  cwd: string;
  signal?: AbortSignal;
  nonInteractive: boolean;
  /** rendered §14 prompt envelope for this assignment. */
  prompt: string;
  /** optional model id for agent-level routing (master plan §168). */
  model?: string;
}

/**
 * The generic worker abstraction (master plan §11). Native, external-CLI and human-assisted workers
 * all satisfy this. No worker relies on hidden conversation state — the assignment file is the input,
 * the result file is the output.
 */
export interface AgentWorker {
  readonly name: string;
  readonly kind: "native" | "cli" | "manual";
  isAvailable(): Promise<boolean>;
  execute(assignment: AgentAssignment, ctx: WorkerContext): Promise<AgentResult>;
}

export function baseResult(a: AgentAssignment, worker: string): AgentResult {
  return {
    taskId: a.taskId,
    id: a.id,
    role: a.role,
    worker,
    status: "partial",
    findings: [],
    filesInspected: [],
    rootCauseHypotheses: [],
    recommendedChanges: [],
    risks: [],
    confidence: 0.3,
    startedAt: new Date().toISOString(),
  };
}
