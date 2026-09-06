import React from "react";
import { Box, Text } from "ink";
import { filterSlashCommands, type SlashCommand } from "../home";

export interface CommandPopoverProps {
  query: string;
  selectedIndex: number;
}

/**
 * The "/" command palette — filters `SLASH_COMMANDS` from `src/ui/home.ts` (the single source of
 * truth for the command list, also used by the legacy composer) as the user types, instead of the
 * legacy flow's separate full-screen select step.
 */
export function CommandPopover({ query, selectedIndex }: CommandPopoverProps): React.ReactElement | null {
  const matches = filterSlashCommands(query);
  if (matches.length === 0) return null;
  const clampedIndex = Math.max(0, Math.min(selectedIndex, matches.length - 1));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {matches.map((c: SlashCommand, i: number) => {
        const selected = i === clampedIndex;
        return (
          <Text key={c.id} color={selected ? "cyan" : undefined} backgroundColor={selected ? "#17343a" : undefined}>
            {c.id.padEnd(14)} {c.desc}
            {c.comingSoon ? " (soon)" : ""}
          </Text>
        );
      })}
    </Box>
  );
}

/** Clamp a popover selection index into range after the filtered list changes size. */
export function clampPopoverIndex(index: number, query: string): number {
  const count = filterSlashCommands(query).length;
  if (count === 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}
