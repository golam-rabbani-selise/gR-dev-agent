import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  nextInCycle,
  WORKER_CYCLE,
  MODEL_LISTERS,
  CLAUDE_MODEL_ALIASES,
  recentHistory,
  historyTranscript,
  cycleWorkerSelection,
  shouldRemountInkSession,
} from "../../src/cli/run";
import type { GlobalOpts } from "../../src/cli/context";
import type { ChatTurn, HomeModel } from "../../src/ui/home";

describe("nextInCycle (Tab-switches the active worker)", () => {
  it("steps to the next worker in the fixed cycle", () => {
    expect(nextInCycle("native")).toBe("claude");
    expect(nextInCycle("claude")).toBe("codex");
    expect(nextInCycle("codex")).toBe("cursor");
    expect(nextInCycle("cursor")).toBe("opencode");
    expect(nextInCycle("opencode")).toBe("antigravity");
  });

  it("wraps back to the first worker after the last", () => {
    expect(nextInCycle("antigravity")).toBe(WORKER_CYCLE[0]);
  });

  it("starts the cycle from the beginning for an unrecognised current value", () => {
    expect(nextInCycle("something-unknown")).toBe(WORKER_CYCLE[0]);
  });

  it("updates the active worker and persists it for the interactive shell", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gr-agent-cycle-"));
    await fs.mkdir(path.join(root, ".gr-agent"));
    await fs.writeFile(path.join(root, ".gr-agent", "config.json"), JSON.stringify({ primaryWorker: "native" }), "utf8");

    const model: HomeModel = {
      version: "0.1.0",
      workspaceRoot: root,
      workspaceName: "repo",
      branch: null,
      repositories: 1,
      mode: "auto",
      agent: "native",
      provider: "no provider",
      ready: true,
      initialised: true,
      hasRepo: true,
      stack: "unknown",
    };

    const g: GlobalOpts = { workspace: root };
    const selection = await cycleWorkerSelection(model, g);

    expect(selection.agent).toBe("claude");
    expect(model.agent).toBe("claude");
    await expect(fs.readFile(path.join(root, ".gr-agent", "config.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      primaryWorker: "claude",
    });
  });

  it("treats a welcome-banner Shift+Tab cycle as an Ink remount, not a session exit", () => {
    expect(shouldRemountInkSession({ resized: false, agentCycled: true })).toBe(true);
    expect(shouldRemountInkSession({ resized: true, agentCycled: false })).toBe(true);
    expect(shouldRemountInkSession({ resized: false, agentCycled: false })).toBe(false);
  });
});

describe("MODEL_LISTERS (parses each CLI's real `models` output — /model command)", () => {
  it("parses cursor-agent's 'id - label' lines, using the id before the first ' - '", () => {
    const out = ["Available models", "", "auto - Auto (current, default)", "gpt-5.3-codex - Codex 5.3", "composer-2.5 - Composer 2.5"].join("\n");
    expect(MODEL_LISTERS.cursor!.parse(out)).toEqual([
      { value: "auto", label: "Auto (current, default)" },
      { value: "gpt-5.3-codex", label: "Codex 5.3" },
      { value: "composer-2.5", label: "Composer 2.5" },
    ]);
  });

  it("parses opencode's plain provider/model lines, one per line", () => {
    const out = ["opencode/claude-sonnet-5", "opencode/gemini-3.5-flash", ""].join("\n");
    expect(MODEL_LISTERS.opencode!.parse(out)).toEqual([
      { value: "opencode/claude-sonnet-5", label: "opencode/claude-sonnet-5" },
      { value: "opencode/gemini-3.5-flash", label: "opencode/gemini-3.5-flash" },
    ]);
  });

  it("returns nothing for output that doesn't match the expected shape, rather than garbage entries", () => {
    expect(MODEL_LISTERS.cursor!.parse("")).toEqual([]);
    expect(MODEL_LISTERS.cursor!.parse("no dashes here at all")).toEqual([]);
  });
});

describe("CLAUDE_MODEL_ALIASES (/model picker labels for Claude)", () => {
  it("shows the version-numbered display names from claude's own picker, keyed by the real --model alias", () => {
    expect(CLAUDE_MODEL_ALIASES).toEqual([
      { value: "sonnet", label: "Sonnet 5" },
      { value: "opus", label: "Opus 5" },
      { value: "fable", label: "Fable 5" },
      { value: "haiku", label: "Haiku 4.5" },
    ]);
  });
});

describe("conversation continuity across agent switches (recentHistory/historyTranscript)", () => {
  const history: ChatTurn[] = [
    { role: "user", text: "hi" },
    { role: "assistant", text: "Hi! What can I help with?", agent: "Claude Code (sonnet)" },
    { role: "user", text: "hi again" }, // the just-pushed "current" turn — always excluded from context
  ];

  it("recentHistory excludes the just-pushed current turn, keeping only genuine prior context", () => {
    expect(recentHistory(history)).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hi! What can I help with?", agent: "Claude Code (sonnet)" },
    ]);
  });

  it("caps to the most recent CHAT_HISTORY_TURNS prior turns for a long-running conversation", () => {
    const long: ChatTurn[] = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, text: `turn ${i}` }));
    const kept = recentHistory(long);
    expect(kept.length).toBe(10);
    expect(kept[0]!.text).toBe("turn 19"); // the oldest of the last 10 prior turns
    expect(kept[9]!.text).toBe("turn 28"); // the newest prior turn (turn 29 is the "current" one, excluded)
  });

  it("historyTranscript formats prior turns so a newly-switched-to agent can see what an earlier one answered", () => {
    const transcript = historyTranscript(history);
    expect(transcript).toContain("User: hi");
    expect(transcript).toContain("Claude Code (sonnet): Hi! What can I help with?");
    expect(transcript).not.toContain("hi again"); // the current turn isn't prior context
  });

  it("returns an empty transcript for the very first message of a conversation", () => {
    expect(historyTranscript([{ role: "user", text: "hello" }])).toBe("");
  });
});
