import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { detectEol, type EolStyle } from "./lineEndings";

/** Read + parse JSON, returning `fallback` when the file is missing. */
export async function readJson<T>(file: string, fallback?: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" && fallback !== undefined) return fallback;
    throw e;
  }
}

/** Detect the EOL style of an existing text file (defaults to LF when absent). */
export async function detectFileEol(file: string): Promise<EolStyle> {
  try {
    return detectEol(await fs.readFile(file, "utf8"));
  } catch {
    return { eol: "\n", finalNewline: true, mixed: false };
  }
}

/**
 * Atomic write: write to a sibling temp file then rename. Preserves the target's existing EOL style
 * for text payloads. JSON is always serialised with 2-space indent + trailing newline.
 */
export async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  await fs.writeFile(tmp, contents, "utf8");
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}
