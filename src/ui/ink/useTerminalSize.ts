import { useEffect, useState } from "react";
import { useStdout } from "ink";

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Ink's own resize handling (`Ink.resized()` in `ink/build/ink.js`) recalculates Yoga's layout and
 * re-renders the Ink-DOM tree, but it does that independently of React — it doesn't re-invoke our
 * function components, so any *string* we've derived ourselves at a specific width (see the footer
 * in `InkApp`) would stay stale after a resize unless something actually triggers a React
 * re-render. This hook is that something: it subscribes directly to `stdout`'s `'resize'` event and
 * pushes a state update, which is what gets components using it to re-run with the new
 * `columns`/`rows`.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>({
    columns: stdout.columns || 80,
    rows: stdout.rows || 24,
  });

  useEffect(() => {
    const onResize = (): void => {
      setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}
