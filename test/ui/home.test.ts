import { describe, it, expect, beforeEach } from "vitest";
import {
  checkpointToRecentTask,
  filterSlashCommands,
  getSuggestionList,
  invalidateSizeCache,
  isCommandMenuOpen,
  renderHome,
  renderHomePrompt,
  resolveSuggestionSubmission,
  RUN_INIT_ACTION,
  RUN_CLONE_ACTION,
  SLASH_COMMANDS,
  type HomeModel,
} from "../../src/ui/home";
import { WORDMARK } from "../../src/ui/logo";

const model: HomeModel = {
  version: "0.1.0",
  workspaceRoot: "/tmp/riqs",
  workspaceName: "riqs",
  branch: "develop",
  repositories: 4,
  mode: "auto",
  agent: "claude-sonnet",
  provider: "anthropic",
  ready: true,
  initialised: true,
  hasRepo: true,
  stack: "unknown",
};

const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
const strip = (s: string) => s.replace(ANSI, "");

describe("home screen", () => {
  // termWidth()/termHeight() cache their result for a short TTL (see invalidateSizeCache() in
  // src/ui/home.ts) so a spinner redrawing 10x/second doesn't re-shell-out to stty/tput every tick.
  // These tests run back-to-back well within that window, so without this a test could see a size
  // cached by whichever test happened to run just before it.
  beforeEach(() => {
    invalidateSizeCache();
  });

  it("renders a simple Magnitude-style launcher", () => {
    process.env.COLUMNS = "120";
    process.env.GR_AGENT_HEIGHT = "30";
    const out = strip(renderHome(model));
    expect(out).toContain(WORDMARK);
    expect(out).toContain("Your parallel AI engineering workspace");
    expect(out).toContain("Current directory: ~/riqs");
    expect(out).toContain("Suggested starts");
    expect(out).toContain("enter send");
    expect(out).toContain("@ files");
    expect(out).not.toContain("Chat with the agent...");
    expect(out).not.toContain("Ctrl+J newline");
    delete process.env.GR_AGENT_HEIGHT;
    delete process.env.COLUMNS;
  });

  it("renders the small local-agent icon instead of a large logo", () => {
    process.env.COLUMNS = "120";
    process.env.GR_AGENT_HEIGHT = "30";
    const out = strip(renderHome(model));
    expect(out).toContain("┌─────┐");
    expect(out).toContain("│ ↗ ↗ │");
    expect(out).not.toContain("▀▄▄█");
    expect(out).not.toContain("▄████▄███");
    delete process.env.GR_AGENT_HEIGHT;
    delete process.env.COLUMNS;
  });

  it("shows real recent tasks when provided", () => {
    const out = strip(renderHome({
      ...model,
      recentTasks: [{ title: "Generate an AGENTS.md file for this project", meta: "4 messages · 25d ago" }],
    }));
    expect(out).toContain("Recent tasks");
    expect(out).toContain("Generate an AGENTS.md file for this project");
    expect(out).toContain("4 messages · 25d ago");
  });

  it("keeps the gR casing intact", () => {
    const out = strip(renderHome(model));
    expect(out).toContain("gR DEV AGENT");
    expect(out).not.toMatch(/\bGR DEV AGENT\b/);
    expect(out).not.toMatch(/\bGr DEV AGENT\b/);
  });

  it("does not render dashboard cards", () => {
    process.env.COLUMNS = "120";
    const out = strip(renderHome(model));
    expect(out).not.toContain("SUGGESTED ACTIONS");
    expect(out).not.toContain("QUICK COMMANDS");
    delete process.env.COLUMNS;
  });

  it("no rendered line exceeds the terminal width", () => {
    for (const cols of [60, 76, 100, 120, 128, 160, 200, 254, 300]) {
      process.env.COLUMNS = String(cols);
      invalidateSizeCache(); // this loop simulates rapid resizes faster than the short-TTL size cache
      const lines = strip(renderHome(model)).split("\n");
      const cap = Math.min(Math.max(cols, 64), 320);
      for (const l of lines) expect(l.length, `cols=${cols}: "${l}"`).toBeLessThanOrEqual(cap);
    }
    delete process.env.COLUMNS;
  });

  it("does not artificially cap a genuinely wide terminal at 120 columns", () => {
    // Regression: clampWidth() used to hard-cap every render at 120 columns regardless of how wide
    // the terminal actually was — invisible on plain text, but it silently truncated the chat's
    // full-width code-block background too. A 254-column terminal should render (much) wider than
    // 120 now.
    process.env.GR_AGENT_WIDTH = "254";
    const out = strip(renderHome(model));
    const divider = out.split("\n").find((l) => /^-+$/.test(l) || /^─+$/.test(l));
    expect(divider?.length ?? 0).toBeGreaterThan(120);
    delete process.env.GR_AGENT_WIDTH;
  });

  it("uses the smaller visible width when terminal size signals disagree", () => {
    const originalColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 254 });
    process.env.COLUMNS = "128";
    const lines = strip(renderHome(model)).split("\n");
    for (const l of lines) expect(l.length, `"${l}"`).toBeLessThanOrEqual(128);
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: originalColumns });
    delete process.env.COLUMNS;
  });

  it("shows a setup hint when the workspace is not initialised", () => {
    const out = strip(renderHome({ ...model, initialised: false }));
    expect(out).toMatch(/gr-agent init/);
  });

  it("maps checkpoints to recent task rows", () => {
    const row = checkpointToRecentTask({
      task: { objective: "Fix login permissions" },
      completedResults: ["a", "b"],
      savedAt: new Date(Date.now() - 90_000).toISOString(),
    });
    expect(row.title).toBe("Fix login permissions");
    expect(row.meta).toMatch(/2 messages · \d+m ago/);
  });

  it("has an ASCII-only rendering with GR_ASCII", () => {
    process.env.GR_ASCII = "1";
    const out = strip(renderHome(model));
    expect(out).not.toMatch(/[│╭╮╰╯─┌┐└┘█▄▀]/);
    delete process.env.GR_ASCII;
  });

  it("renders one live prompt instead of a second fake input row", () => {
    const home = strip(renderHome(model));
    const prompt = strip(renderHomePrompt());
    expect(home).not.toContain(prompt + "Chat with the agent");
    expect(prompt).toMatch(/[▌|>] /);
  });

  it("always shows the fixed \"Built by Golam Rabbani\" credit — never derived per-user", () => {
    const out = strip(renderHome(model));
    expect(out).toContain("Your parallel AI engineering workspace");
    expect(out).toContain("Built by Golam Rabbani");
  });

  it("draws the live composer text inline with the prompt", () => {
    const out = strip(renderHome(model, { value: "hello there" }));
    expect(out).toContain("hello there");
  });

  it("shows a composer placeholder only while empty", () => {
    const empty = strip(renderHome(model, { value: "" }));
    const typed = strip(renderHome(model, { value: "hi" }));
    expect(empty).toContain("Ask anything, or /implement <task> for a workflow");
    expect(typed).not.toContain("Ask anything, or /implement <task> for a workflow");
  });

  it("shows only setup-related suggestions before init, never generic project tasks", () => {
    const out = strip(renderHome({ ...model, initialised: false }));
    expect(out).toContain("Get started");
    expect(out).toContain("/setup");
    expect(out).toContain("/help");
    expect(out).not.toContain("Investigate a backend bug");
    expect(out).not.toContain("Suggested starts");
  });

  it("puts /setup before /help, and it is highlighted first", () => {
    const list = getSuggestionList({ ...model, initialised: false });
    expect(list.map((r) => r.title)).toEqual(["/setup", "/help"]);
    const out = strip(renderHome({ ...model, initialised: false }, { value: "", selectedIndex: 0 }));
    const setupLine = out.split("\n").find((l) => l.includes("/setup"));
    expect(setupLine).toMatch(/^\s*>/);
  });

  it("keeps /setup in the general \"/\" palette too, so it works after init", () => {
    expect(filterSlashCommands("/setup").map((c) => c.id)).toContain("/setup");
    expect(SLASH_COMMANDS.find((c) => c.id === "/setup")?.comingSoon).toBeFalsy();
  });

  it("previews the real action (gr-agent init) while /setup is highlighted, not the label", () => {
    const out = strip(renderHome({ ...model, initialised: false }, { value: "", selectedIndex: 0 }));
    const composerLine = out.split("\n").find((l) => l.includes("gr-agent init"));
    expect(composerLine).toBeDefined();
    expect(composerLine).not.toContain("/setup");
  });

  it("previews nothing special for a plain suggestion (falls back to the placeholder)", () => {
    const out = strip(renderHome(model, { value: "", selectedIndex: 0 }));
    expect(out).toContain("Ask anything, or /implement <task> for a workflow");
  });

  describe("workspace stage: init -> clone -> stack-aware tasks", () => {
    const clean = { ...model, initialised: true, hasRepo: false, stack: "unknown" as const };

    it("offers /clone (not project tasks) once initialised but before any repo exists", () => {
      const list = getSuggestionList(clean);
      expect(list.map((r) => r.title)).toEqual(["/clone", "/help"]);
      const out = strip(renderHome(clean));
      expect(out).toContain("Next: clone a repository");
      expect(out).not.toContain("Suggested starts");
    });

    it("previews the real action (clone a repository) while /clone is highlighted", () => {
      const out = strip(renderHome(clean, { value: "", selectedIndex: 0 }));
      const composerLine = out.split("\n").find((l) => l.includes("clone a repository"));
      expect(composerLine).toBeDefined();
      expect(composerLine).not.toContain("/clone");
    });

    it("keeps /clone in the general palette too", () => {
      expect(filterSlashCommands("/clone").map((c) => c.id)).toContain("/clone");
    });

    it("shows backend-flavoured suggestions once a backend repo is detected", () => {
      const backend = { ...model, hasRepo: true, stack: "backend" as const };
      const out = strip(renderHome(backend));
      expect(out).toContain("Suggested starts (backend)");
      expect(out).toContain("Trace an API endpoint end-to-end");
      expect(out).not.toContain("Investigate a UI bug");
    });

    it("shows frontend-flavoured suggestions once a frontend repo is detected", () => {
      const frontend = { ...model, hasRepo: true, stack: "frontend" as const };
      const out = strip(renderHome(frontend));
      expect(out).toContain("Suggested starts (frontend)");
      expect(out).toContain("Investigate a UI bug");
      expect(out).not.toContain("Trace an API endpoint end-to-end");
    });

    it("falls back to generic, stack-neutral suggestions when the stack can't be guessed", () => {
      const out = strip(renderHome({ ...model, hasRepo: true, stack: "unknown" }));
      expect(out).toContain("Suggested starts");
      expect(out).not.toContain("(backend)");
      expect(out).not.toContain("(frontend)");
    });

    it("real recent tasks always win over any stage-based suggestion", () => {
      const out = strip(renderHome({
        ...clean,
        recentTasks: [{ title: "Fix login permissions", meta: "2 messages · 3m ago" }],
      }));
      expect(out).toContain("Recent tasks");
      expect(out).toContain("Fix login permissions");
      expect(out).not.toContain("/clone");
    });
  });

  describe("/ command palette", () => {
    it("opens only while choosing the command, not once an argument starts", () => {
      expect(isCommandMenuOpen("/")).toBe(true);
      expect(isCommandMenuOpen("/mo")).toBe(true);
      expect(isCommandMenuOpen("/mode auto")).toBe(false);
      expect(isCommandMenuOpen("plain task")).toBe(false);
    });

    it("filters commands by prefix", () => {
      expect(filterSlashCommands("/").map((c) => c.id)).toEqual(SLASH_COMMANDS.map((c) => c.id));
      const mo = filterSlashCommands("/mo").map((c) => c.id);
      expect(mo).toContain("/mode");
      expect(mo).toContain("/model");
      expect(mo).not.toContain("/help");
    });

    it("replaces the suggested/recent list with a selectable menu", () => {
      const out = strip(renderHome(model, { value: "/", selectedIndex: 0 }));
      expect(out).toContain("Commands");
      expect(out).toContain("/help");
      expect(out).not.toContain("Suggested starts");
      expect(out).toMatch(/↑↓ select/);
    });

    it("highlights the selected row and moves with selectedIndex", () => {
      const first = strip(renderHome(model, { value: "/", selectedIndex: 0 }));
      const second = strip(renderHome(model, { value: "/", selectedIndex: 1 }));
      const firstLine = (out: string) => out.split("\n").find((l) => l.includes(SLASH_COMMANDS[0]!.desc));
      expect(firstLine(first)).toMatch(/^\s*>/);
      // the same row is no longer marked selected once selectedIndex moves on
      expect(firstLine(second)).not.toMatch(/^\s*>/);
    });

    it("closes the menu once a space starts the argument", () => {
      const out = strip(renderHome(model, { value: "/mode auto" }));
      expect(out).not.toContain("Commands ·");
      expect(out).not.toContain("enter choose");
      expect(out).toContain("Suggested starts");
    });

    it("still respects the terminal width with the menu open", () => {
      for (const cols of [64, 80, 120]) {
        process.env.COLUMNS = String(cols);
        invalidateSizeCache(); // this loop simulates rapid resizes faster than the short-TTL size cache
        const lines = strip(renderHome(model, { value: "/", selectedIndex: 0 })).split("\n");
        for (const l of lines) expect(l.length, `cols=${cols}: "${l}"`).toBeLessThanOrEqual(cols);
      }
      delete process.env.COLUMNS;
    });
  });

  describe("suggested/recent list navigation", () => {
    it("STARTERS by default, recentTasks when provided", () => {
      expect(getSuggestionList(model).length).toBeGreaterThan(0);
      const recentTasks = [{ title: "Fix login permissions", meta: "2 messages · 3m ago" }];
      expect(getSuggestionList({ ...model, recentTasks })).toEqual(recentTasks);
    });

    it("moves the highlighted row with selectedIndex while the composer is empty", () => {
      const list = getSuggestionList(model);
      const highlighted = (out: string, title: string) =>
        out.split("\n").find((l) => l.includes(title))?.match(/^\s*>/) !== null;
      const zero = strip(renderHome(model, { value: "", selectedIndex: 0 }));
      const two = strip(renderHome(model, { value: "", selectedIndex: 2 }));
      expect(highlighted(zero, list[0]!.title)).toBe(true);
      expect(highlighted(two, list[0]!.title)).toBe(false);
      expect(highlighted(two, list[2]!.title)).toBe(true);
    });

    it("ignores selectedIndex once the user is typing a plain task", () => {
      const list = getSuggestionList(model);
      const out = strip(renderHome(model, { value: "fix the login bug", selectedIndex: 3 }));
      const line = out.split("\n").find((l) => l.includes(list[3]!.title));
      expect(line).not.toMatch(/^\s*>/);
    });

    it("advertises arrow-key selection in the section header", () => {
      const out = strip(renderHome(model, { value: "" }));
      expect(out).toMatch(/↑↓ select · enter run/);
    });
  });

  describe("/implement and chat-by-default (plain text no longer runs a task on its own)", () => {
    it("lists /implement in the general \"/\" palette", () => {
      expect(SLASH_COMMANDS.find((c) => c.id === "/implement")).toBeDefined();
      expect(SLASH_COMMANDS.find((c) => c.id === "/implement")?.comingSoon).toBeFalsy();
      expect(filterSlashCommands("/implement").map((c) => c.id)).toContain("/implement");
    });

    it("routes a plain task suggestion through /implement so picking it still runs the workflow", () => {
      expect(resolveSuggestionSubmission({ title: "Investigate a bug", meta: "" })).toBe("/implement Investigate a bug");
    });

    it("routes a suggestion with an explicit value (not just a title) through /implement too", () => {
      expect(resolveSuggestionSubmission({ title: "Resume", meta: "", value: "fix the login redirect bug" })).toBe(
        "/implement fix the login redirect bug",
      );
    });

    it("leaves the init/clone sentinels untouched", () => {
      expect(resolveSuggestionSubmission({ title: "/setup", meta: "", value: "gr-agent init", action: "init" })).toBe(RUN_INIT_ACTION);
      expect(resolveSuggestionSubmission({ title: "/clone", meta: "", value: "clone a repository", action: "clone" })).toBe(RUN_CLONE_ACTION);
    });

    it("leaves an already-slash-prefixed suggestion (e.g. /help) untouched", () => {
      expect(resolveSuggestionSubmission({ title: "/help", meta: "" })).toBe("/help");
    });

    it("routes a recent (checkpoint) task through /implement", () => {
      const recent = checkpointToRecentTask({ task: { objective: "fix login permissions" }, completedResults: ["a"], savedAt: new Date().toISOString() });
      expect(resolveSuggestionSubmission(recent)).toBe("/implement fix login permissions");
    });
  });

  describe("footer shows the actual chat/task agent, not an unrelated provider", () => {
    it("shows the chosen agent (e.g. claude) instead of the native provider once one is selected", () => {
      const out = strip(renderHome({ ...model, agent: "claude", provider: "ollama" }));
      const footerLine = out.split("\n").find((l) => l.includes("enter send"));
      expect(footerLine).toContain("claude");
      expect(footerLine).not.toContain("ollama");
    });

    it("also shows the agent's model in the footer, when one is known", () => {
      const out = strip(renderHome({ ...model, agent: "codex", agentModel: "gpt-5.6-terra", provider: "ollama" }));
      const footerLine = out.split("\n").find((l) => l.includes("enter send"));
      expect(footerLine).toContain("codex (gpt-5.6-terra)");
    });

    it("omits the parens entirely when the agent's model isn't known", () => {
      const out = strip(renderHome({ ...model, agent: "cursor", agentModel: undefined, provider: "ollama" }));
      const footerLine = out.split("\n").find((l) => l.includes("enter send"));
      expect(footerLine).toContain("cursor");
      expect(footerLine).not.toContain("(");
    });

    it("still shows the native provider when the primary worker really is native", () => {
      const out = strip(renderHome({ ...model, agent: "native", provider: "ollama" }));
      const footerLine = out.split("\n").find((l) => l.includes("enter send"));
      expect(footerLine).toContain("ollama");
    });
  });

  describe("chat transcript (plain text is chat, per resolveSuggestionSubmission's /implement split)", () => {
    it("shows the suggestion list when there's no chat history yet", () => {
      const out = strip(renderHome(model));
      expect(out).toContain("Suggested starts");
    });

    it("replaces the suggestion list with the chat transcript once a turn exists", () => {
      const withChat = { ...model, chatHistory: [{ role: "user" as const, text: "hello" }] };
      const out = strip(renderHome(withChat));
      expect(out).not.toContain("Suggested starts");
      expect(out).toContain("hello");
    });

    it("renders both the user message and the assistant's reply, labelled with the answering agent", () => {
      const withChat = {
        ...model,
        chatHistory: [
          { role: "user" as const, text: "hello" },
          { role: "assistant" as const, text: "Hi there!", agent: "Claude Code" },
        ],
      };
      const out = strip(renderHome(withChat));
      expect(out).toContain("hello");
      expect(out).toContain("Claude Code:");
      expect(out).toContain("Hi there!");
    });

    it("gives a fenced code block its own styled block instead of printing raw ``` fences", () => {
      const reply = 'Here\'s a minimal C# example:\n\n```csharp\nusing System;\n\nclass Program\n{\n    static void Main()\n    {\n        Console.WriteLine("Hello, World!");\n    }\n}\n```\n\nLet me know if you want more.';
      const withChat = { ...model, chatHistory: [{ role: "assistant" as const, text: reply, agent: "Cursor CLI" }] };
      const out = strip(renderHome(withChat));
      expect(out).not.toContain("```"); // fence markers themselves are never printed
      expect(out).toContain("csharp"); // language label kept, as a block header
      expect(out).toContain('Console.WriteLine("Hello, World!");'); // code line preserved verbatim (indentation intact)
      expect(out).toContain("Let me know if you want more."); // trailing prose still rendered
    });

    it("closes the header/footer rule with corners, and shades the code lines with a background", () => {
      // Per user feedback: ┌...┐ / └...┘ corners on the rule above/below the code, and a shaded
      // background behind each code line (no "│" side borders needed — the shading marks the edge).
      const reply = "```csharp\nusing System;\n```";
      const withChat = { ...model, chatHistory: [{ role: "assistant" as const, text: reply, agent: "Cursor CLI" }] };
      const lines = strip(renderHome(withChat)).split("\n");
      const header = lines.find((l) => l.includes("csharp"));
      const codeLine = lines.find((l) => l.includes("using System;"));
      const footer = lines.filter((l) => l.startsWith("└")).pop(); // last "└"-line — the icon's own "└──┬──┘" comes first
      expect(header?.startsWith("┌")).toBe(true);
      expect(header?.endsWith("┐")).toBe(true);
      expect(footer?.startsWith("└")).toBe(true);
      expect(footer?.endsWith("┘")).toBe(true);
      expect(codeLine?.startsWith("  using System;")).toBe(true); // indented, padded out for the background
    });

    it("stretches the box to the full (responsive) terminal width, not sized to content", () => {
      // Per user feedback: the box should fill the terminal width and follow it responsively —
      // not shrink to fit a short snippet.
      process.env.GR_AGENT_WIDTH = "254";
      const reply = "```bash\ndotnet run\n```";
      const withChat = { ...model, chatHistory: [{ role: "assistant" as const, text: reply, agent: "Codex CLI" }] };
      const lines = strip(renderHome(withChat)).split("\n");
      const header = lines.find((l) => l.includes("bash"));
      expect(header?.length ?? 0).toBeGreaterThan(120);
      delete process.env.GR_AGENT_WIDTH;
    });

    it("the shaded content line reaches the same width as the header/footer border, not short of it", () => {
      // Regression: the code line's background used to be padded 2 columns narrower than the box's
      // own border, so the shading visibly stopped short of the right edge instead of matching it.
      const reply = "```bash\ndotnet run\n```";
      const withChat = { ...model, chatHistory: [{ role: "assistant" as const, text: reply, agent: "Codex CLI" }] };
      const lines = strip(renderHome(withChat)).split("\n");
      const header = lines.find((l) => l.includes("bash"));
      const codeLine = lines.find((l) => l.includes("dotnet run"));
      expect(codeLine?.length).toBe(header?.length);
    });

    it("still doesn't truncate a genuinely long code line at a fixed 120 columns", () => {
      process.env.GR_AGENT_WIDTH = "254";
      const longLine = `Console.WriteLine("${"x".repeat(150)}");`; // longer than the old 120 cap
      const reply = `\`\`\`csharp\n${longLine}\n\`\`\``;
      const withChat = { ...model, chatHistory: [{ role: "assistant" as const, text: reply, agent: "Codex CLI" }] };
      const out = strip(renderHome(withChat));
      expect(out).toContain(longLine); // preserved in full, not cut off at 120
      delete process.env.GR_AGENT_WIDTH;
    });

    it("passes plain-text replies (no code fences) through unchanged", () => {
      const withChat = { ...model, chatHistory: [{ role: "assistant" as const, text: "Just a plain reply, no code here.", agent: "Claude Code" }] };
      const out = strip(renderHome(withChat));
      expect(out).toContain("Just a plain reply, no code here.");
    });

    it("shows a Thinking… placeholder while a reply is in flight", () => {
      const withChat = { ...model, chatHistory: [{ role: "user" as const, text: "hello" }], chatPending: true };
      const out = strip(renderHome(withChat));
      expect(out).toContain("Thinking…");
    });

    it("keeps the composer input row visible (not a blank line) while a reply is pending", () => {
      // Regression: a caller that renders mid-chat MUST pass a composer state — renderHome() with no
      // second argument at all draws a bare blank line where the input box should be, which is
      // exactly what made the composer appear to vanish during "Thinking…".
      const withChat = { ...model, chatHistory: [{ role: "user" as const, text: "hello" }], chatPending: true };
      const out = strip(renderHome(withChat, { value: "" }));
      expect(out).toContain("Ask anything, or /implement <task> for a workflow");
      const withoutComposerArg = strip(renderHome(withChat));
      expect(withoutComposerArg).not.toContain("Ask anything, or /implement <task> for a workflow");
    });

    it("keeps the composer pinned to the very bottom of the terminal, however short the conversation is", () => {
      process.env.GR_AGENT_HEIGHT = "40";
      const withChat = { ...model, chatHistory: [{ role: "user" as const, text: "hi" }, { role: "assistant" as const, text: "Hello!", agent: "Claude Code" }] };
      const out = strip(renderHome(withChat, { value: "" }));
      const lines = out.split("\n");
      const composerIndex = lines.findIndex((l) => l.includes("Ask anything"));
      // Pinned near the bottom of a 40-row terminal, not floating right under the last message.
      expect(composerIndex).toBeGreaterThan(30);
      delete process.env.GR_AGENT_HEIGHT;
    });

    it("re-anchors the composer to the bottom when the terminal is resized (reads height live)", () => {
      const withChat = { ...model, chatHistory: [{ role: "user" as const, text: "hi" }] };
      process.env.GR_AGENT_HEIGHT = "25";
      const shortComposerIndex = strip(renderHome(withChat, { value: "" })).split("\n").findIndex((l) => l.includes("Ask anything"));
      process.env.GR_AGENT_HEIGHT = "50";
      const tallComposerIndex = strip(renderHome(withChat, { value: "" })).split("\n").findIndex((l) => l.includes("Ask anything"));
      expect(tallComposerIndex).toBeGreaterThan(shortComposerIndex);
      delete process.env.GR_AGENT_HEIGHT;
    });

    it("caps the transcript so a long conversation can't push the composer off-screen", () => {
      process.env.GR_AGENT_HEIGHT = "20";
      const longHistory = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, text: `message ${i}` }));
      const out = strip(renderHome({ ...model, chatHistory: longHistory }, { value: "" }));
      expect(out).toContain("message 29"); // most recent — kept
      expect(out).not.toContain("message 0"); // oldest — hidden
      expect(out).toContain("earlier messages hidden");
      delete process.env.GR_AGENT_HEIGHT;
    });
  });

  describe("inline /implement view (runLog) — replaces chat/suggestions instead of clearing to a new page", () => {
    it("shows the objective and log lines inline, with the header/footer still visible", () => {
      const running = { ...model, runLog: ["Plan (manual): investigate[investigator]", "Investigating…"], runObjective: "fix the login bug" };
      const out = strip(renderHome(running, { value: "" }));
      expect(out).toContain("Running:");
      expect(out).toContain("fix the login bug");
      expect(out).toContain("Investigating…");
      expect(out).toContain("Ask anything"); // composer still there
      expect(out).toContain("enter send"); // footer still there
    });

    it("shows a Starting… placeholder before the first line arrives", () => {
      const running = { ...model, runLog: [], runObjective: "fix the login bug", runPending: true };
      const out = strip(renderHome(running, { value: "" }));
      expect(out).toContain("Starting…");
    });

    it("shows the current status (spinner) frame separately from the permanent log lines", () => {
      const running = { ...model, runLog: ["Investigating…"], runObjective: "x", runStatus: "⠋ Investigating… (opencode) (3s)" };
      const out = strip(renderHome(running, { value: "" }));
      expect(out).toContain("Investigating… (opencode) (3s)");
    });

    it("takes priority over the chat transcript when both are present", () => {
      const both = { ...model, chatHistory: [{ role: "user" as const, text: "hello" }], runLog: ["Plan: ..."], runObjective: "do a thing" };
      const out = strip(renderHome(both, { value: "" }));
      expect(out).toContain("Running:");
      expect(out).not.toContain("hello");
    });

    it("caps long output so the composer can't be pushed off-screen, same as chat", () => {
      process.env.GR_AGENT_HEIGHT = "20";
      const longLog = Array.from({ length: 40 }, (_, i) => `line ${i}`);
      const out = strip(renderHome({ ...model, runLog: longLog, runObjective: "big task" }, { value: "" }));
      expect(out).toContain("line 39");
      expect(out).not.toContain("line 0");
      expect(out).toContain("earlier line");
      delete process.env.GR_AGENT_HEIGHT;
    });

    it("falls back to the suggestion list when no /implement has happened yet this session", () => {
      const out = strip(renderHome(model));
      expect(out).not.toContain("Running:");
    });
  });

});
