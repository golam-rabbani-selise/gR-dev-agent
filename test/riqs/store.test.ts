import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RiqsStore } from "../../src/riqs/store";
import { TaskSchema, PlanSchema, AgentResultSchema } from "../../src/riqs/contracts";

let root: string;
let store: RiqsStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "riqs-store-"));
  store = new RiqsStore(root);
  await store.ensureRunDirs();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("RiqsStore round-trips (master plan §4)", () => {
  it("task, plan, result and checkpoint survive a write/read cycle", async () => {
    const task = TaskSchema.parse({ taskId: "T1", objective: "do a thing", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await store.writeTask(task);
    expect((await store.readTask())?.taskId).toBe("T1");

    const plan = PlanSchema.parse({ taskId: "T1", nodes: [{ id: "a", role: "investigator", objective: "x" }], createdAt: new Date().toISOString() });
    await store.writePlan(plan);
    expect((await store.readPlan())?.nodes[0]!.id).toBe("a");

    const result = AgentResultSchema.parse({ taskId: "T1", id: "a", role: "investigator", worker: "native", status: "completed", confidence: 0.7 });
    await store.writeResult(result);
    expect((await store.listResults())).toHaveLength(1);

    await store.writeCheckpoint({
      taskId: "T1",
      phase: "running",
      savedAt: new Date().toISOString(),
      task,
      plan,
      assignmentStates: { a: "COMPLETED" },
      completedResults: ["a"],
      modifiedFiles: [],
      worktrees: [],
      testStatus: "unknown",
    });
    const cp = await store.readCheckpoint("T1");
    expect(cp?.assignmentStates.a).toBe("COMPLETED");
  });

  it("appends non-secret audit lines as JSONL", async () => {
    await store.appendAudit({ kind: "test", ok: true });
    const raw = await fs.readFile(store.paths.auditLog(), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(raw.trim()).kind).toBe("test");
  });
});
