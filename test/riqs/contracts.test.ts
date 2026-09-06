import { describe, it, expect } from "vitest";
import { AgentResultSchema, PlanSchema, parseOrThrow } from "../../src/riqs/contracts";

describe("contracts", () => {
  it("applies defaults on a minimal AgentResult", () => {
    const r = AgentResultSchema.parse({ taskId: "t", id: "a", role: "backend", worker: "native", status: "completed" });
    expect(r.findings).toEqual([]);
    expect(r.confidence).toBe(0.5);
  });

  it("rejects an out-of-range confidence", () => {
    expect(() =>
      parseOrThrow(AgentResultSchema, { taskId: "t", id: "a", role: "backend", worker: "native", status: "completed", confidence: 2 }, "result"),
    ).toThrow(/Invalid result/);
  });

  it("parses a plan DAG", () => {
    const p = parseOrThrow(
      PlanSchema,
      {
        taskId: "t",
        nodes: [{ id: "a", role: "investigator", objective: "x" }],
        createdAt: new Date().toISOString(),
      },
      "plan",
    );
    expect(p.nodes[0]!.readOnly).toBe(true);
  });
});
