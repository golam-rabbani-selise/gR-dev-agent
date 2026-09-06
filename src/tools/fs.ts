import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceGuard } from "./workspaceGuard";
import { detectFileEol, writeFileAtomic } from "../util/json";
import { applyEol } from "../util/lineEndings";
import { RiqsError } from "../util/errors";

const DEFAULT_MAX_BYTES = 512 * 1024;

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
}

export class RepoFs {
  constructor(private readonly guard: WorkspaceGuard) {}

  async readFile(rel: string, opts: { maxBytes?: number } = {}): Promise<ReadFileResult> {
    const abs = await this.guard.resolveInside(rel);
    const stat = await fs.stat(abs).catch(() => {
      throw new RiqsError("WORKSPACE", `File not found: ${rel}`);
    });
    if (stat.isDirectory()) throw new RiqsError("WORKSPACE", `Not a file: ${rel}`);
    const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const buf = await fs.readFile(abs);
    const slice = buf.subarray(0, max);
    return {
      path: this.guard.relative(abs),
      content: slice.toString("utf8"),
      truncated: buf.byteLength > max,
      bytes: buf.byteLength,
    };
  }

  async listDir(rel = "."): Promise<{ path: string; entries: { name: string; type: "file" | "dir" }[] }> {
    const abs = await this.guard.resolveInside(rel);
    const dirents = await fs.readdir(abs, { withFileTypes: true });
    return {
      path: this.guard.relative(abs),
      entries: dirents
        .filter((d) => d.name !== ".git" && d.name !== "node_modules")
        .map((d) => ({ name: d.name, type: d.isDirectory() ? ("dir" as const) : ("file" as const) }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)),
    };
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await this.guard.resolveInside(rel);
      await fs.access(path.join(this.guard.root, rel));
      return true;
    } catch {
      return false;
    }
  }

  /** Write inside the workspace, preserving the target file's existing line-ending style (§61). */
  async writeFile(rel: string, content: string): Promise<void> {
    const abs = await this.guard.resolveInside(rel);
    const style = await detectFileEol(abs);
    await writeFileAtomic(abs, applyEol(content, style));
  }
}
