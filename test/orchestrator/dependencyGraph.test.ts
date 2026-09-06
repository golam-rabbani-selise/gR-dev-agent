import { describe, it, expect } from "vitest";
import { DependencyGraph } from "../../src/orchestrator/dependencyGraph";
import { PlanNodeSchema, type PlanNode } from "../../src/riqs/contracts";

const n = (id: string, dependsOn: string[] = []): PlanNode =>
  PlanNodeSchema.parse({ id, role: "investigator", objective: id, dependsOn });

describe("DependencyGraph (master plan §9)", () => {
  it("computes the ready set from completed nodes", () => {
    const g = new DependencyGraph([n("a"), n("b"), n("c", ["a", "b"])]);
    expect(g.ready(new Set(), new Set()).map((x) => x.id).sort()).toEqual(["a", "b"]);
    // a done, b still pending (no deps), c waits on b
    expect(g.ready(new Set(["a"]), new Set(["a"])).map((x) => x.id)).toEqual(["b"]);
    expect(g.ready(new Set(["a", "b"]), new Set(["a", "b"])).map((x) => x.id)).toEqual(["c"]);
  });

  it("detects cycles", () => {
    expect(() => new DependencyGraph([n("a", ["b"]), n("b", ["a"])])).toThrow(/Cycle|cycle/);
  });

  it("rejects a dependency on an unknown node", () => {
    expect(() => new DependencyGraph([n("a", ["ghost"])])).toThrow(/unknown node/);
  });

  it("marks descendants of failed nodes as blocked", () => {
    const g = new DependencyGraph([n("a"), n("b", ["a"])]);
    expect(g.blockedBy(new Set(["a"])).map((x) => x.id)).toEqual(["b"]);
  });
});
