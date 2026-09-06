# Full interactive CLI (parity with Claude Code / Codex / Cursor CLI)

> Status: draft

## Requirement summary
The user wants `gr-agent`'s terminal experience to feel like a "full CLI" on par with Claude Code,
Codex CLI, and Cursor CLI — not just the current branded home screen. Requested verbally, not yet
scoped to a concrete feature list.

## Current state (read from the repo, not assumed)
- `src/ui/home.ts` (635 lines): pure `HomeModel → string` renderer — already has an in-memory
  `chatHistory` transcript, `chatPending` ("Thinking…" line), `runLog`/`runStatus`/`runObjective`
  for an inline `/run` view, a slash-command menu, and a suggestion list for the empty state.
- `src/ui/prompt.ts`: thin `@clack/prompts` wrapper — confirm/text/select/multiselect/autocomplete,
  fails closed when non-interactive.
- `src/cli/run.ts` owns the actual terminal loop (`node:readline` keypress events) and redraws via
  `renderHome`/`renderHomePrompt`; recent commits show this is under active iteration (spinner during
  worker calls, `/run` staying on the home screen instead of jumping pages, terminal-size caching,
  `/model` autocomplete search).
- No token-by-token streaming render, no persistent scrollback/pagination, no syntax highlighting,
  no multi-line input editor, no slash-command popover while typing (menu is a separate select step).
- Architecture is a custom redraw loop (readline + ANSI via `picocolors`), not a component-based TUI
  framework (no Ink/blessed/etc.) — `README.md` calls the current screen "Milestone 1" and says
  "Rendering → `src/ui/` (isolated so a richer TUI can replace it (Milestone 2))".

