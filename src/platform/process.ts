import { execa, type Options as ExecaOptions, type ResultPromise } from "execa";
import { currentPlatform } from "./paths";
import { CancelledError } from "../util/errors";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Pass stdin/stdout/stderr straight through to the terminal (interactive login flows, §108). */
  inherit?: boolean;
  input?: string;
  timeoutMs?: number;
  /** Abort signal; when it fires the child is terminated cross-platform. */
  signal?: AbortSignal;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  command: string;
}

/** Live children, so a global cancel can tear the whole tree down (master plan §64). */
const liveChildren = new Set<ResultPromise>();

export function killAllChildren(): void {
  for (const child of liveChildren) {
    try {
      child.kill("SIGTERM");
      const pid = child.pid;
      setTimeout(() => {
        try {
          if (pid) process.kill(pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }, 3000).unref();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Spawn a process with an argv array and `shell: false` (master plan §47). Never build a command
 * string. Windows process-tree teardown is handled by execa's `windowsHide` + kill semantics.
 */
export async function runProcess(file: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const execaOpts: ExecaOptions = {
    cwd: opts.cwd,
    env: opts.env as Record<string, string> | undefined,
    extendEnv: true,
    stdin: opts.input !== undefined ? "pipe" : opts.inherit ? "inherit" : "ignore",
    stdout: opts.inherit ? "inherit" : "pipe",
    stderr: opts.inherit ? "inherit" : "pipe",
    timeout: opts.timeoutMs,
    reject: false,
    windowsHide: true,
    cancelSignal: opts.signal,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  };

  const child = execa(file, args, execaOpts);
  liveChildren.add(child);
  try {
    const res = await child;
    if (opts.signal?.aborted) throw new CancelledError(`Cancelled: ${file}`);
    return {
      exitCode: res.exitCode ?? (res.failed ? 1 : 0),
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr : "",
      timedOut: Boolean(res.timedOut),
      command: `${file} ${args.join(" ")}`.trim(),
    };
  } finally {
    liveChildren.delete(child);
  }
}

export function supportsProcessGroups(): boolean {
  return currentPlatform() !== "win32";
}
