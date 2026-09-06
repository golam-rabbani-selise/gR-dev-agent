import { isColor } from "../util/logger";
import pc from "picocolors";

/** Plain-text table with an ASCII fallback — never depends on Unicode box-drawing (master plan §67). */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => (c ?? "").padEnd(widths[i]!)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

export function statusMark(ok: boolean | "warn"): string {
  if (ok === "warn") return isColor() ? pc.yellow("!") : "!";
  return ok ? (isColor() ? pc.green("OK") : "OK") : isColor() ? pc.red("--") : "--";
}

export function heading(text: string): string {
  return isColor() ? pc.bold(pc.cyan(text)) : text;
}
