import type { RiqsStore } from "../riqs/store";
import type { Task, Plan, Checkpoint } from "../riqs/contracts";
import type { AssignmentStore } from "./assignmentStore";

export interface CheckpointInput {
  phase: string;
  task: Task;
  plan: Plan | null;
  assignments: AssignmentStore;
  modifiedFiles?: string[];
  worktrees?: { role: string; path: string; branch: string }[];
  testStatus?: Checkpoint["testStatus"];
  reason?: string;
}

/** Persist everything needed to resume from another tool / machine (master plan §29, §373, §375). */
export async function persistCheckpoint(store: RiqsStore, input: CheckpointInput): Promise<Checkpoint> {
  const completedResults = (await store.listResults()).map((r) => r.id);
  const cp: Checkpoint = {
    taskId: input.task.taskId,
    phase: input.phase,
    savedAt: new Date().toISOString(),
    task: input.task,
    plan: input.plan,
    assignmentStates: input.assignments.snapshot(),
    completedResults,
    modifiedFiles: input.modifiedFiles ?? [],
    worktrees: input.worktrees ?? [],
    testStatus: input.testStatus ?? "unknown",
    reason: input.reason,
  };
  await store.writeCheckpoint(cp);
  return cp;
}
