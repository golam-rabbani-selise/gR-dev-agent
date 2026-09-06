import { promises as fs } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { Platform } from "../platform/platform";
import type { WorkspaceGuard } from "./workspaceGuard";

export interface SearchHit {
  file: string;
  line: number;
  text: string;
}

export interface SearchOptions {
  glob?: string[];
  maxResults?: number;
  ignoreCase?: boolean;
}

const IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/bin/**", "**/obj/**", "**/.worktrees/**"];

/**
 * Code search. Uses ripgrep when it is on PATH (fast), otherwise a pure-Node scanner so the tool has
 * no hard external dependency (master plan §49).
 */
export class RepoSearch {
  constructor(private readonly guard: WorkspaceGuard) {}

  async grep(pattern: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const max = opts.maxResults ?? 200;
    const rg = await Platform.findExecutable("rg");
    if (rg) return this.grepRipgrep(rg, pattern, opts, max);
    return this.grepNode(pattern, opts, max);
  }

  async findFiles(glob: string | string[]): Promise<string[]> {
    const patterns = Array.isArray(glob) ? glob : [glob];
    const matches = await fg(patterns, {
      cwd: this.guard.root,
      ignore: IGNORE,
      dot: false,
      onlyFiles: true,
      suppressErrors: true,
    });
    return matches.sort();
  }

  private async grepRipgrep(rg: string, pattern: string, opts: SearchOptions, max: number): Promise<SearchHit[]> {
    const args = ["--json", "--max-count", String(max)];
    if (opts.ignoreCase) args.push("-i");
    for (const g of opts.glob ?? []) args.push("-g", g);
    for (const ig of IGNORE) args.push("-g", `!${ig}`);
    args.push("--", pattern, ".");
    const res = await Platform.run(rg, args, { cwd: this.guard.root, timeoutMs: 30_000 });
    const hits: SearchHit[] = [];
    for (const line of res.stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as any;
        if (obj.type === "match") {
          hits.push({
            file: obj.data.path.text,
            line: obj.data.line_number,
            text: String(obj.data.lines.text ?? "").replace(/\r?\n$/, "").slice(0, 400),
          });
          if (hits.length >= max) break;
        }
      } catch {
        /* skip non-JSON noise */
      }
    }
    return hits;
  }

  private async grepNode(pattern: string, opts: SearchOptions, max: number): Promise<SearchHit[]> {
    const re = new RegExp(pattern, opts.ignoreCase ? "i" : "");
    const files = await fg(opts.glob ?? ["**/*"], {
      cwd: this.guard.root,
      ignore: IGNORE,
      onlyFiles: true,
      suppressErrors: true,
      dot: false,
    });
    const hits: SearchHit[] = [];
    for (const rel of files) {
      if (hits.length >= max) break;
      const abs = path.join(this.guard.root, rel);
      let content: string;
      try {
        const buf = await fs.readFile(abs);
        if (buf.includes(0)) continue; // binary
        content = buf.toString("utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < max; i++) {
        if (re.test(lines[i]!)) hits.push({ file: rel, line: i + 1, text: lines[i]!.slice(0, 400) });
      }
    }
    return hits;
  }
}
