/**
 * A minimal in-place terminal spinner for a long-running step (an external CLI worker call can take
 * anywhere from seconds to several minutes) — without it, the terminal just sits on the last log
 * line with a bare blinking cursor and no indication anything is still happening.
 *
 * Deliberately simple and safe rather than fully general: workers can run in parallel (master plan
 * §10), and two spinners animating the same terminal line at once would just corrupt each other's
 * output. Only one spinner is ever active at a time (a module-level flag) — a second concurrent call
 * just runs its work without animating, which is a plain, correct fallback (identical to today's
 * behavior), not a broken one.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 100;

let active = false;

/**
 * Lets an interactive UI (the home screen's inline "Running: <task>" view) take over rendering the
 * current frame itself instead of the spinner writing raw \r-based ANSI directly to stdout — the two
 * don't mix: a full-screen redraw and a line that rewrites itself independently on a timer will
 * fight over the same terminal region. When set, withSpinner calls this with each frame's text (and
 * `undefined` once the work finishes) instead of touching the terminal on its own.
 */
let sink: ((frame: string | undefined) => void) | undefined;

export function setSpinnerSink(fn: ((frame: string | undefined) => void) | undefined): void {
  sink = fn;
}

/** True only while this module's own spinner is actively animating — exported so a caller that's
 * about to print its own log line can clear the spinner's line first instead of writing over it. */
export function isSpinnerActive(): boolean {
  return active;
}

export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (sink) return withSpinnerSink(label, sink, fn);
  if (!process.stdout.isTTY || active) return fn();

  active = true;
  let frame = 0;
  const start = Date.now();
  const render = () => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`\r\x1b[2K${FRAMES[frame % FRAMES.length]} ${label} (${elapsed}s)`);
    frame++;
  };
  render();
  const timer = setInterval(render, FRAME_MS);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
    process.stdout.write("\r\x1b[2K"); // erase the spinner line entirely before the next log line
    active = false;
  }
}

async function withSpinnerSink<T>(label: string, sinkFn: (frame: string | undefined) => void, fn: () => Promise<T>): Promise<T> {
  let frame = 0;
  const start = Date.now();
  const render = () => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    sinkFn(`${FRAMES[frame % FRAMES.length]} ${label} (${elapsed}s)`);
    frame++;
  };
  render();
  const timer = setInterval(render, FRAME_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    sinkFn(undefined);
  }
}
