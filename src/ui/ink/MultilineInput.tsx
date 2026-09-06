import React from "react";
import { Box, Text, useInput } from "ink";
import {
  type InputState,
  insertText,
  backspace,
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
} from "./inputBuffer";
import { useTerminalSize } from "./useTerminalSize";

export interface MultilineInputProps {
  state: InputState;
  onChange: (next: InputState) => void;
  /** Called with the submitted text; the caller owns clearing the buffer afterwards (so it can
   * decide whether to keep it, e.g. on a failed submit). */
  onSubmit: (text: string) => void;
  placeholder?: string;
  /** Disabled while a reply is in flight — keystrokes are swallowed instead of edited into the
   * buffer, same idea as the legacy composer's captureStdinWhilePending. */
  disabled?: boolean;
  /** True while the slash-command popover is open — Up/Down are left to the popover instead of
   * moving the cursor between lines. */
  suppressVerticalNav?: boolean;
  /** True when Enter should be left to InkApp's popover useInput (it will complete the highlighted
   * match, e.g. "/wo" -> "/workers ") instead of submitting here. False even while the popover is
   * open once what's typed is already an exact match (e.g. "/quit") — otherwise a fully-typed
   * command would silently "complete" to itself instead of submitting on the first Enter. */
  interceptEnter?: boolean;
  /** Shift+Tab is owned by the shell, not the text buffer: cycle to the next active agent. */
  onCycleAgent?: () => void;
}

/**
 * A real multi-line text composer for Ink, built on the pure `inputBuffer` model rather than
 * `ink-text-input` (which is single-line only). Enter submits; a trailing "\" before Enter
 * continues onto a new line (shell-style continuation); Ctrl+J always inserts a literal newline
 * regardless of trailing "\" (an explicit escape hatch for terminals that pass it through).
 */
export function MultilineInput({
  state,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  suppressVerticalNav,
  interceptEnter,
  onCycleAgent,
}: MultilineInputProps): React.ReactElement {
  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.tab && key.shift) {
        onCycleAgent?.();
        return;
      }
      if (key.return) {
        if (interceptEnter) return; // InkApp's popover useInput completes the highlighted match instead
        const { state: next, submit } = applyEnter(state);
        if (submit !== null) {
          onSubmit(submit);
        } else {
          onChange(next);
        }
        return;
      }
      // Ctrl+J: most terminals deliver this as a plain "\n" byte distinct from the return key.
      if (key.ctrl && input === "j") {
        onChange(insertNewline(state));
        return;
      }
      // Ink (see node_modules/ink/build/parse-keypress.js) maps the physical Backspace key's
      // actual byte (\x7f, DEL) to `key.delete`, not `key.backspace` — only Ctrl+H (\x08) sets
      // `key.backspace`. A real forward-delete (Fn+Delete sending "\x1b[3~") lands on the exact
      // same `key.delete` flag with nothing to tell them apart, so — matching how every terminal
      // app treats this in practice — both are handled as backspace (delete before cursor); with
      // no distinguishing signal, that's the read that matches what almost everyone means when
      // they hit this key while typing.
      if (key.backspace || key.delete) {
        onChange(backspace(state));
        return;
      }
      if (key.leftArrow) {
        onChange(moveLeft(state));
        return;
      }
      if (key.rightArrow) {
        onChange(moveRight(state));
        return;
      }
      if (key.upArrow) {
        if (!suppressVerticalNav) onChange(moveUp(state));
        return;
      }
      if (key.downArrow) {
        if (!suppressVerticalNav) onChange(moveDown(state));
        return;
      }
      if (key.ctrl && input === "a") {
        onChange(moveHome(state));
        return;
      }
      if (key.ctrl && input === "e") {
        onChange(moveEnd(state));
        return;
      }
      if (key.ctrl && input === "u") {
        onChange({ value: "", cursor: 0 });
        return;
      }
      if (key.meta || key.ctrl) return; // ignore other control/meta combos rather than inserting them literally
      if (input) onChange(insertText(state, input));
    },
    { isActive: !disabled },
  );

  const rows = lines(state);
  const { line: cursorLine, col: cursorCol } = visualCursor(state);
  const showPlaceholder = state.value === "" && placeholder;
  const { columns } = useTerminalSize();

  return (
    <Box flexDirection="column">
      {/* Top AND bottom ruled lines instead of a full `borderStyle="round"` box (that's what this
       * was until a real macOS Terminal.app window drag showed why not — see the long comment on
       * `runInkApp` for the write-suppression fix this pairs with). Suppressing every write during
       * an active resize means the terminal simply displays whatever was last drawn, frozen, until
       * the drag settles — and a four-cornered box frozen mid-resize very visibly reads as "broken"
       * (misaligned corners, a stray vertical bar floating in blank space) in a way two independent
       * repeated-"─" lines don't: with no vertical side-bars tying them together, the top and bottom
       * rules have nothing to visibly desync *against* — each can only ever look like "a line that
       * hasn't caught up to the new width yet," never a corner mismatch. Confirmed against a real
       * screen recording of the drag: the frozen-frame moment is still there either way (nothing
       * server-side can eliminate it without reintroducing the corruption bug this replaced — see
       * `runInkApp`), but it reads as far less broken without corners/side-bars. */}
      <Text color={disabled ? "gray" : "cyan"}>{"─".repeat(Math.max(1, columns))}</Text>
      {showPlaceholder ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        rows.map((row, i) => (
          <Text key={i}>
            {i === cursorLine ? (
              <>
                {row.slice(0, cursorCol)}
                <Text inverse>{row[cursorCol] ?? " "}</Text>
                {row.slice(cursorCol + 1)}
              </>
            ) : (
              row || " "
            )}
          </Text>
        ))
      )}
      <Text color={disabled ? "gray" : "cyan"}>{"─".repeat(Math.max(1, columns))}</Text>
    </Box>
  );
}
