import React from "react";
import { render } from "ink";
import { InkApp, type InkAppProps } from "./InkApp";
import { initialInputState, type InputState } from "./inputBuffer";

export type RunInkAppOptions = InkAppProps;

export interface RunInkAppResult {
  /** True when this call is returning because a terminal resize settled (see the long comment
   * below), not because the app actually exited (`/quit`, `/exit`, Ctrl+C, or `onSubmit` returning
   * `null`). The host (`runInkInteractive` in `src/cli/run.ts`) is expected to clear the screen and
   * call `runInkApp` again with `initialHistory` (unchanged) and `initialInput: input` so the
   * conversation and composer draft carry forward into the fresh mount. */
  resized: boolean;
  /** True when Shift+Tab cycled the agent while the welcome banner was still visible, requiring a
   * clean replay so the static banner's agent description updates in place. */
  agentCycled: boolean;
  /** The composer's draft at the moment of a resize-triggered return — only meaningful when
   * `resized` or `agentCycled` is true. */
  input?: InputState;
}

/** True only when stdin is a real, raw-mode-capable TTY — Ink's `useInput` (used throughout
 * `src/ui/ink/`) throws synchronously on mount otherwise (piped input, `--non-interactive`, most
 * CI runners). Checked up front so that case fails with one clear line instead of a React stack
 * trace. */
function canUseInkTui(): boolean {
  return Boolean(process.stdin.isTTY) && process.stdin.setRawMode !== undefined;
}

/**
 * Boots the Ink-based interactive shell (`--tui=ink`). The welcome banner is drawn by `InkApp`
 * itself (`WelcomeBanner`, shown only when `options.showWelcome` is set) rather than printed here
 * via plain `console.log` — it used to be the latter, but that meant it lived outside Ink's own
 * tree while the chat transcript (also real, permanent terminal output — see `Transcript`) lived
 * inside it, for no real benefit.
 *
 * Resolves once the app exits for real (Ctrl+C, or `onSubmit` returning `null`) — `{ resized:
 * false }` — or once a terminal resize has settled and this instance has unmounted itself to force
 * a clean repaint — `{ resized: true, input }` (see the comment below).
 *
 * ## Why a resize needs any of this at all
 *
 * Ink tracks how many terminal rows its last frame occupied by counting "\n"s in the string it
 * wrote (`log-update.js`'s `previousLineCount`, private to one `Ink` instance) — it has no way of
 * knowing when a *terminal width* change means that same content would now wrap onto a different
 * number of real rows, because that count was only ever true for the *old* width. The next redraw
 * then erases the wrong number of rows relative to where the cursor actually is, leaving fragments
 * of the previous frame behind (confirmed against Ink's own source, and against a real terminal
 * resize on the device — https://github.com/vadimdemedes/ink/issues/907, a long-standing,
 * acknowledged-unfixed upstream limitation). There's no public API to reset that count, so the only
 * *provably* clean state is a brand-new `Ink` instance — `render()` only creates one when nothing is
 * already registered for this `stdout`, and `unmount()` deletes that registration on its way out.
 * `runInkInteractive` (`src/cli/run.ts`) already uses exactly that recipe (unmount, clear the real
 * screen, mount fresh with `initialHistory`) for the `/command` round-trip; this reuses it for a
 * resize instead of inventing a second one.
 *
 * ## Why that alone still isn't enough
 *
 * Doing the unmount+remount only *after* a resize "settles" (stops firing for a bit) leaves a gap:
 * from the *first* resize event of a drag until it settles, Ink's own internal resize handler
 * (`Ink.resized()`) keeps firing on every single event and redrawing immediately, using the exact
 * buggy incremental path described above — so the corruption is still genuinely written to the
 * terminal and visible for that whole window, even though it gets wiped away cleanly the instant
 * this function's own fix kicks in. A real click-and-drag resize fires many of these events in a
 * burst, so that's a very real, visible flash of leftover fragments while the mouse is still moving
 * — confirmed on the device: "terminal size choto korle eyta ekbar dekhasse then abar thik hoya
 * jacce" ("shrinking the terminal shows this once, then it fixes itself").
 *
 * The fix is to stop *any* of those intermediate frames from reaching the real terminal in the
 * first place: for as long as a resize is "in progress" (from the first event of a burst until it
 * settles), `stdout.write` is temporarily replaced with a no-op, so Ink's own per-event redraws
 * still happen internally (harmless — they only update its private bookkeeping) but never actually
 * reach the screen. The terminal's own display simply doesn't change while the window is being
 * dragged — no new fragments can appear because nothing is being written — and the moment the drag
 * settles, the real `write` is restored, the (now fully unmounted, per the recipe above) instance's
 * leftover frame is cleared, and a fresh mount paints the correct picture once, cleanly, at the
 * terminal's final size. This intentionally does *not* try to keep the screen visually live during
 * the drag itself (which Ink's own architecture doesn't support doing correctly, per the above) —
 * only to make sure nothing corrupted is ever actually shown, matching what a real terminal resize
 * of a well-behaved app looks like: the content stays put, then snaps to the new size once you let
 * go, rather than visibly falling apart while you're still moving the mouse.
 *
 * `pending` (whether a reply is in flight) delays the actual unmount, retried every 300ms rather
 * than firing immediately once the resize settles: `onSubmit`'s promise lives in
 * `runInkInteractive`'s own closure, not inside `InkApp`, so it keeps running across the unmount and
 * still reaches the persistent `chatHistory` correctly — but the *mounted* instance's own
 * `history`/`pending` state would simply stop updating once torn down, silently dropping that reply
 * from the screen until some later remount happened to pick it up via `initialHistory`. Waiting for
 * `pending` to clear first avoids that (writes stay suppressed the whole time, so there's nothing
 * to see regardless).
 */
