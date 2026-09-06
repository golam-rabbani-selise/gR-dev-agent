import { PlanSchema, type Plan, type PlanNode, type Role } from "../riqs/contracts";
import type { Config } from "../config/schema";
import type { RiqsPaths } from "../riqs/paths";
import { loadPreset, normalizePreset } from "../riqs/workflows";
import { resolveNativeProvider } from "../llm/registry";
import { log } from "../util/logger";

export interface PlanInput {
  taskId: string;
  objective: string;
  category: string;
  workflow?: string;
  mode: Plan["mode"];
  skip: string[];
}

/** Build the task DAG (master plan §16). Preset > native classifier > generic default. */
export async function buildPlan(input: PlanInput, ctx: { paths: RiqsPaths; config: Config }): Promise<Plan> {
  if (input.workflow) {
    const preset = await loadPreset(ctx.paths, input.workflow);
    const steps = normalizePreset(preset);
    const nodes = steps
      .filter((s) => !input.skip.includes(s.id) && !input.skip.includes(s.role))
      .map<PlanNode>((s) => ({
        id: s.id,
        role: s.role,
        objective: s.objective ?? `${s.role}: ${input.objective}`,
        dependsOn: s.dependsOn.filter((d) => !input.skip.includes(d)),
        readOnly: s.readOnly,
        allowedPaths: s.allowedPaths,
        skills: s.skills,
        worker: null,
        optional: s.optional,
      }));
    return finalizePlan(input, nodes, preset.mode ?? input.mode, "preset");
  }

  const native = await tryNativePlan(input, ctx.config).catch((e) => {
    log.debug(`native planner unavailable: ${(e as Error).message}`);
    return null;
  });
  if (native) return native;

  return finalizePlan(input, genericNodes(input), input.mode, "manual");
}

function genericNodes(input: PlanInput): PlanNode[] {
  const investigate: PlanNode = {
    id: "investigate",
    role: "investigator",
    objective: `Investigate: ${input.objective}`,
    dependsOn: [],
    readOnly: true,
    allowedPaths: ["**"],
    skills: [],
    worker: null,
    optional: false,
  };
  const nodes: PlanNode[] = [investigate];
  if (!input.skip.includes("coder") && !input.skip.includes("implementation")) {
    nodes.push({
      id: "implement",
      role: "coder",
      objective: `Implement the fix for: ${input.objective}`,
      dependsOn: ["investigate"],
      readOnly: false,
      allowedPaths: ["**"],
      skills: [],
      worker: null,
      optional: false,
    });
  }
  const impl = nodes.find((n) => n.id === "implement") ? ["implement"] : ["investigate"];
  if (!input.skip.includes("tester") && !input.skip.includes("tests")) {
    nodes.push({ id: "test", role: "tester", objective: "Run and extend targeted tests", dependsOn: impl, readOnly: false, allowedPaths: ["**"], skills: [], worker: null, optional: true });
  }
  if (!input.skip.includes("reviewer")) {
    nodes.push({ id: "review", role: "reviewer", objective: "Review the change", dependsOn: impl, readOnly: true, allowedPaths: ["**"], skills: [], worker: null, optional: true });
  }
  return nodes;
}

async function tryNativePlan(input: PlanInput, config: Config): Promise<Plan | null> {
  const { provider } = resolveNativeProvider(config);
  const sys =
    "You are the gR DEV AGENT planner. Output ONLY a JSON object: " +
    '{ "parallelizable": boolean, "nodes": [ { "id": string, "role": <one of ' +
    "planner|investigator|backend|frontend|database|permission|security|performance|coder|tester|reviewer|regression|documentation|git|release|general" +
    '>, "objective": string, "dependsOn": string[], "readOnly": boolean, "allowedPaths": string[] } ] }. ' +
    "Independent investigations must have dependsOn: []. Writers depend on all investigations. Keep it to 3-6 nodes.";
  const res = await provider.chat(
    [
      { role: "system", content: sys },
      { role: "user", content: `Task: ${input.objective}\nCategory: ${input.category}\nSkipped phases: ${input.skip.join(", ") || "none"}` },
    ],
    { json: true, maxOutputTokens: 1500 },
  );
  const parsed = safeJson(res.text);
  if (!parsed || !Array.isArray((parsed as any).nodes)) return null;
  const nodes: PlanNode[] = ((parsed as any).nodes as any[])
    .map((n) => ({
      id: String(n.id),
      role: (n.role as Role) ?? "investigator",
      objective: String(n.objective ?? input.objective),
      dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn.map(String) : [],
      readOnly: n.readOnly !== false,
      allowedPaths: Array.isArray(n.allowedPaths) && n.allowedPaths.length ? n.allowedPaths.map(String) : ["**"],
      skills: [],
      worker: null,
      optional: false,
    }))
    .filter((n) => !input.skip.includes(n.id) && !input.skip.includes(n.role));
  if (nodes.length === 0) return null;
  return finalizePlan(input, nodes, input.mode, "native-planner");
}

function finalizePlan(input: PlanInput, nodes: PlanNode[], mode: Plan["mode"], source: Plan["source"]): Plan {
  // drop dangling deps left by skipped nodes
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) n.dependsOn = n.dependsOn.filter((d) => ids.has(d));
  return PlanSchema.parse({
    taskId: input.taskId,
    parallelizable: nodes.filter((n) => n.dependsOn.length === 0).length > 1,
    mode,
    nodes,
    createdAt: new Date().toISOString(),
    source,
  });
}

function safeJson(text: string): unknown | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1));
  } catch {
    return null;
  }
}
