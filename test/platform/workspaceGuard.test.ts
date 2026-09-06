import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceGuard } from "../../src/tools/workspaceGuard";

let root: string;
let outside: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "riqs-ws-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "riqs-out-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "a.ts"), "x", "utf8");
  await fs.writeFile(path.join(outside, "secret.txt"), "s", "utf8");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("WorkspaceGuard (master plan §46, §63)", () => {
  it("resolves paths inside the workspace", async () => {
    const g = await WorkspaceGuard.create(root);
    await expect(g.resolveInside("src/a.ts")).resolves.toContain(path.join("src", "a.ts"));
  });

  it("rejects ../ escapes", async () => {
    const g = await WorkspaceGuard.create(root);
    await expect(g.resolveInside("../escape.txt")).rejects.toThrow(/escapes the workspace/);
  });

  it("rejects a symlink that points outside the workspace", async () => {
    const g = await WorkspaceGuard.create(root);
    const link = path.join(root, "src", "leak");
    try {
      await fs.symlink(outside, link, "dir");
    } catch {
      return; // platform without symlink permission — skip
    }
    await expect(g.resolveInside("src/leak/secret.txt")).rejects.toThrow(/escapes the workspace/);
  });
});
