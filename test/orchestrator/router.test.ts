import { describe, it, expect } from "vitest";
import { Router } from "../../src/orchestrator/router";
import { ConfigSchema } from "../../src/config/schema";
import { PlanNodeSchema } from "../../src/riqs/contracts";
import type { WorkerRegistry, WorkerEntry } from "../../src/workers/registry";

function registry(entries: Partial<WorkerEntry>[]): WorkerRegistry {
  const map = new Map<string, WorkerEntry>();
  for (const e of entries) {
    const ready = e.ready ?? true;
    const full: WorkerEntry = { id: e.id!, worker: {} as any, roles: e.roles ?? [], enabled: e.enabled ?? true, ready, present: e.present ?? ready, backing: "x", model: e.model };
    map.set(full.id, full);
  }
  return {
    entries: map,
    manual: {} as any,
    list: () => [...map.values()],
    ready: () => [...map.values()].filter((e) => e.enabled && e.ready),
    get: (id) => map.get(id),
    forRole: (role) => [...map.values()].filter((e) => e.enabled && e.ready && e.roles.includes(role)),
  };
}

const node = (role: any, worker: any = null) => PlanNodeSchema.parse({ id: "x", role, objective: "o", worker });

describe("Router (master plan §144-§154)", () => {
  it("honours an explicit per-task route over the global map", () => {
    const cfg = ConfigSchema.parse({ routing: { permission: "native" } });
    const r = new Router(cfg, registry([{ id: "native", roles: ["permission"] }, { id: "claude", roles: ["permission"] }]));
    const d = r.route({ node: node("permission"), taskCategory: "general", taskRouting: { permission: "claude" } });
    expect(d.workers.map((w) => w.id)).toEqual(["claude"]);
    expect(d.reason).toMatch(/per-task/);
  });

  it("strict policy does not substitute an unavailable worker", () => {
    const cfg = ConfigSchema.parse({ routingPolicy: "strict", routing: { backend: "codex" } });
    const r = new Router(cfg, registry([{ id: "codex", roles: ["backend"], ready: false }, { id: "native", roles: ["backend"] }]));
    const d = r.route({ node: node("backend"), taskCategory: "general" });
    expect(d.strictUnavailable).toBe("codex");
    expect(d.workers).toHaveLength(0);
  });

  it("fallback policy lands on native as the single-tool fallback", () => {
    const cfg = ConfigSchema.parse({ routingPolicy: "fallback" });
    const r = new Router(cfg, registry([{ id: "native", roles: ["general"] }]));
    const d = r.route({ node: node("frontend"), taskCategory: "general" });
    expect(d.workers.map((w) => w.id)).toEqual(["native"]);
  });

  it("supports an ensemble route (master plan §143)", () => {
    const cfg = ConfigSchema.parse({ routing: { permission: ["native", "claude"] } });
    const r = new Router(cfg, registry([{ id: "native", roles: ["permission"] }, { id: "claude", roles: ["permission"] }]));
    const d = r.route({ node: node("permission"), taskCategory: "general" });
    expect(d.workers.map((w) => w.id).sort()).toEqual(["claude", "native"]);
  });
});
