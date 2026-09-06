import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader (no dependency). Values already present in process.env win, so shell exports
 * and CI secrets are never overridden by a committed file.
 */
export async function loadDotEnv(dir: string, file = ".env"): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, file), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const key = m[1]!;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Read the first environment variable that is set from a candidate list. */
export function envAny(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim() !== "") return v;
  }
  return undefined;
}

export function isNonInteractive(): boolean {
  return (
    process.argv.includes("--non-interactive") ||
    process.env.RIQS_NON_INTERACTIVE === "1" ||
    process.env.CI === "true" ||
    !process.stdin.isTTY
  );
}
