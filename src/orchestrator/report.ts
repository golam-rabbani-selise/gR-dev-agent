import type { Task, Plan, AgentResult } from "../riqs/contracts";
import type { RootCauseModel } from "./resultMerger";

export interface ReportInput {
  task: Task;
  plan: Plan;
  results: AgentResult[];
  model: RootCauseModel;
  attribution: { nodeId: string; role: string; workers: string[] }[];
  validation: { build?: string; tests: string; lint?: string; review: string };
  diff?: string;
  unresolved: string[];
  skipped: string[];
}

/** Final report (master plan §35, §160). Always states which worker did each phase and what was skipped. */
export function renderReport(input: ReportInput): string {
  const L: string[] = [];
  const h = (s: string) => L.push(`\n## ${s}\n`);

  L.push(`# gR DEV AGENT report — ${input.task.taskId}`);
  L.push(`\n_${new Date().toISOString()}_`);

  h("Task");
  L.push(input.task.objective);
  if (input.task.acceptanceCriteria.length) {
    L.push("\nAcceptance criteria:");
    for (const c of input.task.acceptanceCriteria) L.push(`- ${c}`);
  }

  h("Root cause");
  if (input.model.confirmed.length) {
    for (const m of input.model.confirmed) L.push(`- **CONFIRMED** (${m.subsystem}, score ${m.score}, ${m.supportingWorkers.join("+")}): ${m.summary}`);
  } else {
    L.push("_No finding reached CONFIRMED. Best current model:_");
    for (const m of [...input.model.supported, ...input.model.suspected].slice(0, 5)) {
      L.push(`- ${m.classification} (${m.subsystem}, score ${m.score}): ${m.summary}`);
    }
  }
  for (const m of input.model.notRootCause) L.push(`- NOT ROOT CAUSE (${m.subsystem}): ${m.summary}`);
  if (input.model.contradictions.length) {
    L.push("\nUnresolved contradictions:");
    for (const c of input.model.contradictions) L.push(`- ${c.subsystem}: ${c.a.worker} says "${c.a.summary}" vs ${c.b.worker} says "${c.b.summary}"`);
  }

  h("Evidence");
  const files = [...new Set(input.results.flatMap((r) => r.filesInspected))].slice(0, 40);
  L.push(files.length ? files.map((f) => `- ${f}`).join("\n") : "_none recorded_");

  h("Changes");
  if (input.model.recommendedChanges.length) {
    for (const c of input.model.recommendedChanges) L.push(`- ${c.file} — ${c.summary} (${c.workers.join(", ")})`);
  } else {
    L.push("_No code changes were made._");
  }
  if (input.diff && input.diff.trim()) {
    L.push("\n```diff");
    L.push(input.diff.slice(0, 12_000));
    L.push("```");
  }

  h("Tests");
  L.push(input.validation.tests);

  h("Review");
  L.push(input.validation.review);

  h("Regression risks");
  L.push(input.model.risks.length ? input.model.risks.map((r) => `- ${r}`).join("\n") : "_none identified_");

  h("Unresolved issues");
  L.push(input.unresolved.length ? input.unresolved.map((u) => `- ${u}`).join("\n") : "_none_");

  h("Workflow used");
  for (const a of input.attribution) L.push(`- ${a.nodeId} (${a.role}) → ${a.workers.join(", ") || "manual handoff"}`);
  if (input.skipped.length) L.push(`\nSkipped: ${input.skipped.join(", ")}`);
  if (input.validation.tests.includes("SKIPPED") || input.validation.review.includes("SKIPPED")) {
    L.push("\n> **VALIDATION SKIPPED** — one or more recommended checks were skipped by user request.");
  }

  h("Suggested commit message");
  L.push("```");
  L.push(suggestedCommit(input));
  L.push("```");

  return L.join("\n") + "\n";
}

function suggestedCommit(input: ReportInput): string {
  const top = input.model.confirmed[0] ?? input.model.supported[0];
  const scope = top?.subsystem && top.subsystem !== "unknown" ? `(${top.subsystem})` : "";
  const subject = `fix${scope}: ${input.task.objective}`.slice(0, 72);
  const body = [
    "",
    top ? `Root cause: ${top.summary}` : "",
    ...input.model.recommendedChanges.map((c) => `- ${c.file}: ${c.summary}`),
  ].filter(Boolean);
  return [subject, ...body].join("\n");
}
