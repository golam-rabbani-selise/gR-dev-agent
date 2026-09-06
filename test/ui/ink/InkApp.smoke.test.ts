import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { InkApp } from "../../../src/ui/ink/InkApp";
import { welcomeBannerWidth, welcomeColumnWidths } from "../../../src/ui/ink/WelcomeBanner";

/** ink-testing-library's `stdin.write` feeds Ink's input event emitter, which triggers a React
 * state update and re-render asynchronously — `lastFrame()` needs a tick after every write to
 * reflect it (confirmed against a minimal `useInput` probe outside this suite; asserting on
 * `lastFrame()` synchronously right after `stdin.write` reads the *previous* frame). */
function tick(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function type(stdin: { write: (s: string) => void }, text: string): Promise<void> {
  stdin.write(text);
  await tick();
}

/** `render()`'s first commit hasn't necessarily flushed yet when it returns — writing to `stdin`
 * before that initial render settles races Ink's mount and the keystroke is dropped. Every test
 * below awaits this once, right after `render`, before the first `stdin.write`. */
function afterMount(): Promise<void> {
  return tick();
}

describe("InkApp (smoke test via ink-testing-library, a real stdin -> keypress -> render loop)", () => {
  it("lets the welcome banner fill wide terminals while giving Quick start the larger column", () => {
    expect(welcomeBannerWidth(254)).toBe(254);
    expect(welcomeBannerWidth(100)).toBe(100);
    expect(welcomeColumnWidths(254)).toEqual({ leftWidth: 50, rightWidth: 201 });
  });

  it("renders the header/footer and an empty composer initially", () => {
    const { lastFrame } = render(
      React.createElement(InkApp, {
        workspaceName: "my-repo",
        branch: "main",
        agent: "native",
        agentModel: "sonnet",
        onSubmit: vi.fn(),
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("my-repo");
    expect(frame).toContain("main");
    expect(frame).toContain("native (sonnet)");
    expect(frame).toContain("Type a message");
  });

  it("seeds the transcript from initialHistory (a fresh mount after a /command round-trip)", () => {
    // Regression test: previously InkApp always started `history` at `[]`, so remounting after a
    // dispatched command (e.g. /agents) made every earlier chat turn vanish from the screen even
    // though `runInkInteractive`'s own `chatHistory` array — and the model's actual context — still
    // had it. `initialHistory` re-seeds the new mount's <Static> transcript with everything said
    // so far.
    const { lastFrame } = render(
      React.createElement(InkApp, {
        workspaceName: "repo",
        branch: null,
        agent: "native",
        initialHistory: [
          { role: "user", text: "my favourite number 7" },
          { role: "assistant", text: "Noted: your favourite number is 7.", agent: "native" },
        ],
        onSubmit: vi.fn(),
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("my favourite number 7");
    expect(frame).toContain("Noted: your favourite number is 7.");
  });

  it("typing text then Enter submits it and shows the pending state, then the reply", async () => {
    // A deferred promise, resolved only once the pending-state assertion below has run — a
    // `mockResolvedValue` settles on the next microtask, which the tick() inside `type()` is
    // plenty of time for, so "Thinking" would already be gone by the time we could check it.
    let resolveReply!: (reply: { text: string; agent: string }) => void;
    const onSubmit = vi.fn().mockReturnValue(new Promise((resolve) => { resolveReply = resolve; }));
    const { stdin, lastFrame } = render(
      React.createElement(InkApp, {
        workspaceName: "my-repo",
        branch: "main",
        agent: "native",
        onSubmit,
      }),
    );

    await afterMount();
    await type(stdin, "hello there");
    expect(lastFrame() ?? "").toContain("hello there");

    await type(stdin, "\r"); // Enter

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("hello there", [{ role: "user", text: "hello there" }]);

    // the composer is cleared immediately on submit, before the reply comes back
    const afterSubmitFrame = lastFrame() ?? "";
    expect(afterSubmitFrame).toContain("Thinking");

    resolveReply({ text: "hi back", agent: "native (sonnet)" });
    await tick(30);
    const finalFrame = lastFrame() ?? "";
    expect(finalFrame).not.toContain("Thinking");
    expect(finalFrame).toContain("hi back");
  });

  it("a trailing backslash before Enter inserts a newline instead of submitting", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(InkApp, { workspaceName: "repo", branch: null, agent: "native", onSubmit }),
    );

    await afterMount();
    await type(stdin, "line one\\");
    await type(stdin, "\r");
    await type(stdin, "line two");

    expect(onSubmit).not.toHaveBeenCalled();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("line one");
    expect(frame).toContain("line two");
  });

  it("typing '/' opens the command popover with matching commands", async () => {
    const { stdin, lastFrame } = render(
      React.createElement(InkApp, { workspaceName: "repo", branch: null, agent: "native", onSubmit: vi.fn() }),
    );

    await afterMount();
    await type(stdin, "/mo");
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/model");
    expect(frame).not.toContain("/help"); // filtered out — doesn't match "mo"
  });

  it("Down/Up move the popover selection and Tab accepts the highlighted command", async () => {
    const { stdin, lastFrame } = render(
      React.createElement(InkApp, { workspaceName: "repo", branch: null, agent: "native", onSubmit: vi.fn() }),
    );

    await afterMount();
    await type(stdin, "/mo"); // matches /mode (index 0) then /model (index 1), in that order
    await type(stdin, "\u001B[B"); // Down arrow: move selection from /mode to /model
    await type(stdin, "\t"); // Tab accepts the highlighted match
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/model");
  });

  it("Shift+Tab cycles the active agent instead of editing the composer", async () => {
    const onCycleAgent = vi.fn().mockResolvedValue({ agent: "codex", agentModel: "gpt-5.6-sol" });
    const { stdin, lastFrame } = render(
      React.createElement(InkApp, {
        workspaceName: "repo",
        branch: null,
        agent: "native",
        onSubmit: vi.fn(),
        onCycleAgent,
      }),
    );

    await afterMount();
    await type(stdin, "\x1b[Z");
    await tick(30);

    expect(onCycleAgent).toHaveBeenCalledTimes(1);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("codex (gpt-5.6-sol)");
    expect(frame).not.toContain("[Z");
  });

  it("Shift+Tab requests a clean remount when the welcome banner's agent description must change", async () => {
    const onCycleAgent = vi.fn().mockReturnValue({ agent: "codex", agentModel: "gpt-5.6-sol" });
    const onAgentCycleRemount = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(InkApp, {
        workspaceName: "repo",
        branch: null,
        agent: "opencode",
        agentModel: "opencode-go/deepseek-v4-pro",
        version: "0.1.0",
        mode: "auto",
        showWelcome: true,
        onSubmit: vi.fn(),
        onCycleAgent,
        onAgentCycleRemount,
      }),
    );

    await afterMount();
    expect(lastFrame() ?? "").toContain("[opencode-go/dee~]");

    await type(stdin, "\x1b[Z");

    expect(onCycleAgent).toHaveBeenCalledTimes(1);
    expect(onAgentCycleRemount).toHaveBeenCalledTimes(1);
  });

  it("Enter completes a partial/ambiguous match instead of submitting the raw text", async () => {
    // Regression test: typing "/" alone and pressing Enter used to submit the literal "/" (and
    // typing "/wo" + Enter submitted "/wo") instead of completing to the highlighted command —
    // confusing, since the popover was visibly showing matches the whole time.
    const onSubmit = vi.fn().mockResolvedValue({ text: "ok" });
    const { stdin, lastFrame } = render(
      React.createElement(InkApp, { workspaceName: "repo", branch: null, agent: "native", onSubmit }),
    );

    await afterMount();
    await type(stdin, "/");
    await type(stdin, "\r"); // Enter with an ambiguous match completes, it doesn't submit "/"
    expect(onSubmit).not.toHaveBeenCalled();
    // The completed value is "/help " (with a trailing space, so a second Enter submits rather than
    // re-completing) — but a trailing space at the very end of a rendered terminal row is invisible
    // (nothing else follows it on that row now that the composer is a plain ruled line rather than a
    // bordered box with padding/a border character after it), so the *rendered frame* legitimately
    // shows "/help" with no way to distinguish the trailing space from its absence. The trailing
    // space's actual effect (a second Enter submits instead of re-completing) is what's asserted
    // below, which is the part that actually matters.
    expect(lastFrame() ?? "").toContain("/help"); // the first command in the list, completed

    await type(stdin, "\r"); // now that it's an exact match, Enter submits it for real
    expect(onSubmit).toHaveBeenCalledWith("/help", [{ role: "user", text: "/help" }]);
  });

  it("returning null from onSubmit (e.g. /quit) does not throw", async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { stdin } = render(
      React.createElement(InkApp, { workspaceName: "repo", branch: null, agent: "native", onSubmit }),
    );
    await afterMount();
    await type(stdin, "/quit");
    await type(stdin, "\r");
    expect(onSubmit).toHaveBeenCalledWith("/quit", [{ role: "user", text: "/quit" }]);
  });

  it("a rejected onSubmit shows an error turn instead of crashing", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("network down"));
    const { stdin, lastFrame } = render(
      React.createElement(InkApp, { workspaceName: "repo", branch: null, agent: "native", onSubmit }),
    );
    await afterMount();
    await type(stdin, "hi");
    await type(stdin, "\r");
    await tick(30);
    expect(lastFrame() ?? "").toContain("network down");
  });


  it("the chat history flows top-down and isn't bounded to a fixed-height viewport", () => {
    // Regression test for the top-down-flow rework: an earlier version rendered the whole app
    // inside one fixed-height box so the composer stayed pinned to the bottom of the terminal
    // regardless of conversation length, which meant older turns scrolled out of the rendered
    // frame entirely (in a bounded test harness, and via the real terminal's own clearing on
    // resize). Now the transcript is unbounded — every turn stays in the frame, oldest included,
    // matching how Claude Code's own CLI flows.
    const { lastFrame } = render(
      React.createElement(InkApp, {
        workspaceName: "repo",
        branch: null,
        agent: "native",
        initialHistory: Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, text: `message number ${i}` })),
        onSubmit: vi.fn(),
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("message number 0"); // the oldest turn is still there...
    expect(frame).toContain("message number 29"); // ...right alongside the newest
    expect(frame).toContain("Type a message"); // ...with the composer right after it, not padded away
  });

  it("shows the welcome banner when showWelcome is set", () => {
    const withWelcome = render(
      React.createElement(InkApp, {
        workspaceName: "repo",
        branch: "main",
        agent: "native",
        version: "0.1.0",
        mode: "auto",
        showWelcome: true,
        onSubmit: vi.fn(),
      }),
    );
    const withWelcomeFrame = withWelcome.lastFrame() ?? "";
    expect(withWelcomeFrame).toContain("gR DEV AGENT");
    expect(withWelcomeFrame).toContain("v0.1.0");
    expect(withWelcomeFrame).toContain("Quick start");
    expect(withWelcomeFrame).toContain("Workspace");
    expect(withWelcomeFrame).toContain("/help  Run /help to see every command");
    expect(withWelcomeFrame).toContain("/agents  Run /agents to choose a worker");
    expect(withWelcomeFrame).toContain("Your parallel AI engineering workspace");
    expect(withWelcomeFrame).toContain("Plan tasks, route work to the right agent");
    expect(withWelcomeFrame).toContain("Keep code changes separate until reviewed");
    expect(withWelcomeFrame).toContain("Merge findings into one root-cause report");
    expect(withWelcomeFrame).toContain("Native / Claude / Codex / Cursor / OpenCode / Manual");
    expect(withWelcomeFrame).toContain("Developed by Golam Rabbani");
    expect(withWelcomeFrame).not.toContain("Branch main");
    expect(withWelcomeFrame).toContain("Welcome back, there"); // no userName passed -> InkApp's own default

    const withoutWelcome = render(
      React.createElement(InkApp, {
        workspaceName: "repo",
        branch: "main",
        agent: "native",
        version: "0.1.0",
        mode: "auto",
        showWelcome: false,
        onSubmit: vi.fn(),
      }),
    );
    expect(withoutWelcome.lastFrame() ?? "").not.toContain("Quick start");
  });

  it("keeps the welcome banner on a fresh mount that already has chat history", () => {
    const { lastFrame } = render(
      React.createElement(InkApp, {
        workspaceName: "repo",
        branch: "main",
        agent: "native",
        version: "0.1.0",
        mode: "auto",
        showWelcome: true,
        initialHistory: [
          { role: "user", text: "hi" },
          { role: "assistant", text: "hello back", agent: "native" },
        ],
        onSubmit: vi.fn(),
      }),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Quick start");
    expect(frame).toContain("Workspace");
    expect(frame).toContain("hi");
    expect(frame).toContain("hello back");
  });
});
