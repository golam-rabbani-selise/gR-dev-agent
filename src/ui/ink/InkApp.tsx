import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import wrapAnsi from "wrap-ansi";
import type { ChatTurn } from "../home";
import { isCommandMenuOpen, filterSlashCommands } from "../home";
import { initialInputState, type InputState } from "./inputBuffer";
import { MultilineInput } from "./MultilineInput";
import { CommandPopover, clampPopoverIndex } from "./CommandPopover";
import { Transcript, type TranscriptItem } from "./Transcript";
import { estimateWelcomeBannerRows } from "./WelcomeBanner";
import { useTerminalSize } from "./useTerminalSize";

/** Structurally compatible with `ChatReply` from `src/cli/run.ts` — not imported directly, so
 * `src/ui/ink` never depends on `src/cli` (keeps the dependency direction one-way: cli -> ui). */
export interface ReplyLike {
  text: string;
  agent?: string;
}

export interface AgentSelection {
  agent: string;
  agentModel?: string;
}

export interface InkAppProps {
  workspaceName: string;
  branch: string | null;
  agent: string;
  agentModel?: string;
  /** Shown in the welcome banner only — defaults are for tests/callers that don't care about it. */
  version?: string;
  mode?: string;
  /** Show the welcome/info box above the transcript. `runInkInteractive` (src/cli/run.ts) keeps
   * this true across command/resize remounts so the Quick start/Workspace panel stays visible. */
  showWelcome?: boolean;
  /** "Welcome back {userName}!" in the welcome banner — resolved by `runInkInteractive` (git's
   * global `user.name`, falling back to the OS username, then "there"). Only used when
   * `showWelcome` is true. */
  userName?: string;
  /** The workspace path shown at the bottom of the welcome banner's left column, already shortened
   * to `~/...` when it's under the home directory (`runInkInteractive` does this once up front, so
   * this component doesn't need `node:os`). Only used when `showWelcome` is true. */
  cwdDisplay?: string;
  /** Turns already in the conversation before this mount (e.g. from before a `/command` round-trip
   * unmounted and remounted Ink) — seeded into `history` so they reappear immediately instead of
   * this fresh instance starting blank (see the comment on `Transcript`). */
  initialHistory?: ChatTurn[];
  /** The composer's in-progress text carried over from a mount this one is replacing (see
   * `runInkApp`'s resize handling) — so a resize mid-draft doesn't wipe out what the user was
   * typing. Omitted (blank composer) for the session's very first mount and after a real
   * `/command` dispatch. */
  initialInput?: InputState;
  /** Resolve one submitted line (a "/command" or plain chat text). Return `null` to exit the app
   * (the host decides what counts as an exit — "/quit", "/exit", etc.). Any thrown error is caught
   * and shown as an assistant turn rather than crashing the app. */
  onSubmit: (text: string, history: ChatTurn[]) => Promise<ReplyLike | null>;
  /** Called when Shift+Tab asks the host to cycle to the next agent. */
  onCycleAgent?: () => AgentSelection | Promise<AgentSelection>;
  /** Internal host hook: a printed welcome banner must be replayed after its agent changes. */
  onAgentCycleRemount?: () => void;
  /** A plain mutable object (not a React ref — this component doesn't own it) that `runInkApp`
   * keeps around for the lifetime of this mount and reads from *outside* React whenever it needs
   * the composer's current draft and whether a reply is in flight — specifically, right when it's
   * about to unmount this instance because of a settled terminal resize. Written on every render;
   * see `runInkApp` for why the read has to happen from outside React (it has to be able to grab
   * this state at an arbitrary moment, not just in response to a prop/state change here). */
  liveStatusRef?: { current: { input: InputState; pending: boolean } };
}

/**
 * The Ink-based interactive shell (opt-in via `--tui=ink`; see `src/cli/run.ts`). A genuine
 * multi-line composer, a slash-command popover that filters as you type, and a chat transcript that
 * flows top-down using the real terminal's own scrollback (see `Transcript`) — the composer sits
 * right after the latest turn, like Claude Code's own CLI, rather than being pinned to the bottom of
 * the window. It does not stream tokens — see `.gr-agent/plans/full-interactive-cli-plan.md` for why
 * that needs a separate, deliberate change to the native worker's JSON-action protocol and to the CLI
 * workers' subprocess handling first.
 */
