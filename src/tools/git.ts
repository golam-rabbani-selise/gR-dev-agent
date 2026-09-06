import { Platform } from "../platform/platform";
import { RiqsError } from "../util/errors";

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
}

/**
 * Git via argv arrays and machine-readable output only (master plan §51). Never parses localized
 * human output. When git is absent, `available()` is false and write features stay disabled.
 */
export class Git {
  constructor(
    private readonly cwd: string,
    private readonly gitPath: string,
  ) {}

  static async open(cwd: string): Promise<Git | null> {
    const gitPath = await Platform.findExecutable("git");
    if (!gitPath) return null;
    const g = new Git(cwd, gitPath);
    const res = await g.raw(["rev-parse", "--is-inside-work-tree"]);
    return res.exitCode === 0 && res.stdout.trim() === "true" ? g : null;
  }

  async raw(args: string[], opts: { signal?: AbortSignal } = {}) {
    return Platform.run(this.gitPath, args, { cwd: this.cwd, timeoutMs: 60_000, signal: opts.signal });
  }

  private async must(args: string[]): Promise<string> {
    const res = await this.raw(args);
    if (res.exitCode !== 0) {
      throw new RiqsError("GIT", `git ${args.join(" ")} failed: ${res.stderr.trim() || res.stdout.trim()}`);
    }
    return res.stdout;
  }

  async version(): Promise<string> {
    return (await this.must(["--version"])).trim();
  }

  async currentBranch(): Promise<string> {
    return (await this.must(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  }

  async headSha(): Promise<string> {
    return (await this.must(["rev-parse", "HEAD"])).trim();
  }

  async status(): Promise<GitStatusEntry[]> {
    const out = await this.must(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const parts = out.split("\0").filter(Boolean);
    const entries: GitStatusEntry[] = [];
    for (let i = 0; i < parts.length; i++) {
      const rec = parts[i]!;
      const xy = rec.slice(0, 2);
      const p = rec.slice(3);
      if (xy[0] === "R" || xy[1] === "R") i++; // rename: skip the paired old-path token
      entries.push({ path: p, index: xy[0]!.trim(), worktree: xy[1]!.trim() });
    }
    return entries;
  }

  async isClean(): Promise<boolean> {
    return (await this.status()).length === 0;
  }

  async diff(args: string[] = []): Promise<string> {
    return this.must(["diff", "--no-color", ...args]);
  }

  async diffStat(args: string[] = []): Promise<string> {
    return this.must(["diff", "--stat", "--no-color", ...args]);
  }

  // --- worktree isolation (master plan §7, §8) ---

  async worktreeAdd(dir: string, branch: string, base = "HEAD"): Promise<void> {
    await this.must(["worktree", "add", "-b", branch, dir, base]);
  }

  async worktreeList(): Promise<{ path: string; branch: string; sha: string }[]> {
    const out = await this.must(["worktree", "list", "--porcelain", "-z"]);
    const blocks = out.split("\0\0").filter(Boolean);
    return blocks.map((b) => {
      const lines = b.split("\0");
      const get = (k: string) => lines.find((l) => l.startsWith(k + " "))?.slice(k.length + 1) ?? "";
      return { path: get("worktree"), branch: get("branch").replace("refs/heads/", ""), sha: get("HEAD") };
    });
  }

  async worktreeRemove(dir: string, force = false): Promise<void> {
    await this.must(["worktree", "remove", ...(force ? ["--force"] : []), dir]);
  }
}
