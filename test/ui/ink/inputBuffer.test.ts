import { describe, it, expect } from "vitest";
import {
  initialInputState,
  insertText,
  backspace,
  deleteForward,
  moveLeft,
  moveRight,
  moveHome,
  moveEnd,
  moveUp,
  moveDown,
  applyEnter,
  insertNewline,
  visualCursor,
  lines,
  type InputState,
} from "../../../src/ui/ink/inputBuffer";

function type(state: InputState, text: string): InputState {
  return insertText(state, text);
}

describe("inputBuffer (pure multi-line composer model)", () => {
  it("starts empty with the cursor at 0", () => {
    const s = initialInputState();
    expect(s).toEqual({ value: "", cursor: 0 });
  });

  it("inserts text at the cursor and advances it", () => {
    let s = type(initialInputState(), "hello");
    expect(s).toEqual({ value: "hello", cursor: 5 });
    s = insertText({ value: "helo", cursor: 3 }, "l"); // insert in the middle: "hel|o" -> "hell|o"
    expect(s).toEqual({ value: "hello", cursor: 4 });
  });

  it("backspace removes the character before the cursor and is a no-op at position 0", () => {
    expect(backspace({ value: "hello", cursor: 5 })).toEqual({ value: "hell", cursor: 4 });
    expect(backspace({ value: "hello", cursor: 0 })).toEqual({ value: "hello", cursor: 0 });
  });

  it("deleteForward removes the character at the cursor and is a no-op at the end", () => {
    expect(deleteForward({ value: "hello", cursor: 0 })).toEqual({ value: "ello", cursor: 0 });
    expect(deleteForward({ value: "hello", cursor: 5 })).toEqual({ value: "hello", cursor: 5 });
  });

  it("moveLeft/moveRight clamp at the buffer edges", () => {
    expect(moveLeft({ value: "ab", cursor: 0 })).toEqual({ value: "ab", cursor: 0 });
    expect(moveRight({ value: "ab", cursor: 2 })).toEqual({ value: "ab", cursor: 2 });
    expect(moveLeft({ value: "ab", cursor: 1 })).toEqual({ value: "ab", cursor: 0 });
    expect(moveRight({ value: "ab", cursor: 0 })).toEqual({ value: "ab", cursor: 1 });
  });

  it("moveHome/moveEnd operate on the current visual line, not the whole buffer", () => {
    const s: InputState = { value: "foo\nbarbaz\nqux", cursor: 7 }; // middle of "barbaz" (index 7 = 'r')
    expect(moveHome(s)).toEqual({ value: s.value, cursor: 4 }); // start of "barbaz"
    expect(moveEnd(s)).toEqual({ value: s.value, cursor: 10 }); // end of "barbaz"
  });

  it("moveUp/moveDown preserve column when possible and clamp on shorter lines", () => {
    const s: InputState = { value: "short\nlongerline", cursor: 3 }; // col 3 on "short"
    const down = moveDown(s);
    expect(down.cursor).toBe(6 + 3); // "short\n" is 6 chars, + col 3 into "longerline"

    const s2: InputState = { value: "longerline\nsh", cursor: 8 }; // col 8 on first line
    const down2 = moveDown(s2);
    expect(down2.cursor).toBe(11 + 2); // "sh" only has 2 chars, clamp to its end

    // moving up from the first line is a no-op
    expect(moveUp({ value: "abc", cursor: 2 })).toEqual({ value: "abc", cursor: 2 });
    // moving down from the last line is a no-op
    expect(moveDown({ value: "abc", cursor: 2 })).toEqual({ value: "abc", cursor: 2 });
  });

  it("Enter submits by default", () => {
    const s: InputState = { value: "hello", cursor: 5 };
    const { state, submit } = applyEnter(s);
    expect(submit).toBe("hello");
    expect(state).toBe(s); // unchanged
  });

  it("a trailing backslash before Enter continues onto a new line instead of submitting", () => {
    const s: InputState = { value: "line one\\", cursor: 9 };
    const { state, submit } = applyEnter(s);
    expect(submit).toBeNull();
    expect(state.value).toBe("line one\n");
    expect(state.cursor).toBe(9); // stays right after the inserted newline
  });

  it("insertNewline always inserts, never submits", () => {
    const s = insertNewline({ value: "ab", cursor: 1 });
    expect(s).toEqual({ value: "a\nb", cursor: 2 });
  });

  it("visualCursor reports 0-indexed {line, col}", () => {
    expect(visualCursor({ value: "abc", cursor: 2 })).toEqual({ line: 0, col: 2 });
    expect(visualCursor({ value: "ab\ncd", cursor: 4 })).toEqual({ line: 1, col: 1 });
    expect(visualCursor({ value: "ab\ncd", cursor: 3 })).toEqual({ line: 1, col: 0 });
  });

  it("lines() splits the buffer for rendering", () => {
    expect(lines({ value: "a\nb\nc", cursor: 0 })).toEqual(["a", "b", "c"]);
    expect(lines(initialInputState())).toEqual([""]);
  });
});
