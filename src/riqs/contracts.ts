import { z } from "zod";
import { RiqsError } from "../util/errors";

/** Reusable worker roles (master plan §128). */
export const RoleSchema = z.enum([
  "planner",
  "investigator",
  "backend",
  "frontend",
  "database",
  "permission",
  "security",
  "performance",
  "coder",
  "tester",
  "reviewer",
  "regression",
  "documentation",
  "git",
  "release",
  "general",
]);
export type Role = z.infer<typeof RoleSchema>;

/** Task lifecycle (master plan §8). */
export const TaskStateSchema = z.enum([
  "CREATED",
  "PLANNING",
  "ASSIGNED",
  "RUNNING",
  "WAITING",
  "MERGING",
  "IMPLEMENTING",
  "TESTING",
  "REVIEWING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const AssignmentStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
]);
export type AssignmentState = z.infer<typeof AssignmentStateSchema>;

/** Assignment handed to a worker (master plan §4 input, §14). */
export const AgentAssignmentSchema = z.object({
  taskId: z.string().min(1),
  id: z.string().min(1),
  role: RoleSchema,
  objective: z.string().min(1),
  workspace: z.string().default("."),
  allowedPaths: z.array(z.string()).default(["**"]),
  readOnly: z.boolean().default(true),
  dependencies: z.array(z.string()).default([]),
  outputFile: z.string().min(1),
  skills: z.array(z.string()).default([]),
  context: z.record(z.string(), z.unknown()).default({}),
  /** worktree path when this is an isolated writer (master plan §7). */
  worktree: z.string().optional(),
});
export type AgentAssignment = z.infer<typeof AgentAssignmentSchema>;

export const FindingKindSchema = z.enum(["fact", "hypothesis", "recommendation"]);

export const FindingSchema = z.object({
  kind: FindingKindSchema.default("fact"),
  subsystem: z.string().default("unknown"),
  summary: z.string().min(1),
  detail: z.string().default(""),
  files: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type Finding = z.infer<typeof FindingSchema>;

export const RecommendedChangeSchema = z.object({
  file: z.string(),
  summary: z.string(),
  rationale: z.string().default(""),
});

/** Worker output (master plan §4 output). Validated on read — a malformed result fails loudly. */
export const AgentResultSchema = z.object({
  taskId: z.string().min(1),
  id: z.string().min(1),
  role: RoleSchema,
  worker: z.string().min(1),
  status: z.enum(["completed", "failed", "blocked", "partial"]),
  findings: z.array(FindingSchema).default([]),
  filesInspected: z.array(z.string()).default([]),
  rootCauseHypotheses: z.array(z.string()).default([]),
  recommendedChanges: z.array(RecommendedChangeSchema).default([]),
  risks: z.array(z.string()).default([]),
  diff: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

/** Shared evidence store record (master plan §21). */
export const EvidenceSchema = z.object({
  id: z.string().min(1),
  file: z.string(),
  lines: z.string().optional(),
  claim: z.string().min(1),
  sourceAgent: z.string().min(1),
  createdAt: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** One node of the task DAG (master plan §9, §16). */
export const PlanNodeSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  objective: z.string().min(1),
  dependsOn: z.array(z.string()).default([]),
  readOnly: z.boolean().default(true),
  allowedPaths: z.array(z.string()).default(["**"]),
  skills: z.array(z.string()).default([]),
  /** explicit worker/agent id; null => let the router decide. */
  worker: z.union([z.string(), z.array(z.string())]).nullable().default(null),
  optional: z.boolean().default(false),
});
export type PlanNode = z.infer<typeof PlanNodeSchema>;

export const PlanSchema = z.object({
  taskId: z.string().min(1),
  parallelizable: z.boolean().default(true),
  mode: z.enum(["auto", "parallel", "sequential", "single-worker", "manual"]).default("auto"),
  nodes: z.array(PlanNodeSchema).min(1),
  createdAt: z.string(),
  source: z.enum(["preset", "native-planner", "manual"]).default("preset"),
});
export type Plan = z.infer<typeof PlanSchema>;

export const TaskSchema = z.object({
  taskId: z.string().min(1),
  objective: z.string().min(1),
  category: z.string().default("general"),
  workflow: z.string().optional(),
  state: TaskStateSchema.default("CREATED"),
  createdAt: z.string(),
  updatedAt: z.string(),
  skipped: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
});
export type Task = z.infer<typeof TaskSchema>;

/** Persisted checkpoint (master plan §29, §373). */
export const CheckpointSchema = z.object({
  taskId: z.string().min(1),
  phase: z.string(),
  savedAt: z.string(),
  task: TaskSchema,
  plan: PlanSchema.nullable(),
  assignmentStates: z.record(z.string(), AssignmentStateSchema).default({}),
  completedResults: z.array(z.string()).default([]),
  modifiedFiles: z.array(z.string()).default([]),
  worktrees: z.array(z.object({ role: z.string(), path: z.string(), branch: z.string() })).default([]),
  testStatus: z.enum(["unknown", "passed", "failed", "skipped"]).default("unknown"),
  reason: z.string().optional(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown, label: string): z.infer<S> {
  const res = schema.safeParse(value);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new RiqsError("CONTRACT", `Invalid ${label}: ${issues}`);
  }
  return res.data;
}
