import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Scheduler } from "../../src/orchestrator/scheduler";
import { DependencyGraph } from "../../src/orchestrator/dependencyGraph";
import { AssignmentStore } from "../../src/orchestrator/assignmentStore";
import { RiqsStore } from "../../src/riqs/store";
import { PlanNodeSchema, type PlanNode } from "../../src/riqs/contracts";

const n = (id: string, dependsOn: string[] = [], readOnly = true): PlanNode =>
  PlanNodeSchema.parse({ id, role: "investigator", objective: id, dependsOn, readOnly });

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "riqs-sched-"));
  const store = new RiqsStore(root);
  await store.ensureRunDirs();
  return { root, store };
}

describe("Scheduler (master plan §7, §8, §33)", () => {
  it("runs independent nodes concurrently and waits for dependencies", async () => {
    const { root, store } = await makeStore();
    const graph = new DependencyGraph([n("a"), n("b"), n("c", ["a", "b"])]);
    const as = new AssignmentStore(store);
    const started: string[] = [];
    let peak = 0;
    let live = 0;
    await new Scheduler(graph, as).run(
      async (node) => {
        started.push(node.id);
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live--;
        return "COMPLETED";
      },
      { parallelism: 4, mutex: [] },
    );
    expect(peak).toBe(2); // a,b together; c after
    expect(started.at(-1)).toBe("c");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("serialises a mutex pair", async () => {
    const { root, store } = await makeStore();
    const graph = new DependencyGraph([n("w1", [], false), n("w2", [], false)]);
    const as = new AssignmentStore(store);
    let live = 0;
    let peak = 0;
    await new Scheduler(graph, as).run(
      async () => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live--;
        return "COMPLETED";
      },
      { parallelism: 4, mutex: [["w1", "w2"]] },
    );
    expect(peak).toBe(1);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("blocks descendants of a failed node", async () => {
    const { root, store } = await makeStore();
    const graph = new DependencyGraph([n("a"), n("b", ["a"])]);
    const as = new AssignmentStore(store);
    await new Scheduler(graph, as).run(async (node) => (node.id === "a" ? "FAILED" : "COMPLETED"), { parallelism: 2, mutex: [] });
    expect(as.get("b")).toBe("BLOCKED");
    await fs.rm(root, { recursive: true, force: true });
  });
});
