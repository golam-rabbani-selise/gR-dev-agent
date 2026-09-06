import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceStack } from "../ui/home";

export interface WorkspaceState {
  /** true once an actual project — not just the .gr-agent/ scaffold — exists. */
  hasRepo: boolean;
  /** the directory the repo/stack was detected in (workspace root, or a cloned subfolder). */
  repoRoot: string | null;
  stack: WorkspaceStack;
}

const IGNORED_DIRS = new Set([".git", ".gr-agent", ".riqs-agent", "node_modules", ".worktrees", ".cursor", ".opencode"]);

/**
 * A workspace "has a repo" once it (or an immediate subfolder — e.g. one just cloned into it) is a
 * git repository. Nothing here assumes RIQS or any particular stack; it only looks at what's on disk.
 */
export async function detectWorkspaceState(root: string): Promise<WorkspaceState> {
  const candidates = [root];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) candidates.push(path.join(root, e.name));
  }

  for (const dir of candidates) {
    if (await isDir(path.join(dir, ".git"))) {
      return { hasRepo: true, repoRoot: dir, stack: await guessStack(dir) };
    }
  }
  return { hasRepo: false, repoRoot: null, stack: "unknown" };
}

const BACKEND_FILES = ["go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "requirements.txt", "Pipfile", "pyproject.toml", "manage.py", "composer.json", "Gemfile"];
const FRONTEND_FILES = ["angular.json", "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs", "next.config.ts", "svelte.config.js", "nuxt.config.ts", "index.html"];
const FRONTEND_DEPS = ["react", "react-dom", "vue", "@angular/core", "svelte", "next", "vite", "@vitejs/plugin-react"];
const BACKEND_DEPS = ["express", "fastify", "koa", "@nestjs/core", "hapi", "restify"];

export async function guessStack(dir: string): Promise<WorkspaceStack> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const has = (name: string) => entries.includes(name);

  if (entries.some((f) => f.endsWith(".sln") || f.endsWith(".csproj"))) return "backend";
  if (FRONTEND_FILES.some(has)) return "frontend";
  if (BACKEND_FILES.some(has)) return "backend";

  if (has("package.json")) {
    const pkgHint = await guessFromPackageJson(path.join(dir, "package.json"));
    if (pkgHint !== "unknown") return pkgHint;
  }
  return "unknown";
}

async function guessFromPackageJson(file: string): Promise<WorkspaceStack> {
  try {
    const pkg = JSON.parse(await fs.readFile(file, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (FRONTEND_DEPS.some((d) => d in deps)) return "frontend";
    if (BACKEND_DEPS.some((d) => d in deps)) return "backend";
  } catch {
    /* malformed or unreadable package.json — fall through */
  }
  return "unknown";
}

async function isDir(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isDirectory()).catch(() => false);
}
