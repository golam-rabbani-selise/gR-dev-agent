import React from "react";
import { Box, Text } from "ink";
import { CREDIT, MARK_ASCII, TAGLINE, WORDMARK } from "../logo";
import { useTerminalSize } from "./useTerminalSize";

/** Below this terminal width the two-column layout has no room to breathe — see the `columns <
 * NARROW_BREAKPOINT` branch below. Exported so `InkApp` can pick the matching row count from
 * `estimateWelcomeBannerRows` without duplicating this threshold. */
export const NARROW_BREAKPOINT = 54;
const WELCOME_LEFT_RATIO = 0.2;
const MIN_LEFT_COLUMN_WIDTH = 32;
const MIN_RIGHT_COLUMN_WIDTH = 24;

export function welcomeBannerWidth(columns: number): number {
  return Math.max(NARROW_BREAKPOINT, columns);
}

export function welcomeColumnWidths(columns: number): { leftWidth: number; rightWidth: number } {
  const width = welcomeBannerWidth(columns);
  const separatorWidth = 3;
  const maxLeftWidth = Math.max(1, width - MIN_RIGHT_COLUMN_WIDTH - separatorWidth);
  const leftWidth = Math.min(Math.max(MIN_LEFT_COLUMN_WIDTH, Math.floor(width * WELCOME_LEFT_RATIO)), maxLeftWidth);
  return { leftWidth, rightWidth: Math.max(1, width - leftWidth - separatorWidth) };
}

/**
 * Exactly how many terminal rows `<WelcomeBanner>` will occupy for a given width — both of this
 * component's layouts are fully fixed-height (every line that could otherwise vary in length, e.g.
 * `modelLine`/`cwdDisplay`, is rendered with `wrap="truncate-end"` specifically so it never wraps
 * onto an extra row), so this never has to guess.
 *
 * `InkApp` needs this to reserve exactly enough room above the composer on a fresh, empty session
 * (see `isFreshLaunch` there) — without it, `InkApp` would have to either overshoot (pushing part of
 * this banner off the top of the visible screen, since Ink can't know this component's height any
 * other way before painting it) or undershoot (leaving the composer short of the terminal's bottom
 * edge). Keep this in sync with the JSX below if either layout's line count ever changes.
 */
export function estimateWelcomeBannerRows(columns: number): number {
  if (columns < NARROW_BREAKPOINT) {
    // title + rule + greeting + mark (4) + status + path + help-line + marginBottom. Verified
    // against a real render (real pty at 40x40, replayed through `pyte`) rather than left as a
    // guess — this used to say 12 (an off-by-one overcount left over from an earlier version of
    // this layout with one more line in it) until that mismatch was caught alongside the wide
    // layout's own spacer-row bug below.
    return 11;
  }
  // title + top rule + fixed 13-row two-column body + bottom rule + marginBottom. Verified the same
  // way (real pty at 130x40). Two bugs lived here until both were caught together: this used to
  // count a `<Text> </Text>` spacer row between the top rule and the two-column body that has since
  // been removed (it rendered as a genuinely empty row with no divider on it, which is what showed
  // up as a "floating"/disconnected divider in a screenshot — "scroll height besi hoya gese"'s
  // sibling report, "ey faka space ta full kore daw"); and it counted the two-column body itself as
  // 11 rows when the left column was the taller side at 10 rows. The right column is now taller at
  // 13 rows after the Workspace explainer was expanded.
  return 17;
}

export interface WelcomeBannerProps {
  version: string;
  workspaceName: string;
  branch: string | null;
  mode: string;
  agent: string;
  agentModel?: string;
  /** "Welcome back {userName}!" — see `InkAppProps.userName`. */
  userName: string;
  /** Already shortened to `~/...` when applicable — see `InkAppProps.cwdDisplay`. */
  cwdDisplay: string;
}

/**
 * The welcome panel shown above the transcript (see `showWelcome` on `InkApp` /
 * `runInkInteractive` in `src/cli/run.ts`). Command handlers temporarily unmount Ink, so the host
 * replays this panel on fresh mounts to keep the Quick start/Workspace section visible.
 */
