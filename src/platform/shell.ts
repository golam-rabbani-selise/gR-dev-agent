import { currentPlatform } from "./paths";
import { findExecutable } from "./executable";

/**
 * Shell resolution (master plan §48). Only used when the user explicitly asks for a shell
 * expression; normal command execution uses argv arrays with `shell: false`.
 */
export async function getDefaultShell(): Promise<string> {
  if (currentPlatform() === "win32") {
    for (const c of ["pwsh", "powershell", "cmd"]) {
      const found = await findExecutable(c);
      if (found) return found;
    }
    return "cmd.exe";
  }
  if (process.env.SHELL) return process.env.SHELL;
  for (const c of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    const found = await findExecutable(c);
    if (found) return found;
  }
  return "/bin/sh";
}

export function shellArgsFor(shellPath: string, command: string): string[] {
  const lower = shellPath.toLowerCase();
  if (lower.includes("powershell") || lower.includes("pwsh")) return ["-NoProfile", "-Command", command];
  if (lower.includes("cmd")) return ["/d", "/s", "/c", command];
  return ["-c", command];
}