export function InkApp({
  workspaceName,
  branch,
  agent,
  agentModel,
  version,
  mode,
  showWelcome,
  userName,
  cwdDisplay,
  initialHistory,
  initialInput,
  onSubmit,
  onCycleAgent,
  onAgentCycleRemount,
  liveStatusRef,
}: InkAppProps): React.ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [history, setHistory] = useState<ChatTurn[]>(initialHistory ?? []);
  const [input, setInput] = useState<InputState>(initialInput ?? initialInputState());
  const [pending, setPending] = useState(false);
  const [popoverIndex, setPopoverIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeAgent, setActiveAgent] = useState<AgentSelection>({ agent, agentModel });

  // Kept up to date on every render, not just in an effect, so `runInkApp` can read the *current*
  // value at whatever arbitrary moment it decides to unmount this instance (see `liveStatusRef`'s
  // own doc comment on why that has to happen from outside React).
  if (liveStatusRef) liveStatusRef.current = { input, pending };

  const popoverOpen = isCommandMenuOpen(input.value) && !pending;
  const popoverMatches = popoverOpen ? filterSlashCommands(input.value) : [];
  const highlightedCommand =
    popoverMatches.length > 0 ? popoverMatches[Math.max(0, Math.min(popoverIndex, popoverMatches.length - 1))] : undefined;
  // Enter should only be left to the popover (to complete the highlighted match) while there's
  // something meaningful to complete — once what's typed is already an exact match (e.g. "/quit"),
  // completing it would just re-set it to itself plus a trailing space, forcing a second Enter to
  // actually submit. So an exact match falls through to MultilineInput's normal submit instead.
  const popoverInterceptsEnter = Boolean(highlightedCommand) && highlightedCommand!.id !== input.value;

  const handleCycleAgent = (): void => {
    if (!onCycleAgent || pending) return;
    void Promise.resolve(onCycleAgent()).then((selection) => {
      setActiveAgent(selection);
      if (showWelcome) onAgentCycleRemount?.();
    });
  };

  const handleChange = (next: InputState): void => {
    setInput(next);
    if (isCommandMenuOpen(next.value)) {
      setPopoverIndex((i) => clampPopoverIndex(i, next.value));
    }
  };

  const handleSubmit = (text: string): void => {
    const trimmed = text.trim();
    setInput(initialInputState());
    if (trimmed === "") return;

    const nextHistory = [...history, { role: "user" as const, text: trimmed }];
    setHistory(nextHistory);
    setPending(true);
    setError(null);

    onSubmit(trimmed, nextHistory)
      .then((reply) => {
        setPending(false);
        if (reply === null) {
          exit();
          return;
        }
        setHistory((h) => [...h, { role: "assistant" as const, text: reply.text, agent: reply.agent }]);
      })
      .catch((e: unknown) => {
        setPending(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  // Popover navigation lives in its own useInput (active only while the popover is open) rather
  // than inside MultilineInput, which only owns text-buffer editing — Up/Down there are suppressed
  // via MultilineInput's suppressVerticalNav prop so the two hooks don't fight over the same keys.
  // Tab always accepts the highlighted match; Enter does too, but only when popoverInterceptsEnter
  // says there's something to complete — see its definition above for why an exact match (e.g.
  // "/quit") instead falls through to MultilineInput's normal submit.
  useInput(
    (_input, key) => {
      if (popoverMatches.length === 0) return;
      if (key.upArrow) {
        setPopoverIndex((i) => (i - 1 + popoverMatches.length) % popoverMatches.length);
        return;
      }
      if (key.downArrow) {
        setPopoverIndex((i) => (i + 1) % popoverMatches.length);
        return;
      }
      if ((key.tab && !key.shift) || (key.return && popoverInterceptsEnter)) {
        const chosen = highlightedCommand!;
        setInput({ value: `${chosen.id} `, cursor: chosen.id.length + 1 });
      }
    },
    { isActive: popoverOpen },
  );

  // Deciding *when* a resize has "settled" enough to force a clean remount, and actually holding
  // this instance's own output back from Ink's buggy incremental resize redraws in the meantime, both
  // live in `runInkApp` now, entirely outside React (see the long comment there for why: it needs to
  // intercept the terminal's raw `stdout.write` and call the `unmount()` that `render()` returns
  // directly, neither of which a component can do to itself). `liveStatusRef` above is this
  // component's only part in that: keeping the composer draft and in-flight-request status somewhere
  // `runInkApp` can read at whatever arbitrary moment it decides to act.

  const footerAgent = activeAgent.agentModel ? `${activeAgent.agent} (${activeAgent.agentModel})` : activeAgent.agent;

  // Claude Code's own reference screenshots (the user compared side-by-side) show a real gap
  // *above* the composer — the prompt sits well down the terminal, not immediately under whatever
  // was last printed — rather than the gap this app previously left *below* the composer. The first
  // attempt at this only stretched the layout before the *very first* turn (an `isFreshLaunch` flag),
  // reverting to plain compact flow the instant any history existed — which the user immediately
  // caught as a jump: "type korle top e chole jacce" (typing/sending snaps everything back up to the
  // top). Fixed by never treating this as on/off: figure out how many rows the welcome banner and
  // every turn printed *so far* actually used (`usedRows` below), and stretch the block below the
  // transcript by whatever's left of the terminal's height — shrinking smoothly, turn by turn, as
  // real content grows, rather than snapping. Once the conversation genuinely fills the screen this
  // naturally settles to 0 extra padding and it's plain top-down flow, same as it's always been.
  //
  // This still isn't the literal always-on bottom-pinned-viewport design this codebase already tried
  // once and deliberately walked back (see the comment on `Transcript`) — that one needed a full
  // clear on every *resize* to paper over Ink's own stale-line-count bug, which is the corruption
  // class this whole session's work has been fixing. The distinction that makes this version safe:
  // it only ever trusts *our own* estimate of already-printed rows for an ordinary (non-resize)
  // re-render, and Ink's dynamic (non-static) block already redraws correctly whenever its own
  // height changes for a normal reason (a new turn, "Thinking…" appearing/disappearing, the composer
  // growing to a second line) — the original bug was specifically about a *width* change (a resize)
  // invalidating a row count that was never wrong until the terminal's width moved out from under it.
  // No resize handling happens here at all; that stays entirely inside `runInkApp`.
  //
  // `<Transcript>`'s `<Static>` output contributes 0 to this component's own measured Yoga height —
  // Ink writes it straight to real scrollback outside the normal layout tree — which is *why*
  // `usedRows` has to be estimated at all rather than read off some layout measurement.
  // `estimateWelcomeBannerRows` is exact (every line in `WelcomeBanner` is a fixed, non-wrapping
  // length); `estimateTurnRows` uses `wrap-ansi` (the same library Ink's own `<Text>` wrapping is
  // built on, already used below in `renderFooter`) to stay as close to Ink's actual wrapped line
  // count as possible — under-counting is the unsafe direction here (it would overshoot the terminal
  // height and push the banner/earlier turns off-screen), so this errs toward not under-counting.
  const usedRows =
    (showWelcome ? estimateWelcomeBannerRows(columns) : 0) + history.reduce((sum, turn) => sum + estimateTurnRows(turn, columns), 0);
  // The "- 1" is not slack/padding — it's mandatory, not optional, and here's why: Ink's own
  // `log-update` (node_modules/ink/build/log-update.js), which is what actually writes this
  // dynamic block to the real terminal, always does `const output = str + '\n'` before writing —
  // it unconditionally appends one trailing newline after the block's own last visible line, every
  // single render, no matter how short the block is. That means the cursor always rests *one row
  // below* this block's last visible row, not on it. As long as that phantom row still fits inside
  // the terminal, it's invisible and harmless (just blank space below the prompt). But if this
  // block's bottom edge already lands exactly on the terminal's last row (rows - 1), that trailing
  // "\n" pushes the cursor to a (rows)-th row that doesn't exist on screen — which forces the whole
  // terminal to scroll up by one line to make room for it. That scroll is exactly what silently ate
  // the welcome banner's top border and produced the "scroll height besi hoya gese" report: total
  // printed content (banner + this block) landed on exactly `rows`, one row too many once the
  // phantom trailing row is counted. Confirmed with a real pty (fork + TIOCSWINSZ) at 103x64,
  // replayed through `pyte` for correct cursor-position semantics (naive text concatenation across
  // frames can't reveal a forced scroll) — before this fix the cursor rested at row 64 on a 64-row
  // screen; after it, at row 63, which is the terminal's actual last valid row.
  const fillerMinHeight = Math.max(0, rows - usedRows - 1);

  // The welcome banner has to travel *inside* the same `<Static>` stream as the chat turns, not as
  // a normal sibling of `<Transcript>` — see the comment on `Transcript`/`TranscriptItem` for why a
  // banner living in the regular (non-static) tree ends up reprinted underneath every new turn
  // instead of staying above the conversation. It is also replayed on command/resize remounts when
  // `showWelcome` remains true, because each fresh `<Static>` instance starts from a blank print log.
  const transcriptItems: TranscriptItem[] = [
    ...(showWelcome
      ? [
          {
            kind: "welcome" as const,
            banner: {
              version: version ?? "0.0.0",
              workspaceName,
              branch,
              mode: mode ?? "auto",
              agent: activeAgent.agent,
              agentModel: activeAgent.agentModel,
              userName: userName ?? "there",
              cwdDisplay: cwdDisplay ?? `~/${workspaceName}`,
            },
          },
        ]
      : []),
    ...history.map((turn) => ({ kind: "turn" as const, turn })),
  ];

  return (
    <Box flexDirection="column">
      <Transcript items={transcriptItems} />

      {/* `<Transcript>`'s `<Static>` output never counts toward this Box's measured height (Ink
       * writes it straight to real scrollback, once, outside the normal layout tree) — so giving
       * *this* block a `minHeight` derived from `rows` fills in exactly the terminal rows that
       * aren't already accounted for by the welcome banner and every turn printed so far (see
       * `usedRows`/`fillerMinHeight` above), and `justifyContent="flex-end"` bottom-aligns
       * everything inside it. */}
      <Box flexDirection="column" minHeight={fillerMinHeight > 0 ? fillerMinHeight : undefined} justifyContent="flex-end">
        {pending && (
          <Box marginBottom={1}>
            <Text dimColor>Thinking…</Text>
          </Box>
        )}
        {error && (
          <Box marginBottom={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}

        {popoverOpen && <CommandPopover query={input.value} selectedIndex={popoverIndex} />}

        <MultilineInput
          state={input}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder="Type a message, or / for commands…"
          disabled={pending}
          suppressVerticalNav={popoverOpen}
          interceptEnter={popoverInterceptsEnter}
          onCycleAgent={handleCycleAgent}
        />

        {renderFooter(workspaceName, branch, footerAgent, columns)}
      </Box>
    </Box>
  );
}

/**
 * Mirrors `Transcript`'s own rendering of one turn (a bold role-label row, the turn's text, then its
 * `marginBottom={1}`) to estimate how many real terminal rows it occupies once printed via
 * `<Static>` — see `usedRows` in `InkApp` for why this has to be estimated rather than measured.
 * Uses `wrap-ansi` (the same library `renderFooter` below already reaches for, and what Ink's own
 * `<Text>` wrapping is built on) rather than a naive `length / columns` division: word-wrapping can
 * only ever use the same or *more* rows than that naive division (it sacrifices trailing columns
 * to avoid splitting a word), and under-counting is the unsafe direction for `usedRows` — it would
 * overshoot the terminal's real height and push already-printed content off-screen.
 */
function estimateTurnRows(turn: ChatTurn, columns: number): number {
  const width = Math.max(1, columns);
  const text = turn.text === "" ? " " : turn.text;
  const wrappedLines = text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, wrapAnsi(line, width, { hard: false, trim: false }).split("\n").length), 0);
  return 1 /* role-label row */ + wrappedLines + 1 /* Transcript's marginBottom={1} */;
}

/**
 * Ink tracks how many terminal rows its last frame occupied by counting "\n"s in the string it was
 * given — it doesn't know when a line *auto-wraps* onto extra physical rows because it's wider than
 * the terminal's current column count (confirmed against Ink's own source, `ink/build/ink.js`'s
 * `onRender`, which hands the raw rendered string straight to `log-update`'s erase-N-previous-lines
 * bookkeeping). The footer's right-hand text ("claude (sonnet) · enter send · ...") is easily long
 * enough to hit exactly that on a narrower terminal, and on a real pty this reproduced precisely the
 * cascading leftover-composer-box artifact from
 * https://github.com/vadimdemedes/ink/issues/907: shrinking the terminal in steps left each step's
 * stale frame fragment behind, stacking up. Explicitly wrapping the text ourselves at the *current*
 * width (via `useTerminalSize`, so it stays correct across a live resize) means the string Ink
 * receives already carries one "\n" per real screen row, so there's nothing left for its own
 * bookkeeping to get wrong — confirmed by re-running the same shrink sequence that reproduced the
 * bug: no leftover fragments. The common case (a wide-enough terminal) still renders as one
 * space-between row, same as before; only a narrow terminal falls back to stacking the two halves.
 */
function renderFooter(workspaceName: string, branch: string | null, footerAgent: string, columns: number): React.ReactElement {
  const left = `${workspaceName}${branch ? ` (${branch})` : ""}`;
  const right = `${footerAgent} · enter send · \\ + enter newline · / commands · shift+tab agent`;
  const width = Math.max(10, columns);

  if (left.length + right.length + 2 <= width) {
    return (
      <Box justifyContent="space-between">
        <Text dimColor>{left}</Text>
        <Text dimColor>{right}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {wrapAnsi(left, width, { hard: false, trim: false })
        .split("\n")
        .map((line, i) => (
          <Text key={`l${i}`} dimColor>
            {line}
          </Text>
        ))}
      {wrapAnsi(right, width, { hard: false, trim: false })
        .split("\n")
        .map((line, i) => (
          <Text key={`r${i}`} dimColor>
            {line}
          </Text>
        ))}
    </Box>
  );
}
