import { promises as fs } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { RiqsPaths } from "./paths";
import { RoleSchema, parseOrThrow } from "./contracts";
import { RiqsError } from "../util/errors";

/**
 * Workflow presets (master plan §25). A preset is a named DAG template: `parallel` steps have no
 * dependencies between them; every `after` step depends on all preceding stages.
 */
const StepSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  objective: z.string().optional(),
  readOnly: z.boolean().optional(),
  optional: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  allowedPaths: z.array(z.string()).optional(),
});
const StepInput = z.union([z.string(), StepSchema]);

export const WorkflowPresetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  mode: z.enum(["auto", "parallel", "sequential", "single-worker", "manual"]).optional(),
  parallel: z.array(StepInput).default([]),
  after: z.array(StepInput).default([]),
});
export type WorkflowPreset = z.infer<typeof WorkflowPresetSchema>;

export interface NormalizedStep {
  id: string;
  role: z.infer<typeof RoleSchema>;
  objective?: string;
  readOnly: boolean;
  optional: boolean;
  skills: string[];
  allowedPaths: string[];
  dependsOn: string[];
}

const ROLE_GUESS: Record<string, z.infer<typeof RoleSchema>> = {
  "api-authorization": "permission",
  "artifact-permissions": "permission",
  "dynamic-role-resolution": "permission",
  "frontend-visibility": "frontend",
  "root-cause-merge": "investigator",
  implementation: "coder",
  "targeted-tests": "tester",
  "security-review": "security",
};

function normalizeStep(raw: z.infer<typeof StepInput>, deps: string[]): NormalizedStep {
  if (typeof raw === "string") {
    return {
      id: raw,
      role: ROLE_GUESS[raw] ?? "investigator",
      readOnly: true,
      optional: false,
      skills: [],
      allowedPaths: ["**"],
      dependsOn: deps,
    };
  }
  return {
    id: raw.id,
    role: raw.role,
    objective: raw.objective,
    readOnly: raw.readOnly ?? true,
    optional: raw.optional ?? false,
    skills: raw.skills ?? [],
    allowedPaths: raw.allowedPaths ?? ["**"],
    dependsOn: deps,
  };
}

export function normalizePreset(preset: WorkflowPreset): NormalizedStep[] {
  const parallel = preset.parallel.map((s) => normalizeStep(s, []));
  const parallelIds = parallel.map((s) => s.id);
  const after: NormalizedStep[] = [];
  const WRITER_ROLES = new Set(["coder", "release", "tester"]);
  let priorIds = [...parallelIds];
  for (const raw of preset.after) {
    const step = normalizeStep(raw, [...priorIds]);
    // writer roles in the `after` chain default to writable unless the preset says otherwise
    const explicitReadOnly = typeof raw === "object" && raw.readOnly !== undefined;
    if (WRITER_ROLES.has(step.role) && !explicitReadOnly) step.readOnly = false;
    after.push(step);
    priorIds = [step.id];
  }
  return [...parallel, ...after];
}

export async function loadPreset(paths: RiqsPaths, name: string): Promise<WorkflowPreset> {
  const file = paths.workflowFile(name);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    throw new RiqsError("CONFIG", `Workflow preset not found: ${name}`, { hint: `Looked in ${paths.workflowsDir()}` });
  }
  return parseOrThrow(WorkflowPresetSchema, parseYaml(raw), `workflow ${name}`);
}

export async function listPresets(paths: RiqsPaths): Promise<string[]> {
  const files = await fs.readdir(paths.workflowsDir()).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).map((f) => f.replace(/\.ya?ml$/, "")).sort();
}
