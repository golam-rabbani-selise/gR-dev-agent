import * as clack from "@clack/prompts";
import { Platform } from "../platform/platform";

/**
 * Thin prompt wrapper. In non-interactive mode every prompt fails closed (returns the safe default
 * or throws), so nothing side-effecting can proceed without a real human (master plan §118).
 */
export function interactive(): boolean {
  return !Platform.isNonInteractive();
}

export async function confirm(message: string, initial = false): Promise<boolean> {
  if (!interactive()) return false;
  const r = await clack.confirm({ message, initialValue: initial });
  if (clack.isCancel(r)) return false;
  return r;
}

export async function text(message: string, placeholder?: string): Promise<string | null> {
  if (!interactive()) return null;
  const r = await clack.text({ message, placeholder });
  if (clack.isCancel(r)) return null;
  return r;
}

export async function multiselect<T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
): Promise<T[]> {
  if (!interactive()) return [];
  const r = await clack.multiselect({ message, options: options as never, required: false });
  if (clack.isCancel(r)) return [];
  return r as T[];
}

export async function select<T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
  initialValue?: T,
): Promise<T | null> {
  if (!interactive()) return null;
  const r = await clack.select({ message, options: options as never, initialValue: initialValue as never });
  if (clack.isCancel(r)) return null;
  return r as T;
}

/** Like select(), but with a type-to-filter search box — for a list too long to scroll through
 * comfortably (e.g. /model's ~90-200 real options for some agents). */
export async function autocomplete<T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
  initialValue?: T,
): Promise<T | null> {
  if (!interactive()) return null;
  const r = await clack.autocomplete({
    message,
    options: options as never,
    placeholder: "Type to search…",
    maxItems: 10,
    initialValue: initialValue as never,
  });
  if (clack.isCancel(r)) return null;
  return r as T;
}

export const note = clack.note;
export const intro = clack.intro;
export const outro = clack.outro;
