import type { AgentAssignment } from "../riqs/contracts";

export interface EnvelopeContext {
  memory?: string;
  skills?: string;
  evidence?: string;
  workspaceRoot: string;
}

/**
 * The standard worker prompt envelope (master plan §14). Every worker — native, external CLI or a
 * human copy/paste handoff — receives the same core instructions and the same required output path.
 */
export function buildPromptEnvelope(a: AgentAssignment, ctx: EnvelopeContext): string {
  const lines: string[] = [];
  lines.push("You are a worker in gR DEV AGENT.");
  lines.push("");
  lines.push(`Role:\n${a.role}`);
  lines.push("");
  lines.push(`Task ID:\n${a.taskId}`);
  lines.push("");
  lines.push(`Assignment ID:\n${a.id}`);
  lines.push("");
  lines.push(`Objective:\n${a.objective}`);
  lines.push("");
  lines.push("Rules:");
  lines.push("- Read .riqs-agent/memory/project.md first (provided below if present).");
  lines.push("- Read the relevant skill files (provided below if any).");
  lines.push(
    a.readOnly
      ? "- This assignment is READ-ONLY. Do not modify any file."
      : `- You may modify files only within: ${a.allowedPaths.join(", ")}`,
  );
  lines.push("- Do not perform unrelated refactoring.");
  lines.push("- Inspect actual code before making claims.");
  lines.push("- Clearly separate facts, hypotheses and recommendations.");
  lines.push("- Include file paths and line references whenever possible.");
  lines.push("- Return findings in the required structured JSON format.");
  lines.push("");
  lines.push(`Allowed paths: ${a.allowedPaths.join(", ")}`);
  if (a.dependencies.length) lines.push(`Upstream assignments already completed: ${a.dependencies.join(", ")}`);
  lines.push("");
  if (ctx.memory) lines.push(`--- shared memory ---\n${ctx.memory}\n`);
  if (ctx.skills) lines.push(`--- skills ---\n${ctx.skills}\n`);
  if (ctx.evidence) lines.push(`--- shared evidence ---\n${ctx.evidence}\n`);
  lines.push(`Write your structured result to:\n${a.outputFile}`);
  return lines.join("\n");
}

/** The JSON result contract, described for the model. */
export function resultContractHint(): string {
  return [
    "Your final answer MUST be a single JSON object with this shape:",
    "{",
    '  "status": "completed" | "failed" | "blocked" | "partial",',
    '  "findings": [{ "kind": "fact"|"hypothesis"|"recommendation", "subsystem": string,',
    '                "summary": string, "detail": string, "files": string[], "confidence": 0..1 }],',
    '  "filesInspected": string[],',
    '  "rootCauseHypotheses": string[],',
    '  "recommendedChanges": [{ "file": string, "summary": string, "rationale": string }],',
    '  "risks": string[],',
    '  "confidence": 0..1',
    "}",
  ].join("\n");
}
