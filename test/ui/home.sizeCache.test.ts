import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocked BEFORE importing home.ts so termWidth()/termHeight()'s stty/tput calls hit this stub
// instead of actually shelling out.
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "40 100"), // "rows cols", as `stty size` reports it
}));

import { execFileSync } from "node:child_process";
import { renderHome, invalidateSizeCache, type HomeModel } from "../../src/ui/home";

const model: HomeModel = {
  version: "0.1.0",
  workspaceRoot: "/tmp/riqs",
  workspaceName: "riqs",
  branch: "develop",
  repositories: 1,
  mode: "auto",
  agent: "claude-sonnet",
  provider: "anthropic",
  ready: true,
  initialised: true,
  hasRepo: true,
  stack: "unknown",
};

describe("termWidth()/termHeight() short-TTL cache", () => {
  beforeEach(() => {
    invalidateSizeCache();
    vi.mocked(execFileSync).mockClear();
    delete process.env.GR_AGENT_WIDTH;
    delete process.env.GR_AGENT_HEIGHT;
    delete process.env.COLUMNS;
    delete process.env.LINES;
  });

  afterEach(() => {
    invalidateSizeCache();
  });

  it("reuses a cached size across rapid re-renders instead of re-shelling-out every time", () => {
    // A spinner-driven redraw calls renderHome() ~10x/second; without the cache each of these
    // would independently spawn `stty size` / `tput cols` / `tput lines` subprocesses.
    renderHome(model);
    renderHome(model);
    renderHome(model);
    const callsAfterThreeRenders = vi.mocked(execFileSync).mock.calls.length;
    expect(callsAfterThreeRenders).toBeGreaterThan(0); // it did shell out at least once...
    renderHome(model);
    // ...but not again for a render immediately after, since the cache is still warm.
    expect(vi.mocked(execFileSync).mock.calls.length).toBe(callsAfterThreeRenders);
  });

  it("re-measures immediately after invalidateSizeCache(), as a real resize handler triggers", () => {
    renderHome(model);
    const callsBeforeResize = vi.mocked(execFileSync).mock.calls.length;
    expect(callsBeforeResize).toBeGreaterThan(0);
    invalidateSizeCache();
    renderHome(model);
    expect(vi.mocked(execFileSync).mock.calls.length).toBeGreaterThan(callsBeforeResize);
  });
});
