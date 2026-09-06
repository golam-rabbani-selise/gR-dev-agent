import React from "react";
import { Box, Static, Text } from "ink";
import type { ChatTurn } from "../home";
import { WelcomeBanner, type WelcomeBannerProps } from "./WelcomeBanner";

/** One line printed to the transcript's `<Static>` stream, in order: at most one `welcome` item
 * (always first, when present), then one `turn` item per chat turn. A union rather than just
 * `ChatTurn[]` because the welcome banner has to be *inside* the same `<Static>` list as the chat
 * turns — see the comment below on why it can't just sit next to `<Transcript>` in `InkApp`'s own
 * (non-static) tree. */
export type TranscriptItem = { kind: "welcome"; banner: WelcomeBannerProps } | { kind: "turn"; turn: ChatTurn };

export interface TranscriptProps {
  items: TranscriptItem[];
}

/**
 * The chat history — and, when present, the welcome banner — printed via Ink's `<Static>`:
 * each item is written to the real terminal once, permanently (genuine terminal scrollback: native
 * mouse-wheel/tmux scrolling just works), instead of through an app-managed bounded viewport. This
 * is deliberate, matching how Claude Code's own CLI behaves: the conversation flows down from the
 * top of the terminal like a normal chat log, and the composer sits right after the latest turn —
 * not forced down to fill the terminal's height.
 *
 * The welcome banner has to be one of these `<Static>` items rather than a normal sibling of
 * `<Transcript>` in `InkApp`'s tree (which is what an earlier version did): Ink erases and rewrites
 * its *entire* non-static ("dynamic") output on every render, then writes any newly-flushed static
 * items *before* that freshly-redrawn dynamic output. A banner living in the dynamic tree therefore
 * gets reprinted underneath every new chat turn instead of staying above the conversation where it
 * belongs — confirmed via a real pty run: the first submitted message ended up printed above the
 * banner, not below it. Folding the banner into the same static stream (always item 0, before any
 * turns) means it's genuinely "printed once and never touched again," same as every chat turn.
 *
 * An earlier version of this file replaced `<Static>` entirely with a hand-rolled scrollable
 * viewport specifically so the composer could be pinned to the *bottom* of the window regardless of
 * conversation length — that's no longer the goal (top-down flow, matching Claude Code, is what's
 * wanted instead), and dropping it also removes the failure mode it introduced: pinning the composer
 * meant treating the whole app as one `rows`-tall box, and a full clear was needed on every terminal
 * resize to avoid Ink's own line-height-tracking bug (https://github.com/vadimdemedes/ink/issues/907)
 * leaving duplicate stacked frames behind — but that same clear also wiped the real terminal
 * scrollback out from under this component's `<Static>` output, since `<Static>` never replays an
 * item once it's been flushed. With no bottom-pinning and no forced full-height box, there's no need
 * to clear on resize at all, so that failure mode is gone along with the viewport.
 *
 * `<Static>` only ever prints items it hasn't already printed *for this particular mount* — a fresh
 * Ink instance (e.g. after a `/command` round-trip unmounted and remounted Ink) starts blank unless
 * handed everything said so far up front. `InkApp` builds `items` from its `history` state, which its
 * `initialHistory` prop seeds with every prior turn before the first render, so this component sees
 * them all as "not yet printed by this instance" and reprints them immediately on mount.
 */
export function Transcript({ items }: TranscriptProps): React.ReactElement {
  return (
    <Static items={items}>
      {(item, index) => {
        if (item.kind === "welcome") {
          return <WelcomeBanner key={index} {...item.banner} />;
        }
        const { turn } = item;
        return (
          <Box key={index} flexDirection="column" marginBottom={1}>
            <Text color={turn.role === "user" ? "cyan" : "green"} bold>
              {turn.role === "user" ? "You" : (turn.agent ?? "Assistant")}
            </Text>
            <Text>{turn.text === "" ? " " : turn.text}</Text>
          </Box>
        );
      }}
    </Static>
  );
}