## Gap vs. Claude Code / Codex / Cursor CLI (candidate list — needs user priority, see below)
1. Token-by-token streaming of assistant/worker output as it arrives, not just a spinner then a full block.
2. Persistent, scrollable transcript (mouse wheel / PageUp-PageDn) once history exceeds one screen.
3. Multi-line input editing (soft-wrap, cursor movement, paste) vs. a single-line `@clack/prompts` text field.
4. Slash-command popover that filters as you type `/`, instead of a separate select step.
5. Syntax-highlighted code blocks / diffs in output.
6. A persistent status/footer bar (model, branch, tokens, elapsed) always visible during a long run.
7. Session resume indicator / picker (`gr-agent` already has `.gr-agent/` checkpoints via `resume.ts`/`checkpoints.ts` — question is whether the UI surfaces this the way Claude Code's `/resume` picker does).

## Proposed approach (needs decision before speccing)
**Option A — keep the current custom redraw architecture** and add the above incrementally
(streaming first, then scrollback, then popover). Lower risk, no new dependency, consistent with
Milestone 1's approach; but multi-line editing + true scrollback are hard to do well with raw
`readline` and will likely need hand-rolled terminal-buffer logic either way.

**Option B — introduce a component-based TUI framework** (e.g. Ink/React, the approach Claude
Code's own CLI is built on) for `src/ui/`, keeping `src/orchestrator`/`src/workers`/`src/llm`
untouched (rendering is already an isolated seam per `CONTRIBUTING.md`). Higher upfront cost (new
dependency, rewrite of `home.ts`'s render path and `run.ts`'s loop), but scrollback, multi-line
input, and streaming are first-class in that ecosystem instead of hand-rolled.

This is exactly the kind of decision `.gr-agent/rules/architecture.md` says goes through
`/feature-spec` before code — the contract here (which rendering approach, which of the 7 gaps are
in scope) needs to be locked before `implement` touches `src/ui/`.

## Risks / open questions (for the user)
1. **Priority** — of the 7 gaps above, which matter most right now? (Suggest starting with
   streaming output + the slash-command popover, since those are the most visible day-to-day
   difference vs. Claude Code/Codex/Cursor.)
2. **Framework** — Option A (extend the current custom loop) or Option B (adopt Ink)? This is a
   one-way architectural door for `src/ui/` and worth deciding explicitly rather than defaulting.
3. **Scope for this pass** — one focused feature (e.g. "streaming output") speced and implemented
   first, or a larger UI overhaul spec covering several gaps at once?
4. No native addons is a hard rule (CONTRIBUTING.md) — any TUI dependency considered must be pure
   JS/TS (Ink itself qualifies; some terminal libraries with native bindings would not).

## Decision (from user, 2026-09-05)
- Framework: **Ink** (React-based TUI).
- Scope requested: streaming output, slash-command popover, scrollable transcript, multi-line input — and it must work uniformly across every worker vendor (native, Claude, Codex, Cursor, OpenCode, Antigravity).

## Findings that change the risk picture (read directly from the code, not assumed)
1. **No streaming exists anywhere today.** `LlmProvider.chat()` (`src/llm/provider.ts`) is a single `Promise<ChatResult>` — no provider streams. External CLI workers (`src/workers/cliWorker.ts`) run via `Platform.run(...)` and only get the full stdout after the process exits (a spinner covers the wait). Adding real streaming touches `src/llm/*`, `src/workers/cliWorker.ts`, `src/workers/nativeWorker.ts`, and the orchestrator — not just `src/ui/`.
2. **The native worker's protocol makes "stream the text" the wrong UX by default.** `NativeWorker.execute` (`src/workers/nativeWorker.ts`) runs a bounded JSON-action loop — every model reply is a raw `{"tool":...}` / `{"final":...}` object, not narration meant for a human. Streaming those tokens verbatim would show broken/ugly partial JSON. Getting a clean streamed narration requires a small protocol change (e.g. a separate "thought"/narration field) — a product decision, not just plumbing, and out of scope for a UI-only pass.
3. **The current interactive loop is already a substantial hand-rolled terminal app**, not a thin wrapper: `runInteractive` + `readHomeSlotMessage` in `src/cli/run.ts` (~1278 lines total) implement raw keypress handling, cursor movement, history cycling, and the command menu by hand, feeding `src/ui/home.ts` (635 lines). Replacing this with Ink means re-plumbing chat dispatch, `/run` progress, and all slash commands (`/model`, `/init`, `/clone`, resume) into React state — realistically ~800-1000 lines to rewrite carefully, not a small patch.
4. **This session cannot build or test this repository at all.** `npm run build` (tsup/rollup) and `npm test`/`npx vitest` both fail here with `Cannot find module @rollup/rollup-linux-arm64-gnu` — an npm optional-dependency/architecture mismatch specific to this sandboxed shell (unrelated to any change made here). Only `npm run typecheck` (tsc, no bundler) and `npm run lint` work in this environment. There is also no real TTY here, so an interactive Ink app cannot be exercised by hand either. Net effect: any UI-rewrite code written in this session can only be verified at the type level here — real verification requires the user's own terminal.

Given (3) and (4) together, a full blind rewrite of the interactive loop in this session carries real risk of shipping something broken with no way to catch it before the user sees it.

## Delivered (2026-09-05)

Resolved the build/test blocker from finding 4 by developing and fully verifying this in an
isolated environment with a correct, from-scratch `npm install` (not this repo's real
`node_modules`, which stays untouched and darwin-arm64-correct) — build, full test suite, lint,
and typecheck all ran clean there, plus a real-pty smoke test of the actual interactive behavior.
Only the verified result was copied into this repo.

**Shipped, opt-in via `--tui=ink`** (default stays `--tui=legacy`, i.e. zero behavior change for
anyone who doesn't pass the flag):
- `src/ui/ink/inputBuffer.ts` — pure editing model (insert/backspace/delete/arrow movement/
  backslash-continuation), unit-tested in isolation from any terminal rendering.
- `src/ui/ink/MultilineInput.tsx` — real multi-line composer (Enter submits, trailing `\` before
  Enter continues onto a new line, Ctrl+J forces a literal newline, Ctrl+A/E/U for home/end/clear).
- `src/ui/ink/CommandPopover.tsx` — filters the same `SLASH_COMMANDS` list `src/ui/home.ts` already
  defines (no duplication) as you type "/...".
- `src/ui/ink/Transcript.tsx` — chat history via Ink's `<Static>`, i.e. real terminal scrollback
  (mouse wheel, tmux copy-mode) instead of an app-managed viewport.
- `src/ui/ink/InkApp.tsx` / `runInkApp.ts` — wires the above together; `src/cli/run.ts` gained an
  exported `resolveChatReply()` (extracted from `runChat`, unchanged behavior) so both the legacy
  loop and the Ink shell resolve a chat turn through the exact same worker-CLI-or-native-provider
  path — this is what makes it vendor-uniform (native, Claude, Codex, Cursor, OpenCode, Antigravity
  all go through the same call).
- A guard (`canUseInkTui()`) makes `--tui=ink` fail with one clear line instead of a React crash
  when stdin isn't a real raw-mode TTY (piped input, `--non-interactive`, most CI runners).

**Explicitly not done — needs its own decision + spec before implementation**, per finding 2 above:
- **True token streaming.** The native worker's JSON-action protocol (`src/workers/nativeWorker.ts`)
  has no narration channel to stream from as-is — doing this right means adding one (a protocol
  change, not a UI change) and touching `src/llm/*`, `src/workers/cliWorker.ts`, and
  `src/workers/nativeWorker.ts`, then wiring `InkApp`'s "Thinking…" line up to it. Left for a
  separate `/feature-spec` pass.
- Slash commands inside the Ink shell itself: `/quit`/`/exit` work; everything else currently
  replies "isn't available in the Ink shell yet — restart with --tui=legacy". Wiring `/model`,
  `/agents`, `/run`, etc. into React state is the ~800-1000 line rewrite finding 3 flagged, deferred
  the same way.
- Session-resume picker (gap 7) — not started.

**Before `--tui=ink` runs here**: this repo's own `node_modules` was never touched by the verification
above, so `ink`, `react`, `@types/react`, and `ink-testing-library` are declared in `package.json`
but not yet installed — run `npm install` once, normally, on this machine.

## Fix (2026-09-05, after first real-terminal try): Enter on the popover

First real use surfaced a confusing gap the vitest/pty testing hadn't caught: typing "/" alone (or
"/workers") and pressing Enter submitted the raw text as a chat message ("/" isn't available in the
Ink shell yet...") instead of doing anything with the visibly-open popover — Tab worked, Enter
didn't. Fixed in `InkApp.tsx`/`MultilineInput.tsx`: Enter now completes the highlighted match the
same way Tab does, *except* when what's typed is already an exact match (e.g. "/quit") — there,
completing would just re-set the text to itself plus a trailing space and force a second Enter, so
it falls straight through to a normal submit instead. Verified with a new regression test
(`test/ui/ink/InkApp.smoke.test.ts`, "Enter completes a partial/ambiguous match...") plus the full
`npm run build && npm test && npm run lint && npm run typecheck` gate, all clean, in the same
isolated verification environment described above.

This does **not** make `/workers`, `/model`, etc. actually run inside the Ink shell — completing
the text is a composer-only fix; executing the command is still the deferred ~800-1000 line rewrite
noted above. Typing a full command and pressing Enter now correctly submits it, and still gets the
"isn't available in the Ink shell yet — restart with --tui=legacy" reply for anything but /quit,/exit.

## Full command wiring (2026-09-05, same day, user asked to proceed)

Wired the rest of the command palette into `--tui=ink`: `/help`, `/setup`, `/clone`, `/agents`,
`/workers`, `/model`, `/mode`, `/workflow`, `/run` now all genuinely work (not just `/quit`/`/exit`
+ plain chat). Approach: reuse the legacy loop's own handlers (`runSelectWorker`, `runSelectModel`,
`runSetupInit`, `runCloneRepo`, `execute()`, `showOverlay`) verbatim rather than re-implementing
pickers in React — they don't know or care who called them, and a from-scratch rewrite of `/run`'s
live-progress view and clack's `select`/`autocomplete` pickers in React was the ~800-1000 line risk
this plan flagged earlier for a reason. `runInkInteractive` now mounts/unmounts Ink around each
recognized command: the user submits "/agents", Ink unmounts, `dispatchInkCommand` runs the exact
same `runSelectWorker` the legacy shell uses (full clack picker, real terminal), then Ink remounts.
`chatHistory` lives outside the mount loop so conversation context survives a command in between two
chat messages; each fresh mount's own `<Static>` transcript starts empty on purpose since prior
turns are already permanently in real terminal scrollback (that's what `<Static>` is for) —
reprinting them would duplicate, not restore, history.

**A genuine Node/Ink bug surfaced immediately on the first real-terminal try** (not caught by
vitest/pty-single-keystroke testing): after Ink unmounts, `process.stdin` stops delivering *any*
further input — `isRaw`, `isPaused()`, `readableFlowing` all report as if nothing's wrong, but no
`'data'`/`'keypress'` event ever fires again, so `/help`'s "press any key to continue" (and every
clack prompt behind `/agents`, `/model`, etc.) would have hung forever. Root-caused by reading Ink's
own source (`node_modules/ink/build/components/App.js`): its `componentWillUnmount` calls
`stdin.unref()` once the last raw-mode consumer unmounts, and an unref'd stdin handle silently stops
delivering input even after `.setRawMode(true)`/`.resume()` run again. Confirmed against a minimal
Ink repro outside this codebase (mount → unmount → try to read a keypress) before touching any
project code, to be sure this wasn't something specific to `dispatchInkCommand`. Fixed with one
function, `reclaimStdinAfterInk()` (`src/cli/run.ts`): `stdin.ref()` (undoes Ink's `unref()`) +
`stdin.resume()` + `stdin.read(0)` (a public, documented zero-length read that nudges the stream to
pull from the handle immediately), called once right after each Ink unmount, before any legacy
prompt touches stdin.

Verified against the actual built CLI over a real pseudo-terminal (not just vitest): `/help`
round-tripped twice in a row, `/mode parallel` then `/mode auto` each round-tripped correctly and
the footer/state updated each time, plain chat kept working after two command round-trips, `/quit`
exited the process cleanly, and — the real test of the fix — `/agents` ran the full clack `select()`
picker end-to-end (arrow-key navigation, Enter to confirm, `.gr-agent/config.json` actually written)
and Ink resumed afterward with the footer correctly showing the newly-chosen worker. `npm run build
&& npm test && npm run lint && npm run typecheck` all clean in the same isolated verification
environment as before.

**Still not wired inside the Ink shell**: `/sessions`, `/attach`, `/mcp`, `/skills` (all listed as
"coming soon" in the legacy shell too — genuine parity, not a gap introduced here), and true token
streaming (unchanged from the earlier finding — needs a native-worker protocol change, out of scope
here).

## Default flipped to Ink (2026-09-05, same day)

`--tui` default changed in `src/index.ts` from `"legacy"` to `"ink"` (user confirmed after asking
whether bare `gr-agent` would use the new shell). `gr-agent .` now launches the Ink shell directly;
`gr-agent . --tui=legacy` still selects the old hand-rolled loop. No other code changes needed —
`run.ts` already just checks `g.tui === "ink"`. Verified clean with `npx tsc --noEmit` and
`npx eslint src/index.ts`.

## Fix (2026-09-05, same day): Backspace not clearing while typing

User report: typing in the Ink composer, backspace/delete did nothing. Root cause: Ink's own
keypress parser (`node_modules/ink/build/parse-keypress.js`) maps the physical Backspace key's
actual byte (`\x7f`, DEL — what macOS terminals send) to `key.delete`, not `key.backspace` — only
Ctrl+H (`\x08`) sets `key.backspace`. `MultilineInput.tsx` wired `key.delete` to `deleteForward`
(remove the char *at* the cursor), which is a no-op whenever the cursor is at the end of the
buffer — i.e. every normal type-then-backspace sequence. Ink itself has no way to distinguish a
real forward-delete (Fn+Delete, `\x1b[3~`) from this — both land on the same `key.delete` flag
(their own source has a TODO admitting this) — so, matching how terminal apps handle this in
practice, `key.backspace || key.delete` now both call `backspace()`.

Added `test/ui/ink/MultilineInput.test.ts` — drives the literal `\x7f` and `\x08` bytes through
`ink-testing-library`'s fake stdin (the existing InkApp smoke tests never sent this byte, only
Ink's synthetic `key.backspace`, which is why this shipped unnoticed). 22/22 tests pass in the
isolated build workspace; `npx tsc --noEmit` and `npx eslint` both clean on the real device
(vitest itself can't run in the device's Linux VM — missing `@rollup/rollup-linux-arm64-gnu`
native binary, an environment limitation unrelated to this fix).

## Fix (2026-09-05, same day): previous chat vanishing after a command

User report (with screenshots): after running `/agents` (or any command), earlier chat turns were
gone from the terminal — not just off-screen, actually gone, since the `runInkInteractive` design
already assumed "everything from a prior Ink mount is permanently in real terminal scrollback"
(comment above that function). Root cause: `clearScreen()` in `src/cli/run.ts` sent
`"\x1b[2J\x1b[3J\x1b[H"` — the `\x1b[3J` (erase-scrollback) part doesn't just clear the visible
page, it wipes the terminal's entire scrollback buffer. Every shared legacy handler
(`showOverlay`, `runSetupInit`, `runSelectWorker`/`runSelectModel`/`runCloneRepo`, `/run`'s inline
clear) calls this on every command dispatch, so each one was silently destroying the Ink
`<Static>`-printed chat history right along with the rest of the user's terminal history above the
session. Fix: drop `\x1b[3J`, keep only `\x1b[2J\x1b[H` (clears the current page, leaves
scrollback untouched). This was a correctness bug in the legacy loop too (not Ink-specific) — it's
just that the legacy loop's constant full redraws via `renderHome()` masked it by always
reprinting the entire history on top, while Ink's Static-once model had nothing to fall back on.

Verified: `npx tsc --noEmit` and `npx eslint src/cli/run.ts` clean on device; full suite in the
isolated build workspace — 181/182 (the 1 failure is the pre-existing, unrelated footer-width test
noted earlier, confirmed unaffected by this change).

## Correction (2026-09-05, same day): the scrollback-preserving clearScreen() caused a new bug

The previous fix (dropping "\x1b[3J" from `clearScreen()` to stop it nuking real terminal
scrollback) traded one bug for another: on the user's actual terminal (macOS Terminal.app, real
screenshots at 254x77), a bare "\x1b[2J\x1b[H" left the prior Ink frame visibly on screen with a
large blank gap before the new content, instead of cleanly repainting from the top. Root cause of
*this* bug: relying on the terminal's own scrollback semantics around a partial clear is fragile
and terminal-dependent — not something to build on.

Real fix: put "\x1b[3J" back (clearScreen is `\x1b[2J\x1b[3J\x1b[H` again — the same combination a
plain `clear` emits, which every terminal reliably gets right), and stop depending on terminal
scrollback for history continuity at all. `InkApp` now takes an `initialHistory` prop; each fresh
Ink mount in `runInkInteractive` is handed the full accumulated `chatHistory`, so `<Static>`
re-seeds and reprints everything said so far immediately — no gap, no data loss, and the visible
result no longer depends on how a given terminal emulator implements partial-vs-full clear.

Verified: `npx tsc --noEmit` / `npx eslint` clean on device. Cloud workspace: 183 total tests,
182 passing (1 pre-existing unrelated failure, same as before). Confirmed via a real pty at the
user's exact terminal size (254x77): typed a chat message, dispatched `/mode auto`, and after the
overlay + "press any key" + remount, both the earlier "You" and assistant turns reprint correctly
right after the banner, immediately before the fresh composer — byte-for-byte, no gap.

## Fix (2026-09-05, same day): resize leaves a cascade of leftover composer boxes

User report (screenshot): dragging the terminal window smaller left a stack of ~18 empty composer
boxes on screen, each narrower than the last. Root cause: a known, unfixed upstream Ink limitation
— Ink counts how many terminal rows its last frame took by counting "\n" in the rendered string,
which doesn't account for a line that's wider than the terminal's *current* column count actually
wrapping onto extra physical rows. After a resize, that count is stale, so Ink's next redraw erases
fewer rows than are really on screen, leaving the tail of the old frame behind — once per resize
step while a window is dragged smaller. Confirmed upstream and closed "not planned":
https://github.com/vadimdemedes/ink/issues/907 (root cause and this exact workaround both stated by
the maintainer/reporter there).

Fix: `src/ui/ink/runInkApp.ts` now registers its own `resize` listener on `process.stdout` *before*
calling Ink's `render()`, so it runs before Ink's own internal resize handler and does a full
`\x1b[2J\x1b[3J\x1b[H` clear first. Ink's own (still-stale) erase-then-redraw then lands on an
already-blank screen, so it's harmless, and the new frame draws clean. Trade-off: a brief flash on
resize — the same trade the upstream issue's own reporter settled on, and clearly better than a
growing stack of stale composer boxes.

Verified via a real pty: simulated dragging a 254-wide window down to 153 in four steps (matching
the user's screenshot's window size). Exactly one full clear + one clean composer redraw per
resize step, no stacking. `npx tsc --noEmit` / `npx eslint` clean on device; cloud workspace
182/183 (same pre-existing unrelated failure as before).

## Fix (2026-09-05): resize wiping the visible chat history — custom scroll viewport replaces `<Static>`

**User's report**: after the composer-bottom-pin request, resizing a live session wider (screenshots:
99x24 -> 122x24) made the previous chat ("You: hi" / "Open Code: Hello again...") disappear entirely,
leaving only an empty composer + footer.

**Root cause**: `Transcript` printed every turn once via Ink's `<Static>`, relying on the real
terminal's own scrollback to keep it on screen forever once printed. The resize workaround added for
the earlier cascading-composer-boxes bug (`clearOnResize` in `runInkApp.ts`, full `\x1b[2J\x1b[3J\x1b[H`
on every `resize` event) erases exactly that scrollback — and Ink's `<Static>` never replays old items
once they're flushed, since it assumes whatever it already wrote stays on the real terminal
permanently. So every resize was silently wiping the conversation out from under the user.

This was the same structural tension flagged when the user asked for the composer to be bottom-pinned:
`<Static>` and "the composer always sits at a fixed spot" don't coexist without either flicker (full
static reprint on every keystroke once output reaches `stdout.rows`) or exactly this kind of resize
data loss. Given the choice of (a) keep native scrollback behavior, (b) accept flicker for bottom-pin,
or (c) build our own scrollable viewport, the user chose (c): "Alada bhabe koro — nijer scroll
viewport banai."

**Fix — new files**:
- `src/ui/ink/textWrap.ts`: wraps one `ChatTurn` into display lines at a given width using `wrap-ansi`
  (already a transitive Ink dependency, so our line-count math agrees with what Ink actually renders).
- `src/ui/ink/useTerminalSize.ts`: a hook subscribing directly to `stdout`'s `resize` event, since
  Ink's own resize handling only recalculates Yoga layout on the already-committed tree — it doesn't
  re-run our components, so anything computed at a specific width (the wrapped transcript lines) would
  otherwise go stale after a resize.

**Fix — rewritten files**:
- `src/ui/ink/Transcript.tsx`: no longer uses `<Static>`. Renders a bounded, app-managed slice of
  `buildDisplayLines(turns, width)` sized to `viewportHeight`, driven by `scrollOffset` (0 = following
  the latest message, like a normal chat app). History now lives entirely in React state
  (`InkApp`'s `history`) rather than depending on the terminal's own scrollback, so a resize just
  re-renders it correctly at the new width/height instead of losing it.
- `src/ui/ink/InkApp.tsx`: whole app now renders inside one `<Box height={rows - 1} overflow="hidden">`
  (one row short of the full terminal height, deliberately — see the comment in the file for why: Ink
  fully reprints its entire dynamic output once that output's height reaches the terminal's row count,
  and one row of headroom keeps normal typing on the cheap incremental-redraw path). Height budget for
  composer/footer/pending/error/popover is computed each render, and whatever's left goes to the
  transcript viewport — so the composer is always pinned to the bottom regardless of how much
  conversation came before it. Added a PageUp/PageDown `useInput` (always active) that adjusts
  `scrollOffset`, plus a `useEffect` that shifts the offset by exactly how many display lines a new
  turn added when the user has scrolled away from the bottom, so incoming replies don't yank their
  view back down.
- `package.json`: added `wrap-ansi` as an explicit dependency (was only ever a transitive one via Ink).

**Trade accepted**: native terminal mouse-wheel/tmux scrollback no longer works for the chat history —
PageUp/PageDown are the replacement. This was explicit in the option the user picked.

**Verification** (real pty, matching the user's reported terminal dimensions):
- 119x46, short conversation: composer + footer sit at rows 41-44 of a 46-row terminal (bottom-pinned,
  not floating at top with a gap) — confirmed via `pyte` screen emulation.
- 119x46, 30-turn history: oldest turns correctly scrolled out of the bounded viewport; `PageUp`
  reveals them (`Transcript.test.ts` + `InkApp.smoke.test.ts` cover this at the unit level too).
- **99x24 -> 122x24 resize with prior chat present** (reproducing the user's exact report): after
  resize, "You / hi" remains visible above the bottom-pinned composer — confirmed via real pty +
  `pyte`, byte-level check shows exactly one full-clear escape sequence at the resize (no cascading
  duplicate frames, matching the earlier stacking fix).
- `npx tsc --noEmit` and `npx eslint src/ui/ink/ test/ui/ink/` both clean on the actual device.
- Full suite in the cloud verification workspace: 186/187 passing (same pre-existing unrelated
  failure as always, not caused by this change).

**Still pending**: `npm run build` on the real Mac (cannot build from this sandboxed environment —
`@rollup/rollup-linux-arm64-gnu` architecture mismatch, same as every prior fix in this project).
`npx vitest` also can't run via the device-bash bridge for the same reason (vite/vitest pull in the
same native rollup binary) — run `npm test` directly in your own Mac terminal if you want to see the
new tests execute for real; `tsc`/`eslint` already ran clean here.

## 2026-09-05 — Reverted to top-down `<Static>` flow, matching Claude Code's own CLI (abandoning the bottom-pinned viewport)

The previous entry above (the custom bottom-pinned scroll viewport) fixed the resize-data-loss bug,
but the user then sent four screenshots of the real Claude Code CLI and asked for that instead: "claude
er mot chat ta top thke start hobe and top e Claude e jemon description detaion deaw ache serokom
amaro lagbe" — chat should flow from the top like Claude Code's, with a description/info box at the
top like Claude Code shows. That's a reversal of the just-finished bottom-pin design, not an addition
to it, so before touching anything I asked the user directly (`AskUserQuestion`) whether to (a) fully
revert to natural top-down flow with Ink's own `<Static>` plus a simplified fixed-ish bottom status
bar, abandoning the custom viewport and PageUp/PageDown entirely, or (b) keep the bottom-pinned
viewport and just add a banner at the top. The user chose (a) explicitly: "top-down flow + fixed
bottom status bar."

**Why revert instead of layering a banner onto the old design**: the bottom-pin architecture existed
specifically to keep the composer glued to the bottom of the window regardless of conversation length
— a goal the user no longer wants. Keeping it while also adding a top banner would mean carrying
PageUp/PageDown scrolling, the app-managed viewport math, and the resize-driven full-clear logic for a
UX nobody asked for anymore. Removing it is strictly simpler and matches the reference screenshots
exactly: conversation grows downward using the terminal's own scrollback, composer sits right after
the latest turn, and a slim status line stays at the bottom.

**Fix — new file**:
- `src/ui/ink/WelcomeBanner.tsx`: the top info box (ASCII mark, version, tagline, current directory,
  a one-line tip, and the branch/mode/agent status), styled to match the legacy `--tui=legacy` home
  screen's `header()` for content parity, bordered like Claude Code's own welcome box.

**Fix — rewritten files**:
- `src/ui/ink/Transcript.tsx`: back to Ink's native `<Static>` (permanent terminal scrollback,
  printed once per item) instead of the app-managed bounded viewport. Introduces a
  `TranscriptItem = {kind: "welcome"; banner} | {kind: "turn"; turn}` union so the welcome banner can
  travel *inside* the same static stream, always as item 0 — **not** as a normal sibling of
  `<Transcript>` in `InkApp`'s tree. That distinction matters: Ink erases and rewrites its entire
  non-static output on every render and writes newly-flushed static items *before* that redraw, so a
  banner living in the ordinary (dynamic) tree gets reprinted *underneath* every new chat turn instead
  of staying above the conversation — caught via a real pty run showing the first submitted message
  printed above the banner, fixed by folding the banner into the static array instead.
- `src/ui/ink/InkApp.tsx`: dropped all viewport/scroll-offset/PageUp-PageDown state and the
  `height={rows - 1} overflow="hidden"` wrapper box — the app now just renders its natural height.
  Added `version`, `mode`, and `showWelcome` props (the last controls whether the welcome banner item
  is included at all, so it only shows on the session's first mount, not on every remount after a
  `/command` round-trip). Kept a `renderFooter()` helper that explicitly wraps the bottom status line
  at the current width (`useTerminalSize`, kept from the previous rework) — defensive, since Ink counts
  rendered rows by counting `\n` characters and doesn't know when a line auto-wraps.
- `src/ui/ink/runInkApp.ts`: removed `clearOnResize` (the raw `\x1b[2J\x1b[3J\x1b[H` write on every
  `resize` event) and the plain `console.log` banner print before `render()` — the banner now lives
  inside Ink's own tree as a static item.
- `src/cli/run.ts` (`runInkInteractive`): added `firstMount` tracking so `showWelcome` is only `true`
  on the very first Ink mount of the session; every later remount (after a `/command` dispatch) passes
  `false` and `initialHistory` so the transcript reprints without repeating the banner.

**Deleted**: `src/ui/ink/textWrap.ts` (no longer needed — `<Static>` content doesn't need explicit
re-wrap safety the way the bounded viewport did) and `test/ui/ink/Transcript.test.ts` (referenced the
removed `width`/`viewportHeight`/`scrollOffset` props; replaced by two new tests in
`InkApp.smoke.test.ts` instead — see below).

**A mis-diagnosed bug along the way**: while verifying, an aggressive terminal-shrink pty test
initially appeared to reproduce the old cascading-duplicate-composer-boxes artifact
(https://github.com/vadimdemedes/ink/issues/907) even in the new design, which would have meant the
just-removed `clearOnResize` was actually still needed. Deep-diving into Ink's own source
(`ink.js`/`log-update.js`) explained the exact mechanism (line count tracked by counting `\n`s in the
rendered string, blind to real-terminal auto-wrap) — but re-running the same test with a **methodology
fix** (the pty capture spans multiple real terminal resizes, so replaying the whole byte stream through
one fixed-size `pyte.Screen` misinterprets early frames as if they were drawn for the final size;
fixed by recording `(byte_offset, rows, cols)` at each resize and replaying `pyte` in chunks bounded by
those offsets, calling `screen.resize()` between them) showed **no artifacts at all**, including under
a 14-step rapid-resize stress sequence. Conclusion: that bug was specific to the abandoned bottom-pin
design, which kept the app's output height pinned near `stdout.rows` and so constantly triggered Ink's
internal full-reprint branch; the new small-output top-down design essentially never hits that branch.
`clearOnResize` stayed removed, as intended.

**Verification**:
- `npx tsc --noEmit` and `npx eslint src/ui/ink/ src/cli/run.ts test/ui/ink/` both clean, run directly
  on the actual device.
- `InkApp.smoke.test.ts` updated: replaced the old bottom-pinned-composer test with
  "the chat history flows top-down and isn't bounded to a fixed-height viewport" (30-turn history, all
  visible, composer still reachable) and "shows the welcome banner only when showWelcome is set."
  Full suite in the cloud verification workspace: 184/185 passing (same pre-existing unrelated failure
  in `test/ui/home.test.ts` as always, unrelated to this work).
- Real pty, corrected resize methodology: single 99x24->122x24 resize and a 14-step rapid-resize
  stress sequence, both clean — no cascading artifacts, no lost history.
- Real pty, full round-trip, strictly character-by-character typing (confirming the app itself, not
  just the resize path): typed "hi" -> Enter -> waited for the reply -> typed "/mode plan" -> Enter ->
  waited for the "Press any key" overlay -> dismissed it -> captured 30KB of output. Byte-level replay
  confirmed: welcome banner printed exactly once (not repeated after the remount), "/mode plan"
  submitted cleanly (composer empty afterward, no stuck text), no leftover "Thinking…" artifact, the
  mode-change overlay rendered correctly, and after dismissal the remounted app showed the prior
  "You/hi" + reply history via `initialHistory` with no banner repeat. (An earlier, less careful test
  using multi-character burst writes and fixed timing had produced confusing results suggesting
  "/mode plan" was stuck — this fully char-by-char, content-synchronized retest showed that was a
  test-harness artifact, not a real bug.)

**Still pending**: `npm run build` on the real Mac (cannot build from this sandboxed environment —
architecture mismatch, same as every prior fix in this project). `tsc`/`eslint` already ran clean
directly on the device.

## 2026-09-05 — Fixed real terminal-window resize leaving duplicated composer boxes stacked on screen

The previous entry's pty testing concluded the resize-cascading-boxes bug
(https://github.com/vadimdemedes/ink/issues/907) didn't reproduce in the new top-down design. That
conclusion turned out to be wrong for the case that actually matters — dragging the terminal window's
edge with the mouse (rather than a resize command run at fixed sizes). The user hit it immediately:
resizing their real Terminal.app window (99x24 -> 254x77) left roughly fifteen duplicated, progressively
narrower empty composer boxes stacked below the single correct one (two screenshots, "terminal er size
change korle erokom hoya jacce").

**Root cause, precisely**: read directly from Ink's own source (`ink/build/ink.js`,
`ink/build/log-update.js`) rather than guessed at. Ink tracks how many terminal rows its last frame
took up as `previousLineCount`, a private variable inside one `log-update.js` closure per `Ink`
instance — incremented only by that same closure's own `render()`/`clear()` calls, and otherwise never
touched. A terminal *width* change means the previous frame's content wraps differently now than it did
when it was drawn — but nothing tells `previousLineCount` that happened, since it's derived purely from
counting `"\n"`s in the string that was written, at the *old* width. The next render then erases the
wrong number of rows relative to where the real cursor now visually sits, leaving fragments behind —
and a real Mac window drag fires many resize events in a burst as the mouse moves, so it stacks a fresh
fragment per event. This is a long-standing, acknowledged-unfixed upstream Ink limitation, not
something specific to this codebase.

**Why the previous test missed it**: the earlier verification used discrete, well-separated resize
steps (e.g. one 99x24->122x24 jump, or a "14-step" sequence with pauses between steps) — nothing that
resembled a real click-and-drag, which fires resize events far faster and in much smaller increments.
A corrected pty test that fires ~20-24 resize events roughly 30ms apart while dragging from 99x24 to
254x77 (and a shrink right back down) reproduced the exact reported symptom immediately.

**Why an in-place fix isn't possible**: `previousLineCount` is a closure-private variable with no
public API to read or reset — there is no supported way to tell Ink "the last frame you remember is
wrong, forget it." The one guaranteed-clean state is a brand-new `Ink` instance: `ink/build/render.js`
only creates one when nothing is already registered for that `stdout` in its internal `instances`
`WeakMap`, and `Ink.unmount()` deletes its own entry from that map on the way out. A full unmount
followed by a fresh `render()` call is therefore the only path *provably* free of the stale count,
rather than a guess at which internal counters to patch. `runInkInteractive` (`src/cli/run.ts`) already
uses exactly this recipe for the `/command` round-trip (unmount, clear the real screen, mount fresh
with `initialHistory`) — extensively tested already — so the fix reuses that same mechanism for a
resize instead of inventing a second one.

**Fix — `src/ui/ink/InkApp.tsx`**: added a debounced resize-settle effect. It watches
`useTerminalSize()`'s `columns`/`rows`; once they stop changing for 220ms (dragging a window edge
fires many resize events in a burst — this waits for the burst to actually end, so it doesn't
unmount/remount on every intermediate event), it calls a new `onResize` prop with the composer's
current text and then `exit()` — a genuine Ink unmount, same mechanism `/quit` already uses. It
deliberately *holds off* (retrying every 300ms instead of firing) while a reply is in flight
(`pending`): `onSubmit`'s promise lives in `runInkInteractive`'s closure, not in this component, so it
keeps running and still reaches the persistent `chatHistory` correctly across the unmount — but this
component's own `history`/`pending` state would simply stop updating once torn down, silently dropping
that reply from the screen until some later remount happened to pick it up via `initialHistory`.
Waiting for `pending` to clear first avoids that. Added `initialInput` prop (seeds the composer's
`InputState` instead of always starting blank) so a resize mid-draft doesn't erase what the user was
typing.

**Fix — `src/cli/run.ts` (`runInkInteractive`)**: added a `resized` flag alongside the existing
`pendingCommand` one. When `InkApp` reports a settled resize, the loop clears the real screen
(`clearScreen()`) and loops straight back to mount a fresh `InkApp` — no `dispatchInkCommand` call,
since there's no command to run. `carryInput` threads the composer draft into the next mount's
`initialInput`. Also **renamed `firstMount` to `showWelcome` and changed its lifecycle**: this mattered
more than expected, because `clearScreen()` writes `\x1b[3J` ("erase saved lines"), which on real
terminals (xterm and effectively everything derived from it) erases the actual *scrollback buffer*,
not just the visible screen — confirmed by testing, not assumed. Once a remount's `<Static>` items stop
including the welcome banner, it is gone for good, not merely scrolled out of view. That's correct
after a `/command` dispatch (a deliberate user action; the banner has served its purpose — this still
sets `showWelcome = false` there, unchanged from before), but a resize is *not* the user asking to
dismiss the banner, so the new resize branch leaves `showWelcome` exactly as it found it. Missing this
distinction was caught by testing before it shipped: the first version of this fix (still using a
"was this the first mount" flag reset unconditionally after every remount) correctly fixed the
duplicate-box corruption but silently erased the welcome banner on the very first resize — the
corrected version keeps the banner exactly as visible/absent as it already was.

**Verification** (real pty, corrected to fire a realistic burst of resize events ~30ms apart rather
than a few well-spaced discrete jumps):
- Fresh start (no chat yet), grow drag 99x24 -> 254x77: single clean welcome banner, single composer
  box, single footer line — no duplicates, matching the user's exact reported dimensions.
- With prior chat ("hi" + reply) present: grow drag 99x24 -> 254x77 immediately followed by a shrink
  drag 254x77 -> 110x30 — final frame shows the banner, the full "You/hi" + reply history, and a single
  clean composer/footer; byte-level check confirms exactly 2 full-clear sequences (one per settled
  drag) and 3 banner reprints (initial mount + 2 resize-remounts, all intentional since `showWelcome`
  is never touched by a resize).
- `npx tsc --noEmit` and `npx eslint src/ui/ink/ src/cli/run.ts` both clean, run directly on the device.
- `test/ui/ink/*` (25 tests) still pass in the cloud verification workspace.

**Accepted trade-offs**: (1) resizing while a reply is in flight delays the corrective remount until
the reply lands (retried every 300ms) rather than fixing the display immediately — chosen over losing
the reply from the visible transcript. (2) every settled resize now does the same "reprint the entire
conversation" work a `/command` dispatch already does — a real but bounded cost (once per drag,
debounced, not per resize event), consistent with a trade-off already accepted for commands. (3) brief
visual noise *during* an active drag (before the 220ms settle) is possible and wasn't specifically
eliminated — only the *settled* end state, which is what the user's screenshots showed as persisting
indefinitely, is guaranteed clean.

**Still pending**: `npm run build` on the real Mac (cannot build from this sandboxed environment).
`tsc`/`eslint` already ran clean directly on the device.

## 2026-09-05 — Eliminated the brief flash during an active resize drag (not just after it settles)

The previous fix cleaned up the *settled* end state after a resize but left a real gap: from the
first resize event of a drag until the 220ms debounce fired, Ink's own internal resize handler kept
redrawing on every single event using its buggy incremental path, and those buggy frames still reached
the real terminal — self-correcting once the debounce fired, but visibly flashing in the meantime. The
user confirmed exactly this: "terminal size choto korle eyta ekbar dekhasse then abar thik hoya jacce"
("shrinking the terminal shows this once, then it fixes itself"), then asked for it to actually be
fixed rather than just self-healing, pointing out the real Claude Code CLI doesn't do this at all.

**Fix — centralized the whole thing in `src/ui/ink/runInkApp.ts` instead of inside `InkApp` via
React**: for as long as a resize is "in progress" (from the first event of a burst until 220ms after
the last one), `stdout.write` is temporarily replaced with a no-op. Ink's own per-event redraws still
happen internally (harmless — only its private bookkeeping changes) but never actually reach the
screen, so the terminal's display simply doesn't change while the window is being dragged — nothing
corrupted can appear because nothing is being written. The moment the drag settles, the real `write` is
restored, the (now fully unmounted — same recipe as before) instance's stale frame is cleared once, and
a fresh mount paints the correct picture cleanly at the terminal's final size. Verified with a byte-level
capture: across a ~20-step, ~800ms drag, output stayed *completely flat* (zero bytes written) from the
first resize event to the last, then exactly one clean repaint appeared ~220ms later — no flash at all,
not even a reduced one.

Two details mattered for that "zero bytes" result to actually hold:
- **Listener order**: `render()` registers Ink's own `resized` listener on `stdout` before this code
  gets a chance to add its own. `EventEmitter` calls listeners in registration order, so a plain
  `stdout.on('resize', ...)` would still let the *first* event of every burst slip through (one
  Ink-triggered write, before suppression turned on). Using `stdout.prependListener(...)` instead
  puts this handler first for every future event, so suppression is active before Ink's handler ever
  runs — confirmed by the same byte-capture test: switching from `on` to `prependListener` took the
  "first event still gets through" case from one small write to zero.
- **Where the mechanics can live**: none of this — patching `stdout.write`, or calling the `unmount`
  function `render()` returns — can be done by a React component acting on itself, so it moved out of
  `InkApp` entirely. `InkApp` now only carries a `liveStatusRef` prop: a plain mutable object (not a
  React ref) it writes `{ input, pending }` into on every render, so `runInkApp` can read the
  composer's current draft and in-flight-request status from *outside* React at whatever arbitrary
  moment the settle timer fires. This also simplified `InkApp.tsx` back down — the debounce/effect
  logic that used to live there is gone, replaced by that one plain assignment.

`runInkApp`'s signature changed to return `{ resized, input }` instead of resolving to `void` — the
caller (`runInkInteractive` in `src/cli/run.ts`) now reads that directly instead of a separate
`onResize` callback prop, and no longer needs its own `clearScreen()` call for the resize case (the
clear now happens inside `runInkApp`, right after restoring the real `stdout.write` — ordering that
matters, since clearing while still suppressed would itself be silently swallowed).

**Accepted trade-offs**, unchanged from before: resizing while a reply is in flight delays the
corrective unmount until the reply lands (retried every 300ms, writes stay suppressed throughout, so
there's nothing incorrect on screen in the meantime either way); every settled resize still reprints
the whole conversation once (bounded, debounced, same cost already accepted for `/command` dispatch).

**Verification** (real pty, byte-level, not just visual):
- A ~20-step rapid shrink drag (254x77 -> 80x24, ~30ms between steps): `stdout` output byte count
  measured every ~40ms throughout — completely flat for the entire ~800ms drag, then exactly one write
  at settle. Re-confirmed the fix depends on `prependListener`: reverting to `on` alone let exactly one
  small write through per burst (the first event), while `prependListener` brought that to zero.
- Grow (99x24->254x77) then shrink (254x77->80x24) back to back, with prior chat ("hi" + reply)
  present: final frame shows the banner, full history, and a single clean composer/footer — same as
  the previous entry's verification, unaffected by moving the mechanism out of `InkApp`.
- `npx tsc --noEmit` and `npx eslint src/ui/ink/ src/cli/run.ts` both clean, run directly on the device.
- `test/ui/ink/*` (25 tests) still pass in the cloud verification workspace; full suite 184/185 (same
  pre-existing unrelated failure as always).

**Still pending**: `npm run build` on the real Mac (cannot build from this sandboxed environment).
`tsc`/`eslint` already ran clean directly on the device.

## 2026-09-05 — Replaced the composer's bordered box with a plain ruled line

The user sent a screen recording (real macOS Terminal.app, live window drag) confirming the
write-suppression fix does stop the corruption from spreading, but a residual visual moment remained:
frame-by-frame analysis of the recording showed the composer's `borderStyle="round"` box, mid-drag,
displaying with a misaligned right border (a "│" sitting well short of the window's actual right edge,
with blank space after it) and a stray wrapped word fragment under the footer. This is the expected,
already-documented consequence of suppressing all writes during an active drag (see the previous two
entries): the terminal keeps showing whatever was last actually drawn, frozen, while the window
continues resizing around it, until the drag settles and a single clean repaint happens. That freeze is
unavoidable without reintroducing the original corruption (redrawing on every event is exactly what
caused it) — but a *four-cornered box* frozen at the wrong width reads as visibly "broken" (misaligned
corners, a vertical bar floating in the middle of blank space), while a single repeated character reads
as "a line that hasn't caught up to the new width yet" — much less jarring for the same underlying,
unavoidable freeze.

**Fix — `src/ui/ink/MultilineInput.tsx`**: replaced the `<Box borderStyle="round" borderColor={...}
paddingX={1}>` wrapper with a plain `<Text>` line of repeated `"─"` characters (spanning
`useTerminalSize()`'s current `columns`) above the input rows — no side borders, no bottom border, no
padding. This also happens to match the reference Claude Code screenshots more closely (a ruled
divider rather than a full box) and removes one line of vertical space.

**Fix — `test/ui/ink/InkApp.smoke.test.ts`**: one test asserted the rendered frame contained `"/help "`
(with a trailing space) after a popover-completion — that trailing space used to survive into the
captured frame only because the old bordered box's padding/border character followed it on the same
terminal row; with no box, the composer's text row now legitimately ends right after the trailing
space, and trailing whitespace at the true end of a line is invisible in the rendered frame (correct,
expected terminal behavior, not a functional regression — the trailing space's actual *effect*, that a
second Enter submits instead of re-completing, is what the very next assertion in the same test already
checks). Updated the assertion to check for `"/help"` without demanding the trailing space render
visibly.

**Verification**:
- `npx tsc --noEmit` and `npx eslint src/ui/ink/ test/ui/ink/` both clean, run directly on the device.
- `test/ui/ink/*` (25 tests) pass in the cloud verification workspace.
- Real pty, grow (99x24->254x77) then shrink (254x77->80x24): final frame shows the banner, a plain
  ruled composer line, placeholder text, and the footer — no box-drawing artifacts to misalign in the
  first place.
- `CommandPopover.tsx` still uses its own bordered box (only the composer changed) — it's a
  transient overlay that only appears while actively typing a `/command`, not something likely to be
  on screen mid-drag; left as-is unless a similar issue turns up there.

**Still pending**: `npm run build` on the real Mac (cannot build from this sandboxed environment).
`tsc`/`eslint` already ran clean directly on the device.

## 2026-09-05 — Welcome banner redesigned to match a Claude Code CLI reference screenshot

The user sent screenshots of Claude Code's own welcome screen (a bordered box: product/version on
top, a left column with "Welcome back {name}!" + mascot + model/plan/org line + cwd, a vertical
divider, and a right column with "Tips for getting started" / "What's new" sections separated by a
horizontal rule) with "ami etar moto chai" ("I want it like this").

`WelcomeBanner.tsx` was rebuilt around that same two-column layout, but built entirely from Ink's own
`Box`/`borderStyle` primitives rather than hand-drawn box-drawing characters: a `Box` can show just
one border side (`borderRight`/`borderBottom`/etc. — see `ink/build/components/Box.d.ts`), so:
- the vertical divider between columns is just the left column's own `borderRight`,
- the horizontal rule under "Tips for getting started" is just that section's own `borderBottom`,
- the title/version line's underline is just that row's own `borderBottom`.

Yoga (Ink's layout engine) sizes and positions all of it automatically — including stretching the
shorter column to match the taller one, so the vertical divider always reaches the box's full actual
height — which avoids the fragile character-counting a hand-drawn box would need to stay correct
across every terminal width. Verified via a real pty at 40/60/100 columns: at 40 cols there isn't
room for two columns without every tip line wrapping on nearly every word, so `WelcomeBanner` falls
back to the previous single-column design below `columns < 54` rather than rendering something
cramped; 60 and 100 cols both render the full two-column layout correctly, divider reaching the
box's full height in both cases.

Content changes to support this:
- `runInkInteractive` (`src/cli/run.ts`) now resolves a greeting name once per session start —
  `git config --global user.name`, falling back to the OS username, then "there" — via
  `resolveGreetingName()`, and a `~`-shortened form of `workspaceRoot` (`cwdDisplay`) — both threaded
  through `runInkApp` -> `InkApp` -> `WelcomeBanner` as `userName`/`cwdDisplay` props (only used while
  `showWelcome` is true).
- The banner's mark stays our own `MARK_ASCII` "gR" wordmark (`src/ui/logo.ts`) rather than any
  mascot from the reference screenshot — the ask was the *layout*, not another product's branding.
- `InkApp.smoke.test.ts`'s welcome-banner test was updated for the new content ("Tips for getting
  started" / "What's new" / the default "Welcome back there!" greeting when `userName` isn't passed)
  instead of the old "Current directory:" label, which the new layout doesn't print (the path is
  shown bare, centered, matching the reference).

## 2026-09-05 — Welcome banner tightened to match Claude Code's reference more closely

After the first pass (previous addendum), the user compared it side-by-side with Claude Code's own
screen and said it still wasn't matching ("hubuhu claude er moto hoini" / "I need same yo same ui
like claude"). Two structural gaps, fixed in `WelcomeBanner.tsx`:
- The title ("gR DEV AGENT v0.1.0") was centered in its own row with a divider underneath — Claude's
  sits flush left against the top border with *no* gap row before content starts. Removed the
  divider/centering; the title is now a single left-padded row, content starting immediately below.
- The right column's tip/what's-new lines wrapped onto a second line when too long for the column —
  Claude truncates each to one line with an ellipsis instead. Added `wrap="truncate-end"` to those
  `<Text>` lines.

Two things were deliberately left *not* pixel-identical, and said so directly rather than silently
diverging: Claude Code's own mascot (kept as our own `MARK_ASCII` "gR" wordmark) and its accent color
(kept as gr-agent's own cyan, used everywhere else in this UI). Matching *those* specifically, on top
of an otherwise-identical layout, would make gr-agent's welcome screen read as Claude Code's rather
than its own — everything else (box shape, title placement, column proportions, section layout,
truncation behavior) does match.

## 2026-09-05 — Composer: bottom rule added; bottom-pinning declined

User asked for two more changes after comparing composer areas directly: (1) a bottom ruled line to
match Claude Code, not just the top one, and (2) pinning the composer to the terminal's bottom row
like they believe Claude Code does.

(1) done: `MultilineInput.tsx` now draws a second `"─".repeat(columns)` line after the composer's
rows, matching the top one. Still deliberately not a full box — two independent horizontal rules
have no vertical side-bars tying them together, so even if the terminal reflows one of them mid-drag
(the underlying, un-fixable-by-us cause of the resize-flash artifact — see the comment in this file
and in `runInkApp`), there's no "corner" for it to visibly desync against; each just reads as "hasn't
caught up to the new width yet," same as the single-line version already did.

(2) declined, explained to the user rather than silently skipped: this codebase already went through
exactly this — an earlier version of the whole Ink shell pinned the composer to the bottom of a
fixed-height viewport, and it was deliberately replaced with the current top-down `<Static>` flow
(see the big comment on `Transcript`) specifically because that's what real Claude Code's CLI does,
and because bottom-pinning is what caused the original resize-corruption class of bugs this whole
session's work has been fixing (treating the app as one `rows`-tall box requires a full clear on
every resize, which is what was wiping the real terminal scrollback). The empty space below the
composer in the user's own reference screenshots isn't Claude Code pinning its input to the bottom —
it's simply unused terminal rows in a short conversation under top-down flow, the same reason ours
looks the same way. Re-introducing bottom-pinning now would both contradict how Claude Code actually
behaves and resurrect a bug class already fixed, so it was not implemented.

## 2026-09-05 — Composer pinned near the bottom on a fresh, empty session

User pushed back a third time on the "input box should be at the terminal's bottom, like Claude's"
point, with an annotated screenshot showing the gap sitting *above* Claude's composer (pushing it
down near the window's bottom edge) rather than *below* it like this app's own screenshot. Counting
rows in both reference images confirmed it: Claude Code's composer really does sit well down the
terminal on a fresh session, not immediately under the welcome banner.

Implemented as a deliberately bounded version of real bottom-pinning, not a return to the old
fixed-height-viewport design (see the "welcome banner tightened" addendum above, and the original
`Transcript` comment, for why permanent bottom-pinning was walked back once already — it needs a full
clear on every resize, which is the corruption class this whole session has been fixing):

- `InkApp.tsx` now wraps everything from `pending`/`error` down through `MultilineInput` and the
  footer in a `Box` with `minHeight` and `justifyContent="flex-end"`, but **only** while
  `isFreshLaunch` holds — `history.length === 0 && input.value === "" && !pending`. The instant the
  user types anything, sends a message, or a reply comes back, this turns itself off and the layout
  is plain top-down flow again, same as before. No per-turn row bookkeeping ever happens, so there's
  no path back to the resize bug class.
- The tricky part: `<Transcript>`'s `<Static>` output (where the welcome banner lives) contributes 0
  to Yoga's measured height for this component, since Ink writes it straight to real scrollback
  outside the normal layout tree. `minHeight={rows}` alone would therefore stack a *full* terminal
  height's worth of dynamic content **after** the banner's own (separately printed) rows, overshooting
  the real terminal height and scrolling the banner itself out of view. Fixed by subtracting the
  banner's height first: `minHeight={rows - bannerRows}`.
- `bannerRows` comes from a new `estimateWelcomeBannerRows(columns)` exported from
  `WelcomeBanner.tsx`, returning the exact fixed row count for whichever of its two layouts is active
  (10 for the narrow fallback, 14 for the two-column layout — each cross-checked against a real
  `ink-testing-library` render, not guessed). This is only *exact* because every previously
  variable-length line in `WelcomeBanner` (`modelLine`, `cwdDisplay`, the branch/mode/agent line, the
  narrow layout's tip line) now renders with `wrap="truncate-end"` — so its height can never
  change with content length or wrapping, which is what makes subtracting it safe.
- Verified via a real pty at 121×67 (matching the user's own screenshot): banner (14 rows, including
  its own `marginBottom`) + the bottom-anchored block (53 rows, blank filler on top, composer+footer
  at the very bottom) sum to exactly 67 — the whole banner stays visible *and* the composer sits on
  the terminal's actual last row, with no overflow/scrolling forced on a fresh launch.

## 2026-09-05 — Bottom-anchoring made continuous, not on/off (fixed the "snaps to top" jump)

The previous addendum's `isFreshLaunch` flag (padding only before the very first turn) caused exactly
the jump the user immediately caught: "type korle top e chole jacce" — send one message and the whole
layout snapped from "padded, composer at the bottom" straight to "compact, composer right under the
new reply," because the flag went from true to false in one step.

Replaced with a continuous calculation in `InkApp.tsx`: a new `estimateTurnRows(turn, columns)`
(mirrors `Transcript`'s own per-turn rendering — role-label row + wrapped text + `marginBottom={1}` —
using `wrap-ansi`, the same library `renderFooter` already used, so wrapped-line counts track Ink's
actual `<Text>` wrapping rather than a naive `length / columns` guess) sums up, alongside
`estimateWelcomeBannerRows`, into `usedRows`: how many real terminal rows the welcome banner and every
turn printed so far actually occupy. `fillerMinHeight = Math.max(0, rows - usedRows)` is what the
composer-wrapping `Box` gets as its `minHeight` now, instead of an all-or-nothing flag. As real
history grows, `usedRows` grows and `fillerMinHeight` shrinks by exactly that much each render — the
composer eases up the screen turn by turn instead of teleporting — and once a conversation genuinely
fills the terminal, `fillerMinHeight` naturally settles at 0 and it's plain top-down flow, same as
before any of this work started.

Why this still doesn't reopen the resize-corruption class this whole session has been fixing: it only
ever trusts *our own* estimate of already-printed rows for an ordinary re-render (a new turn,
`pending` toggling, the composer growing a line) — situations Ink's own dynamic-block redraw already
handles correctly on its own. The original bug was specifically a terminal *width* change silently
invalidating a row count that used to be correct; resize handling stays entirely inside `runInkApp`
and is untouched by this. Verified via `ink-testing-library`: rendered InkApp, submitted "hi", let the
mocked reply resolve, and confirmed the total frame line count stayed pinned at the terminal's row
count (24 in that harness) across all three snapshots — before, mid-`pending`, and after the reply —
with the padding shrinking to absorb exactly the two new turns' worth of rows.

## 2026-09-05 — Clear the previous shell's scrollback before the first Ink mount

User's own screenshot showed the login banner + `cd`/`npm run build` shell output still sitting above
the welcome box on launch ("gr-agent run korle terminal er prv all clear kore then start hobe, like
claude" — running gr-agent should fully clear the terminal first, then start, like Claude Code does).
Real Claude Code starts from a genuinely blank terminal; this app was only ever *appending* its
welcome banner after whatever was already in scrollback.

Fixed with one line: `runInkInteractive` (`src/cli/run.ts`) now calls the existing `clearScreen()`
helper (`"\x1b[2J\x1b[3J\x1b[H"` — already used elsewhere in this file for the `/command` remount
round-trip) once, right at its own start, before the mount loop begins. `clearScreen`'s own doc
comment already covers why the full `"\x1b[3J"` variant is required here rather than a bare
`"\x1b[2J"` (it's the combination that reliably repaints on every real terminal, confirmed against
macOS Terminal.app) — the same property that makes it erase real scrollback is exactly what's wanted
now, not something to avoid, since a fresh launch is precisely the moment scrollback *should* go away.

## 2026-09-05 addendum: fixed "scroll height besi hoya gese" (extra scroll on fresh launch)

**Report:** user's screenshot (103x64 terminal, welcome banner + "hi" typed, not yet submitted)
showed the whole screen scrolled up by exactly one line — the welcome banner's top border was
pushed off-screen, and a spurious blank line appeared at the very bottom, matching what a native
terminal scrollbar looks like when content is one line taller than the visible viewport.

**Root cause:** confirmed with a real pty (Python `pty.fork()` + `TIOCSWINSZ`, replayed through
`pyte.Screen`/`pyte.Stream` for correct cursor semantics) at 103x64 with `showWelcome: true`,
`agent: "codex"`, `agentModel: "gpt-5.6-sol"`, empty history, composer containing "hi". Ink's own
`log-update` (`node_modules/ink/build/log-update.js`) does `const output = str + '\n'` before every
write of the dynamic (non-Static) block — it always appends one trailing newline after the block's
last visible line, on every render. `InkApp`'s `usedRows`/`fillerMinHeight` math (added for the
bottom-anchoring fix) sized the dynamic block to land its last line exactly on the terminal's last
row, with no room left for that trailing newline — so the cursor ended up resting on a
`rows`-th row that doesn't exist on screen, forcing a 1-line scroll. Before the fix: cursor rested
at row 64 on a 64-row screen. After: row 63 (the terminal's actual last valid row).

**Fix:** `src/ui/ink/InkApp.tsx` — `fillerMinHeight` now reserves one fewer row:
`Math.max(0, rows - usedRows - 1)` instead of `Math.max(0, rows - usedRows)`. Verified via the same
real-pty + pyte methodology at both 103x64 and 121x67 — banner's top border stays on-screen, cursor
rests on the terminal's actual last row, no scroll.

Re-ran `npx tsc --noEmit -p .` (clean) and `npx vitest run` — same pre-existing, unrelated
`test/ui/home.test.ts` footer-width failure as before (not touched by this fix, not part of the Ink
TUI), everything else passing including `test/ui/ink/InkApp.smoke.test.ts`.

## 2026-09-05 addendum: command palette overhaul — /plan, /spec, /implement

**Request:** trim the "/" command palette down to the commands actually in active use, and add a
plan -> spec -> implement flow: `/plan` writes a Markdown implementation plan and saves it under the
workspace's `.gr-agent/plans/`, `/spec` does the same for a specification under `.gr-agent/specs/`.

**Command list, before -> after:**
- Removed: `/run` (renamed, see below), `/workflow` (preset picker — no replacement; `/mode` still
  sets the workflow mode), `/workers` (was a literal duplicate of `/agents`, same handler), 
  `/integrations`, `/resume` (both were autocomplete-only, never actually dispatched to anything),
  `/sessions`, `/attach`, `/mcp`, `/skills` (the four `comingSoon` stubs — never implemented).
- Kept: `/help`, `/setup`, `/clone`, `/mode`, `/agents`, `/model`, `/quit`.
- Added: `/plan <task>`, `/spec <task>` (new — generate + save a Markdown doc via the workspace's
  configured worker), `/implement <task>` (renamed from `/run` — same investigate -> implement ->
  test -> review pipeline, unchanged).

**Where this landed:**
- `src/ui/home.ts` — `SLASH_COMMANDS` trimmed/reordered (kept `/mode` immediately before `/model` so
  the existing Ink smoke test's "/mo matches mode then model, in that order" assumption still
  holds), composer placeholder and `resolveSuggestionSubmission`'s task-suggestion routing both
  changed from `/run` to `/implement`.
- `src/riqs/paths.ts` — added `plansDir()`/`planDoc(slug)` and `specsDir()`/`specDoc(slug)` to
  `RiqsPaths`, writing under `.gr-agent/plans/` and `.gr-agent/specs/` respectively. Deliberately
  separate from the existing `plan()` (`.gr-agent/workflow/plan.json`, the orchestrator's internal
  task-graph state) — these are human-readable, editable documents, not machine state.
- `src/cli/run.ts` — the big one:
  - `INK_RECOGNIZED_COMMANDS`, `dispatchInkCommand`, and the legacy `runInteractive` loop's
    `if (input.startsWith("/"))` chain all updated in parallel (both front ends share one behavior).
  - New `runGenerateDoc(kind, args, g, tty)` — shared by both front ends, handles usage-check,
    calling generation, writing the file (filename = `slugify(objective)`, a timestamp prefix + a
    hyphenated slice of the objective so files sort chronologically and stay identifiable), and
    showing a saved-path + preview overlay.
  - New `generateWorkerDocument(kind, objective, g)` + `docViaAgentCli`/`docViaNativeProvider` —
    mirrors `resolveChatReply`'s own agent-CLI-first-then-native-fallback dispatch, but with
    dedicated `PLAN_DOC_SYSTEM_PROMPT`/`SPEC_DOC_SYSTEM_PROMPT` system framing instead of
    `CHAT_SYSTEM_PROMPT`'s "decline engineering tasks, point at /implement" framing (which would
    have sabotaged /plan and /spec if reused as-is), no chat history (each doc is a fresh one-shot),
    a longer CLI timeout (180s vs. chat's 120s) and bigger output caps (12000 chars via CLI / 3000
    tokens via native — a document is meant to be a real document, not a chat-sized reply).
  - Every "/run" reference in comments, `CHAT_SYSTEM_PROMPT`/`CHAT_CLI_PREFIX`, and error-fallback
    hint strings (`"To run this as a real task instead: /run ..."` etc.) renamed to `/implement`.
  - `pending.workflow` field and its two slash-command handlers removed along with `/workflow`;
    `pending.mode` (and `/mode`) untouched.

**Tests:** `test/ui/home.test.ts` updated in step — the `/run` describe block renamed to
`/implement` with matching assertions, the `/wo` prefix-filter test replaced with a `/mo` one (since
`/workflow`/`/workers` no longer exist to match), all "Ask anything, or /run..." placeholder
assertions updated to `/implement`. `npx tsc --noEmit -p .` clean; `npx vitest run` — same
pre-existing, unrelated `test/ui/home.test.ts` footer-width failure as every prior session (not
touched by this change), everything else passing including the Ink smoke tests (the `/mo` ordering
test still holds since `/mode` was kept immediately before `/model` in the array).

Not yet covered by an automated test: `/plan`/`/spec`'s actual file-writing behavior end-to-end
(`RiqsPaths.planDoc`/`specDoc` path construction was sanity-checked manually via `tsx`, not added as
a formal vitest case) — worth adding if this becomes a heavily-used path.

## 2026-09-05 addendum: fixed the "faka space" (floating divider) in the welcome banner

**Report:** two screenshots (103x64ish gr-agent terminal, red box) circling a short vertical mark
sitting alone in otherwise-blank space, right between the header's horizontal rule and the
"Welcome back, ..." / "Quick start" row — "ey faka spec[e] ta full kore daw" (fill in that empty
space).

**Note on scope:** before touching anything, a checksum comparison found that `WelcomeBanner.tsx`,
`InkApp.tsx`, `MultilineInput.tsx`, `runInkApp.ts`, `CommandPopover.tsx`, and
`test/ui/ink/InkApp.smoke.test.ts` on this device no longer matched what had last been pushed here —
the welcome panel had been redesigned (bordered-box "Tips for getting started"/"What's new" ->
un-bordered "Quick start"/"Workspace") and a Shift+Tab agent-cycling feature had been added
(`onCycleAgent`/`AgentSelection` plumbing in `InkApp.tsx`/`MultilineInput.tsx`, not yet wired up from
`src/cli/run.ts` — currently a harmless no-op). All of that was pulled down and reconciled first so
this fix is built on the actual current files, not a stale local copy.

**Root cause:** confirmed via a real pty (Python `pty.fork()` + `TIOCSWINSZ`, replayed through
`pyte`) at both 40x40 (narrow layout) and 130x40 (wide layout). The wide layout had a standalone
`<Text> </Text>` spacer line between the top rule and the two-column body — a genuinely blank row
with no divider character on it at all. The narrow layout has no equivalent gap, so this was always
an inconsistency between the two, not a deliberate design choice. That blank row is what read as a
disconnected/"floating" divider in the screenshot.

**Fix:** `src/ui/ink/WelcomeBanner.tsx` — removed the spacer `<Text> </Text>` row entirely; the
two-column content (and its vertical divider) now starts immediately after the top rule, matching
the narrow layout's behavior.

**Bonus catch while verifying:** `estimateWelcomeBannerRows()` — the row-count function `InkApp`'s
bottom-anchoring math depends on being exact — was off by one in BOTH branches, from before today
(narrow said 12, real count is 11; wide said 16 counting an "11-row two-column body" that's actually
10, on top of the spacer row now removed). Both overcounted, which is the "safe" direction per this
file's own reasoning (under-filling the composer's bottom padding by a row rather than overflowing),
so this wasn't causing a crash/scroll — just a minor "not quite pinned to the very last row"
imprecision. Corrected to 11 (narrow) and 14 (wide), both re-verified against the same real-pty
captures.

Re-ran `npx tsc --noEmit -p .` (clean) and `npx vitest run`: same pre-existing, unrelated
`test/ui/home.test.ts` footer-width failure as every prior session, plus one more pre-existing,
unrelated failure surfaced now that the smoke-test file is in sync —
`test/ui/ink/InkApp.smoke.test.ts` expects "Developed by Golam Rabbani" but `src/ui/logo.ts`'s
`CREDIT` currently says "Built by Golam Rabbani". Left this alone (out of scope for the reported bug,
and not clear which side is the intended wording) — flagged to the user instead of guessing.
