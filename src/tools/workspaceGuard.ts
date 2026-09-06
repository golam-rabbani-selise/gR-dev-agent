import { promises as fs } from "node:fs";
import path from "node:path";
import { Platform } from "../platform/platform";
import { RiqsError } from "../util/errors";

/**
 * Confines every file operation to the workspace root (master plan §46, §63, §159 — a hard boundary
 * that routing/skip can never disable). Resolves real paths so an in-workspace symlink or junction
 * cannot point outside.
 */
export class WorkspaceGuard {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(root: string): Promise<WorkspaceGuard> {
    const resolved = path.resolve(root);
    let real: string;
    try {
      real = await fs.realpath(resolved);
    } catch {
      throw new RiqsError("WORKSPACE", `Workspace does not exist: ${resolved}`);
    }
    return new WorkspaceGuard(real);
  }

  /** Resolve a possibly-relative path and assert it stays inside the workspace. */
  async resolveInside(target: string): Promise<string> {
    const abs = path.isAbsolute(target) ? target : path.join(this.root, target);
    const contained = await Platform.realParentContains(this.root, abs);
    if (!contained) {
      throw new RiqsError("WORKSPACE", `Path escapes the workspace: ${target}`, {
        hint: "Workers may only read and write inside the workspace root.",
      });
    }
    return path.resolve(abs);
  }

  /** Synchronous lexical check for hot paths that cannot await (defence-in-depth, not the primary gate). */
  isLexicallyInside(target: string): boolean {
    const abs = path.isAbsolute(target) ? target : path.join(this.root, target);
    return Platform.isSubPath(this.root, abs);
  }

  relative(target: string): string {
    return path.relative(this.root, path.resolve(target)) || ".";
  }
}
