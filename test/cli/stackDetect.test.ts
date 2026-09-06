import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectWorkspaceState } from "../../src/cli/stackDetect";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "riqs-stack-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeFile(rel: string, content = ""): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

describe("detectWorkspaceState (master plan repo-awareness, §244)", () => {
  it("reports no repo for an empty / freshly-scaffolded workspace", async () => {
    await writeFile(".gr-agent/config.json", "{}");
    const state = await detectWorkspaceState(root);
    expect(state.hasRepo).toBe(false);
    expect(state.stack).toBe("unknown");
  });

  it("detects a repo cloned directly into the workspace root", async () => {
    await fs.mkdir(path.join(root, ".git"));
    const state = await detectWorkspaceState(root);
    expect(state.hasRepo).toBe(true);
    expect(state.repoRoot).toBe(root);
  });

  it("detects a repo cloned into a sub-folder (the /clone flow)", async () => {
    await writeFile(".gr-agent/config.json", "{}");
    const sub = path.join(root, "my-service");
    await fs.mkdir(path.join(sub, ".git"), { recursive: true });
    const state = await detectWorkspaceState(root);
    expect(state.hasRepo).toBe(true);
    expect(state.repoRoot).toBe(sub);
  });

  it("never treats .gr-agent/, .git-less node_modules, or worktrees as the repo", async () => {
    await writeFile(".gr-agent/config.json", "{}");
    await writeFile("node_modules/.gitkeep");
    await fs.mkdir(path.join(root, ".worktrees"), { recursive: true });
    const state = await detectWorkspaceState(root);
    expect(state.hasRepo).toBe(false);
  });

  it("guesses backend from a .csproj / .sln file", async () => {
    await fs.mkdir(path.join(root, ".git"));
    await writeFile("Api.csproj", "<Project />");
    expect((await detectWorkspaceState(root)).stack).toBe("backend");
  });

  it("guesses backend from go.mod / requirements.txt / pom.xml", async () => {
    await fs.mkdir(path.join(root, ".git"));
    await writeFile("go.mod", "module example.com/x");
    expect((await detectWorkspaceState(root)).stack).toBe("backend");
  });

  it("guesses frontend from angular.json / vite.config.ts / index.html", async () => {
    await fs.mkdir(path.join(root, ".git"));
    await writeFile("angular.json", "{}");
    expect((await detectWorkspaceState(root)).stack).toBe("frontend");
  });

  it("guesses frontend from package.json dependencies (react/vue/angular)", async () => {
    await fs.mkdir(path.join(root, ".git"));
    await writeFile("package.json", JSON.stringify({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }));
    expect((await detectWorkspaceState(root)).stack).toBe("frontend");
  });

  it("guesses backend from package.json dependencies (express/fastify/nestjs)", async () => {
    await fs.mkdir(path.join(root, ".git"));
    await writeFile("package.json", JSON.stringify({ dependencies: { fastify: "^4.0.0" } }));
    expect((await detectWorkspaceState(root)).stack).toBe("backend");
  });

  it("falls back to unknown for a repo with no recognisable markers", async () => {
    await fs.mkdir(path.join(root, ".git"));
    await writeFile("README.md", "# just docs");
    expect((await detectWorkspaceState(root)).stack).toBe("unknown");
  });

  it("tolerates a malformed package.json instead of throwing", async () => {
    await fs.mkdir(path.join(root, ".git"));
    await writeFile("package.json", "{ not json");
    const state = await detectWorkspaceState(root);
    expect(state.hasRepo).toBe(true);
    expect(state.stack).toBe("unknown");
  });
});
