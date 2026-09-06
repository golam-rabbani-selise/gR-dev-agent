import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { MultilineInput } from "../../../src/ui/ink/MultilineInput";
import { initialInputState, type InputState } from "../../../src/ui/ink/inputBuffer";

function tick(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function type(stdin: { write: (s: string) => void }, text: string): Promise<void> {
  stdin.write(text);
  await tick();
}

function afterMount(): Promise<void> {
  return tick();
}

/** A tiny stateful wrapper so pressed keys actually mutate `state` between renders, the same way
 * `InkApp` wires `MultilineInput` up in the real app. */
function Wrapper({ initial, onSubmit }: { initial: InputState; onSubmit: (text: string) => void }): React.ReactElement {
  const [state, setState] = React.useState(initial);
  return React.createElement(MultilineInput, { state, onChange: setState, onSubmit });
}

describe("MultilineInput backspace/delete key handling", () => {
  // Regression test: on macOS terminals (Terminal.app, iTerm2, VS Code's integrated terminal) the
  // physical Backspace key sends the raw byte 0x7f (DEL). Ink's keypress parser
  // (node_modules/ink/build/parse-keypress.js) maps that byte to `key.delete`, not
  // `key.backspace` — only Ctrl+H (0x08) sets `key.backspace`. The composer used to wire
  // `key.delete` to forward-delete (remove the character *at* the cursor), which is a no-op
  // whenever the cursor sits at the end of the buffer — i.e. every normal "type then backspace"
  // sequence — so pressing physical Backspace appeared to do nothing.
  it("the physical Backspace byte (0x7f) removes the character before the cursor", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(React.createElement(Wrapper, { initial: initialInputState(), onSubmit }));

    await afterMount();
    await type(stdin, "hello");
    expect(lastFrame() ?? "").toContain("hello");

    await type(stdin, "\x7f"); // the actual byte a real terminal's Backspace key sends
    expect(lastFrame() ?? "").toContain("hell");
    expect(lastFrame() ?? "").not.toContain("hello");
  });

  it("Ctrl+H (0x08) also removes the character before the cursor", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(React.createElement(Wrapper, { initial: initialInputState(), onSubmit }));

    await afterMount();
    await type(stdin, "hi");
    await type(stdin, "\x08");
    expect(lastFrame() ?? "").toContain("h");
    expect(lastFrame() ?? "").not.toContain("hi");
  });
});