export async function runInkApp(options: RunInkAppOptions): Promise<RunInkAppResult> {
  if (!canUseInkTui()) {
    console.error(
      "--tui=ink needs a real interactive terminal (raw-mode stdin) — this one doesn't have it " +
        "(piped input, --non-interactive, or a non-TTY runner). Falling back is automatic for " +
        "everything else; for this shell specifically, drop --tui or pass --tui=legacy.",
    );
    return { resized: false, agentCycled: false };
  }

  const stdout = process.stdout;
  const liveStatusRef = { current: { input: options.initialInput ?? initialInputState(), pending: false } };

  let resized = false;
  let agentCycled = false;
  let suppressing = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const instanceRef: { current?: ReturnType<typeof render> } = {};
  const requestAgentCycleRemount = (): void => {
    agentCycled = true;
    instanceRef.current?.unmount();
  };
  const instance = render(React.createElement(InkApp, { ...options, liveStatusRef, onAgentCycleRemount: requestAgentCycleRemount }));
  instanceRef.current = instance;
  // Not `.bind(stdout)`'d — this is only ever reassigned straight back onto `stdout.write` below
  // (never called directly by this code), so keeping the original, unbound function means calling
  // it later as `stdout.write(...)` gets the correct `this` from that normal method-call syntax,
  // same as before it was ever swapped out.
  const originalWrite = stdout.write;

  const beginSuppressing = (): void => {
    if (suppressing) return;
    suppressing = true;
    stdout.write = (() => true) as typeof stdout.write;
  };
  const stopSuppressing = (): void => {
    if (!suppressing) return;
    suppressing = false;
    stdout.write = originalWrite;
  };

  const attemptUnmount = (): void => {
    if (liveStatusRef.current.pending) {
      settleTimer = setTimeout(attemptUnmount, 300);
      return;
    }
    resized = true;
    instance.unmount(); // still writing into the suppressed stdout — see stopSuppressing() below
  };
  const onResizeEvent = (): void => {
    beginSuppressing();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(attemptUnmount, 220);
  };
  // `prependListener`, not `on`: `render()` above already registered Ink's own `resized` listener
  // on this same `stdout`, and `EventEmitter` calls listeners in registration order — `on` would run
  // *after* Ink's, meaning the very first resize event of every burst would still reach the real
  // terminal (one write, before suppression turns on) before this ever gets a chance to stop it.
  // Prepending puts this one first, so suppression is already active before Ink's own handler runs,
  // for every event including the first.
  stdout.prependListener("resize", onResizeEvent);

  await instance.waitUntilExit();

  stdout.off("resize", onResizeEvent);
  if (settleTimer) clearTimeout(settleTimer);
  stopSuppressing(); // restore the real stdout.write *before* painting the post-resize clear below
  if (resized) {
    // Safe here for the same reason it's safe after the `/command` round-trip: the old instance is
    // now fully unmounted (its `render()`-tracked state discarded), and the caller's next
    // `runInkApp` mounts fresh with `initialHistory`/`initialInput`, immediately repainting
    // everything — nothing is actually lost, just repainted once, cleanly, at the terminal's
    // current size.
    stdout.write("\x1b[2J\x1b[3J\x1b[H");
  }
  return { resized, agentCycled, input: resized || agentCycled ? liveStatusRef.current.input : undefined };
}
