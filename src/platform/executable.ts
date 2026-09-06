import { promises as fs, constants as FS } from "node:fs";
import path from "node:path";
import { currentPlatform } from "./paths";

/**
 * Windows-aware executable discovery (master plan §50). `npm` may really be `npm.cmd`, `git` may be
 * `git.exe`, etc. We never call the shell's `which`/`where`.
 */
function executableExtensions(): string[] {
  if (currentPlatform() !== "win32") return [""];
  const pathext = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1";
  return ["", ...pathext.split(";").map((e) => e.toLowerCase())];
}

async function isExecutableFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) return false;
    if (currentPlatform() === "win32") return true;
    await fs.access(p, FS.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findExecutable(name: string): Promise<string | null> {
  const exts = executableExtensions();

  // Absolute or explicitly-relative path: test directly.
  if (name.includes(path.sep) || name.includes("/")) {
    const base = path.resolve(name);
    for (const ext of exts) {
      const cand = base + ext;
      if (await isExecutableFile(cand)) return cand;
    }
    return null;
  }

  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path.join(dir, name + ext);
      if (await isExecutableFile(cand)) return cand;
    }
  }
  return null;
}

export async function isCommandAvailable(name: string): Promise<boolean> {
  return (await findExecutable(name)) !== null;
}
