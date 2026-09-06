import { describe, it, expect } from "vitest";
import { mergeResults } from "../../src/orchestrator/resultMerger";
import { AgentResultSchema, type AgentResult } from "../../src/riqs/contracts";

const result = (worker: string, findings: any[], extra: Partial<AgentResult> = {}): AgentResult =>
  AgentResultSchema.parse({ taskId: "t", id: worker, role: "permission", worker, status: "completed", findings, ...extra });

describe("mergeResults (master plan §19, §20)", () => {
  it("promotes an agreed finding to CONFIRMED", () => {
    const model = mergeResults([
      result("native", [{ subsystem: "backend", summary: "missing artifact read filter", confidence: 0.9, files: ["A.cs"] }]),
      result("codex", [{ subsystem: "backend", summary: "missing artifact read filter", confidence: 0.85, files: ["A.cs"] }]),
    ]);
    expect(model.confirmed).toHaveLength(1);
    expect(model.confirmed[0]!.supportingWorkers.sort()).toEqual(["codex", "native"]);
  });

  it("surfaces a contradiction between workers", () => {
    const model = mergeResults([
      result("a", [{ subsystem: "frontend", summary: "frontend bypasses the server check", confidence: 0.7 }]),
      result("b", [{ subsystem: "frontend", summary: "frontend does not bypass anything; it only renders server data", confidence: 0.8 }]),
    ]);
    expect(model.contradictions.length).toBeGreaterThan(0);
  });

  it("classifies a negated claim as NOT ROOT CAUSE", () => {
    const model = mergeResults([
      result("a", [{ subsystem: "frontend", summary: "no independent bypass found in the UI", confidence: 0.8 }]),
    ]);
    expect(model.notRootCause).toHaveLength(1);
  });
});
