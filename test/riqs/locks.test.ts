import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LockManager } from "../../src/riqs/locks";
import { RiqsPaths } from "../../src/riqs/paths";

let root: string;
let locks: LockManager;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "riqs-lock-"));
  const paths = new RiqsPaths(root);
  await fs.mkdir(paths.locksDir(), { recursive: true });
  locks = new LockManager(paths);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("LockManager (master plan §6, §33)", () => {
  it("serialises two holders of the same key (no interleaving)", async () => {
    const order: string[] = [];
    const hold = (id: string) =>
      locks.withLock("k", id, async () => {
        order.push(`${id}-start`);
        await new Promise((r) => setTimeout(r, 40));
        order.push(`${id}-end`);
      });
    await Promise.all([hold("A"), hold("B")]);
    // whichever ran first, each holder's start/end are adjacent
    expect(order.indexOf("A-end")).toBe(order.indexOf("A-start") + 1);
    expect(order.indexOf("B-end")).toBe(order.indexOf("B-start") + 1);
  });

  it("allows different keys concurrently", async () => {
    let concurrent = 0;
    let max = 0;
    const run = (k: string) =>
      locks.withLock(k, k, async () => {
        concurrent++;
        max = Math.max(max, concurrent);
        await new Promise((r) => setTimeout(r, 30));
        concurrent--;
      });
    await Promise.all([run("x"), run("y")]);
    expect(max).toBe(2);
  });
});
