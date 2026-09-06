import {
  currentPlatform,
  normalizePath,
  resolvePath,
  isSubPath,
  realParentContains,
  tmpDir,
  userPaths,
  homeDir,
  type NodePlatform,
} from "./paths";
import { findExecutable, isCommandAvailable } from "./executable";
import { getDefaultShell } from "./shell";
import { runProcess, killAllChildren, type RunOptions, type RunResult } from "./process";
import { loadDotEnv, envAny, isNonInteractive } from "./environment";

/**
 * The single platform-service surface (master plan §45). Nothing else in the codebase should read
 * `process.platform` directly — import from here instead.
 */
export interface PlatformService {
  readonly platform: NodePlatform;
  readonly isWindows: boolean;
  readonly isMac: boolean;

  normalizePath(p: string): string;
  resolvePath(...s: string[]): string;
  isSubPath(parent: string, child: string): boolean;
  realParentContains(parent: string, child: string): Promise<boolean>;

  findExecutable(name: string): Promise<string | null>;
  isCommandAvailable(name: string): Promise<boolean>;
  getDefaultShell(): Promise<string>;

  run(file: string, args: string[], opts?: RunOptions): Promise<RunResult>;
  killAllChildren(): void;

  tmpDir(): string;
  homeDir(): string;
  userPaths(): { data: string; config: string; cache: string; log: string; temp: string };

  loadDotEnv(dir: string, file?: string): Promise<void>;
  envAny(...keys: string[]): string | undefined;
  isNonInteractive(): boolean;
}

const platform = currentPlatform();

export const Platform: PlatformService = {
  platform,
  isWindows: platform === "win32",
  isMac: platform === "darwin",

  normalizePath,
  resolvePath,
  isSubPath,
  realParentContains,

  findExecutable,
  isCommandAvailable,
  getDefaultShell,

  run: runProcess,
  killAllChildren,

  tmpDir,
  homeDir,
  userPaths,

  loadDotEnv,
  envAny,
  isNonInteractive,
};