export function WelcomeBanner({ version, mode, agent, agentModel, userName, cwdDisplay }: WelcomeBannerProps): React.ReactElement {
  const { columns } = useTerminalSize();
  const modelLabel = agentModel ?? agent;
  const statusLine = `[${shorten(modelLabel, 16)}]  [${shorten(`${agent} agent`, 18)}]  [${shorten(mode, 10)}]`;

  if (columns < NARROW_BREAKPOINT) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold color="cyan">{WORDMARK}</Text> <Text color="cyan">v{version}</Text>
        </Text>
        <Text color="cyan" wrap="truncate-end">
          {"─".repeat(Math.max(1, columns))}
        </Text>
        <Text bold wrap="truncate-end">
          Welcome back, <Text color="cyan">{userName}</Text>
        </Text>
        {MARK_ASCII.map((line, i) => (
          <Text key={i} color="cyan" wrap="truncate-end">
            {line}
          </Text>
        ))}
        <Text dimColor wrap="truncate-end">{statusLine}</Text>
        <Text dimColor wrap="truncate-end">
          {cwdDisplay}
        </Text>
        <Text wrap="truncate-end">
          <Text color="cyan">/help</Text> <Text dimColor>commands</Text>  <Text color="cyan">/agents</Text>{" "}
          <Text dimColor>workers</Text>
        </Text>
      </Box>
    );
  }

  const boxWidth = welcomeBannerWidth(columns);
  const rule = "─".repeat(Math.max(1, boxWidth));
  const { leftWidth, rightWidth } = welcomeColumnWidths(columns);

  return (
    <Box flexDirection="column" width={boxWidth} marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          {WORDMARK}  ●  <Text inverse> v{version} </Text>
        </Text>
      </Box>
      <Text color="cyan">{rule}</Text>

      <Box flexDirection="row">
        <Box
          flexDirection="column"
          alignItems="center"
          width={leftWidth}
          paddingRight={2}
          borderStyle="single"
          borderColor="cyan"
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
        >
          <Text bold wrap="truncate-end">
            Welcome back, <Text color="cyan">{userName}</Text>
          </Text>
          <Text> </Text>
          {MARK_ASCII.map((line, i) => (
            <Text key={i} color="cyan">
              {line}
            </Text>
          ))}
          <Text> </Text>
          <Text dimColor wrap="truncate-end">
            {statusLine}
          </Text>
          <Text> </Text>
          <Text dimColor wrap="truncate-end">
            {cwdDisplay}
          </Text>
        </Box>

        <Box flexDirection="column" flexGrow={1} paddingLeft={3}>
          <Text bold color="cyan">Quick start</Text>
          <Text dimColor wrap="truncate-end">
            <Text color="cyan">/help</Text>  Run /help to see every command
          </Text>
          <Text dimColor wrap="truncate-end">
            <Text color="cyan">/agents</Text>  Run /agents to choose a worker
          </Text>
          <Text> </Text>
          <Text color="cyan" wrap="truncate-end">{"─".repeat(rightWidth)}</Text>
          <Text> </Text>
          <Box flexDirection="column">
            <Text bold color="cyan">Workspace</Text>
            <Text dimColor wrap="truncate-end">
              {TAGLINE}
            </Text>
            <Text dimColor wrap="truncate-end">
              Plan tasks, route work to the right agent
            </Text>
            <Text dimColor wrap="truncate-end">
              Keep code changes separate until reviewed
            </Text>
            <Text dimColor wrap="truncate-end">
              Merge findings into one root-cause report
            </Text>
            <Text dimColor wrap="truncate-end">
              Native / Claude / Codex / Cursor / OpenCode / Manual
            </Text>
            <Text dimColor wrap="truncate-end">
              {CREDIT}
            </Text>
          </Box>
        </Box>
      </Box>
      <Text color="cyan">{rule}</Text>
    </Box>
  );
}

function shorten(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}~`;
}
