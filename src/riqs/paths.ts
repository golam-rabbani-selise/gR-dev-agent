import path from "node:path";
import { existsSync } from "node:fs";

/** New canonical agent directory. */
export const AGENT_DIR = ".gr-agent";
/** Legacy directory kept for backward-compatible discovery (master plan §9). */
export const LEGACY_AGENT_DIR = ".riqs-agent";
/** Historical alias — still exported so external callers do not break. */
export const RIQS_DIR = LEGACY_AGENT_DIR;

/**
 * Resolve which agent directory to use for a workspace: prefer `.gr-agent/`, fall back to an
 * existing legacy `.riqs-agent/`, otherwise default to `.gr-agent/` for a fresh init. Never
 * migrates or deletes anything (master plan §9).
 */
export function resolveAgentDirName(workspaceRoot: string): string {
  if (existsSync(path.join(workspaceRoot, AGENT_DIR))) return AGENT_DIR;
  if (existsSync(path.join(workspaceRoot, LEGACY_AGENT_DIR))) return LEGACY_AGENT_DIR;
  return AGENT_DIR;
}

/**
 * Every path under the agent directory is built with `path.join` here (master plan §46). Nothing
 * else in the codebase should concatenate these strings.
 */
export class RiqsPaths {
  readonly root: string;
  readonly dir: string;
  /** the directory name actually in use (".gr-agent" or ".riqs-agent"). */
  readonly dirName: string;

  constructor(workspaceRoot: string, dirName?: string) {
    this.root = workspaceRoot;
    this.dirName = dirName ?? resolveAgentDirName(workspaceRoot);
    this.dir = path.join(workspaceRoot, this.dirName);
  }

  // top-level config
  config = () => path.join(this.dir, "config.json");
  workers = () => path.join(this.dir, "workers.json");
  agents = () => path.join(this.dir, "agents.json");

  // knowledge
  memoryDir = () => path.join(this.dir, "memory");
  memoryFile = (name: string) => path.join(this.dir, "memory", name);
  promptsDir = () => path.join(this.dir, "prompts");
  promptFile = (name: string) => path.join(this.dir, "prompts", `${name}.md`);
  skillsDir = () => path.join(this.dir, "skills");
  skillFile = (name: string) => path.join(this.dir, "skills", `${name}.md`);
  workflowsDir = () => path.join(this.dir, "workflows");
  workflowFile = (name: string) => path.join(this.dir, "workflows", `${name}.yaml`);
  profilesDir = () => path.join(this.dir, "profiles");
  profileFile = (name: string) => path.join(this.dir, "profiles", `${name}.json`);

  // live run state
  workflowDir = () => path.join(this.dir, "workflow");
  task = () => path.join(this.dir, "workflow", "task.json");
  plan = () => path.join(this.dir, "workflow", "plan.json");
  assignmentsDir = () => path.join(this.dir, "workflow", "assignments");
  assignmentJson = (id: string) => path.join(this.dir, "workflow", "assignments", `${id}.json`);
  assignmentMd = (id: string) => path.join(this.dir, "workflow", "assignments", `${id}.md`);
  resultsDir = () => path.join(this.dir, "workflow", "results");
  resultFile = (id: string) => path.join(this.dir, "workflow", "results", `${id}.json`);
  evidenceDir = () => path.join(this.dir, "workflow", "evidence");
  evidenceFile = (id: string) => path.join(this.dir, "workflow", "evidence", `${id}.json`);
  locksDir = () => path.join(this.dir, "workflow", "locks");
  checkpointsDir = () => path.join(this.dir, "workflow", "checkpoints");
  checkpointFile = (taskId: string) => path.join(this.dir, "workflow", "checkpoints", `${taskId}.json`);
  auditLog = () => path.join(this.dir, "workflow", "audit.log.jsonl");
  reportFile = (taskId: string) => path.join(this.dir, "workflow", `report-${taskId}.md`);

  // Human-readable planning/spec documents written by the "/plan" and "/spec" commands — distinct
  // from `plan()` above (the internal task-graph JSON the orchestrator itself reads/writes). These
  // are durable, editable Markdown artifacts meant for the user to read, tweak, and hand to
  // "/implement", so they live in their own top-level folders rather than under "workflow/".
  plansDir = () => path.join(this.dir, "plans");
  planDoc = (slug: string) => path.join(this.dir, "plans", `${slug}.md`);
  specsDir = () => path.join(this.dir, "specs");
  specDoc = (slug: string) => path.join(this.dir, "specs", `${slug}.md`);

  // worktrees live outside .riqs-agent so git can manage them
  worktreesDir = () => path.join(this.root, ".worktrees");
  worktreeDir = (role: string) => path.join(this.root, ".worktrees", role);
}
