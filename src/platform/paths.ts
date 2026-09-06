import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import envPaths from "env-paths";

export type NodePlatform = "darwin" | "win32" | "linux";

export function currentPlatform(): NodePlatform {
  const p = process.platform;
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "linux";
}

/** Normalise a path for the current platform without touching the filesystem. */
export function normalizePath(p: string): string {
  return path.normalize(p);
}

/** Absolute, resolved path (no symlink resolution). */
export function resolvePath(...segments: string[]): string {
  return path.resolve(...segments);
}

/**
 * True when `child` is the same as, or nested under, `parent`. Both are resolved first. This is a
 * lexical check — callers that need symlink-safety must use `realParentContains`.
 */
export function isSubPath(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Symlink/junction-safe containment: resolves real paths before comparing (master plan §63). */
export async function realParentContains(parent: string, child: string): Promise<boolean> {
  const realParent = await fs.realpath(parent);
  let probe = path.resolve(child);
  // Walk up until we find an existing ancestor we can realpath (child may not exist yet).
  for (;;) {
    try {
      const realChild = await fs.realpath(probe);
      return isSubPath(realParent, realChild);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const next = path.dirname(probe);
      if (next === probe) return false;
      probe = next;
    }
  }
}

export function tmpDir(): string {
  return os.tmpdir();
}

/** Per-user config/data/cache directories, platform-appropriate (master plan §55). */
export function userPaths() {
  return envPaths("gr-dev-agent", { suffix: "" });
}

export function homeDir(): string {
  return os.homedir();
}
