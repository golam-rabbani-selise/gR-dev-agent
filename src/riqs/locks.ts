import { promises as fs } from "node:fs";
import path from "node:path";
import { RiqsPaths } from "./paths";
import { RiqsError } from "../util/errors";

/**
 * Lock-directory based file ownership (master plan §6, §33). Two parallel writers must never touch
 * one path in the same working tree — the scheduler acquires a lock per owned path prefix and
 * serialises anyone who collides. `mkdir` is atomic on every supported filesystem.
 */
export class LockManager {
  constructor(private readonly paths: RiqsPaths) {}

  private lockPath(key: string): string {
    const safe = key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200) || "root";
    return path.join(this.paths.locksDir(), `${safe}.lock`);
  }

  async acquire(key: string, owner: string, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<() => Promise<void>> {
    const dir = this.lockPath(key);
    await fs.mkdir(this.paths.locksDir(), { recursive: true });
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    const poll = opts.pollMs ?? 200;

    for (;;) {
      try {
        await fs.mkdir(dir);
        await fs.writeFile(path.join(dir, "owner"), `${owner}\n${new Date().toISOString()}\n`, "utf8");
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          await fs.rm(dir, { recursive: true, force: true });
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (Date.now() > deadline) {
          const holder = await fs.readFile(path.join(dir, "owner"), "utf8").catch(() => "unknown");
          throw new RiqsError("LOCK", `Timed out waiting for lock "${key}" held by ${holder.split("\n")[0]}`);
        }
        await new Promise((r) => setTimeout(r, poll));
      }
    }
  }

  async withLock<T>(key: string, owner: string, fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T> {
    const release = await this.acquire(key, owner, opts);
    try {
      return await fn();
    } finally {
      await release();
    }
  }

  async listLocks(): Promise<string[]> {
    const entries = await fs.readdir(this.paths.locksDir()).catch(() => [] as string[]);
    return entries.filter((e) => e.endsWith(".lock"));
  }
}
