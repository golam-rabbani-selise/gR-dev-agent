/**
 * Pure, framework-free editing model for the Ink multi-line composer (`MultilineInput.tsx`).
 * Kept separate from any Ink/React code so the actual editing rules (cursor movement, line
 * wrapping, newline insertion) can be unit-tested directly, without rendering a terminal.
 *
 * The whole buffer is one string with embedded "\n"s; the cursor is a single offset into it
 * (0..value.length) rather than a separate {line, col} pair — simpler to reason about and to
 * keep in sync than a lines array, at the cost of doing a small amount of `\n`-scanning per
 * operation (buffers here are a few lines of chat input, not a document, so this is cheap).
 */
export interface InputState {
  value: string;
  cursor: number;
}

export function initialInputState(): InputState {
  return { value: "", cursor: 0 };
}

function clampCursor(value: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, value.length));
}

/** Insert `text` at the cursor (used for both a single typed character and a paste). */
export function insertText(state: InputState, text: string): InputState {
  if (text === "") return state;
  const cursor = clampCursor(state.value, state.cursor);
  const value = state.value.slice(0, cursor) + text + state.value.slice(cursor);
  return { value, cursor: cursor + text.length };
}

/** Backspace: delete the character before the cursor. */
export function backspace(state: InputState): InputState {
  const cursor = clampCursor(state.value, state.cursor);
  if (cursor === 0) return state;
  const value = state.value.slice(0, cursor - 1) + state.value.slice(cursor);
  return { value, cursor: cursor - 1 };
}

/** Delete (forward-delete): remove the character at the cursor. */
export function deleteForward(state: InputState): InputState {
  const cursor = clampCursor(state.value, state.cursor);
  if (cursor >= state.value.length) return state;
  const value = state.value.slice(0, cursor) + state.value.slice(cursor + 1);
  return { value, cursor };
}

export function moveLeft(state: InputState): InputState {
  return { ...state, cursor: clampCursor(state.value, state.cursor - 1) };
}

export function moveRight(state: InputState): InputState {
  return { ...state, cursor: clampCursor(state.value, state.cursor + 1) };
}

function lineStart(value: string, cursor: number): number {
  const before = value.lastIndexOf("\n", cursor - 1);
  return before === -1 ? 0 : before + 1;
}

function lineEnd(value: string, cursor: number): number {
  const after = value.indexOf("\n", cursor);
  return after === -1 ? value.length : after;
}

/** Move to the start of the current visual line (not the whole buffer). */
export function moveHome(state: InputState): InputState {
  const cursor = clampCursor(state.value, state.cursor);
  return { ...state, cursor: lineStart(state.value, cursor) };
}

/** Move to the end of the current visual line (not the whole buffer). */
export function moveEnd(state: InputState): InputState {
  const cursor = clampCursor(state.value, state.cursor);
  return { ...state, cursor: lineEnd(state.value, cursor) };
}

/** Move up one line, keeping the same column when the previous line is at least as long. */
export function moveUp(state: InputState): InputState {
  const cursor = clampCursor(state.value, state.cursor);
  const curStart = lineStart(state.value, cursor);
  if (curStart === 0) return state; // already on the first line
  const col = cursor - curStart;
  const prevEnd = curStart - 1; // the "\n" just before this line
  const prevStart = lineStart(state.value, prevEnd);
  const prevLen = prevEnd - prevStart;
  return { ...state, cursor: prevStart + Math.min(col, prevLen) };
}

/** Move down one line, keeping the same column when the next line is at least as long. */
export function moveDown(state: InputState): InputState {
  const cursor = clampCursor(state.value, state.cursor);
  const curStart = lineStart(state.value, cursor);
  const curEnd = lineEnd(state.value, cursor);
  if (curEnd === state.value.length) return state; // already on the last line
  const col = cursor - curStart;
  const nextStart = curEnd + 1; // just past the "\n"
  const nextEnd = lineEnd(state.value, nextStart);
  const nextLen = nextEnd - nextStart;
  return { ...state, cursor: nextStart + Math.min(col, nextLen) };
}

export function clear(): InputState {
  return initialInputState();
}

/**
 * Enter was pressed: decide submit vs. insert-newline-and-continue.
 *
 * Convention (matches common shell/chat-CLI backslash-continuation): a trailing "\" immediately
 * before the cursor means "continue on a new line" — the backslash is consumed, a "\n" takes its
 * place, and the cursor stays at the end of composing. Anything else submits.
 */
export function applyEnter(state: InputState): { state: InputState; submit: string | null } {
  const cursor = clampCursor(state.value, state.cursor);
  if (cursor > 0 && state.value[cursor - 1] === "\\") {
    const value = state.value.slice(0, cursor - 1) + "\n" + state.value.slice(cursor);
    return { state: { value, cursor }, submit: null };
  }
  return { state, submit: state.value };
}

/** Explicit newline insertion (Ctrl+J / Alt+Enter, when the terminal passes it through distinctly
 * from a plain Enter) — always inserts, never submits. */
export function insertNewline(state: InputState): InputState {
  return insertText(state, "\n");
}

/** {line, col} of the cursor, for rendering — 0-indexed. */
export function visualCursor(state: InputState): { line: number; col: number } {
  const cursor = clampCursor(state.value, state.cursor);
  const before = state.value.slice(0, cursor);
  const line = (before.match(/\n/g) ?? []).length;
  const col = cursor - lineStart(state.value, cursor);
  return { line, col };
}

export function lines(state: InputState): string[] {
  return state.value.split("\n");
}
