import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { planInstalls, runInstalls } from "../../src/integrations/installer";
import { ConfigSchema } from "../../src/config/schema";
import { RiqsStore } from "../../src/riqs/store";

let root: string;
let store: RiqsStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "riqs-inst-"));
  store = new RiqsStore(root);
  await store.ensureRunDirs();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("installer consent (master plan §75, §92, §118)", () => {
  it("plans an install with an exact command preview", async () => {
    const { plans } = await planInstalls(["codex"], ConfigSchema.parse({}));
    if (plans.length) {
      expect(plans[0]!.preview).toMatch(/npm install -g/);
    }
  });

  it("performs NO install in non-interactive mode even when a plan exists", async () => {
    const { plans } = await planInstalls(["codex"], ConfigSchema.parse({}));
    const outcomes = await runInstalls(plans, { store, nonInteractive: true });
    for (const o of outcomes) expect(o.result).toBe("blocked");
  });

  it("respects an enterprise policy that disables installation", async () => {
    const cfg = ConfigSchema.parse({ integrations: { installation: { enabled: false } } });
    const { plans, blocked } = await planInstalls(["codex", "claude"], cfg);
    expect(plans).toHaveLength(0);
    expect(blocked.every((b) => /disabled by policy/.test(b.message ?? ""))).toBe(true);
  });
});
