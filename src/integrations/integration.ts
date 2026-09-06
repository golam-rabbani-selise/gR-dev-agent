import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { parseOrThrow } from "../riqs/contracts";
import { RiqsError } from "../util/errors";

export type NodePlatform = "darwin" | "win32" | "linux";

const InstallerSchema = z.object({
  id: z.string(),
  method: z.enum(["npm", "brew", "winget", "choco", "scoop", "official-installer", "manual"]),
  command: z.string().nullable(),
  args: z.array(z.string()).default([]),
  sourceUrl: z.string().nullable().optional(),
  requiresElevation: z.boolean().default(false),
  supportedPlatforms: z.array(z.enum(["darwin", "win32", "linux"])).default(["darwin", "win32", "linux"]),
  verified: z.boolean().default(false),
  manualInstructions: z.string().optional(),
});
export type Installer = z.infer<typeof InstallerSchema>;

const AuthMethodSchema = z.object({
  id: z.string(),
  type: z.enum(["interactive-cli", "browser-oauth", "device-code", "api-key", "provider-managed", "manual"]),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).default([]),
  verified: z.boolean().default(false),
});
export type AuthMethod = z.infer<typeof AuthMethodSchema>;

const WorkerInvokeSchema = z.object({
  promptDelivery: z.enum(["stdin", "file", "arg"]).default("arg"),
  argv: z.array(z.string()).default([]),
  useWorktreeCwd: z.boolean().default(true),
  writesResultFile: z.boolean().default(false),
  verified: z.boolean().default(false),
});

const IntegrationSchema = z.object({
  displayName: z.string(),
  executables: z.array(z.string()).min(1),
  versionArgs: z.array(z.string()).default(["--version"]),
  healthArgs: z.array(z.string()).default(["--version"]),
  installers: z.array(InstallerSchema).default([]),
  authentication: z.object({ methods: z.array(AuthMethodSchema).default([]), statusArgs: z.array(z.string()).nullable().default(null) }).default({ methods: [], statusArgs: null }),
  worker: WorkerInvokeSchema.default({}),
  /**
   * The model this CLI genuinely uses when we don't pass --model ourselves — set ONLY when directly
   * confirmed against the vendor's own CLI output (e.g. `cursor-agent models` marking one "(current,
   * default)"), never guessed. Forcing an unverified --model has broken real invocations (codex
   * rejected an assumed model outright), so most entries leave this unset rather than fabricate one.
   */
  defaultModelLabel: z.string().optional(),
});
export type IntegrationManifestEntry = z.infer<typeof IntegrationSchema>;

export const ManifestSchema = z.object({
  schemaVersion: z.number(),
  note: z.string().optional(),
  integrations: z.record(z.string(), IntegrationSchema),
});
export type IntegrationsManifest = z.infer<typeof ManifestSchema>;

let cached: IntegrationsManifest | null = null;

export async function loadManifest(): Promise<IntegrationsManifest> {
  if (cached) return cached;
  const candidates = [
    fileURLToPath(new URL("../integrations.manifest.json", import.meta.url)),
    fileURLToPath(new URL("../../integrations.manifest.json", import.meta.url)),
    path.resolve(process.cwd(), "integrations.manifest.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8"));
      cached = parseOrThrow(ManifestSchema, raw, "integrations.manifest.json");
      return cached;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  throw new RiqsError("INTEGRATION", "integrations.manifest.json not found");
}

export const KNOWN_INTEGRATIONS = ["claude", "codex", "cursor", "opencode", "antigravity"] as const;
export type IntegrationId = (typeof KNOWN_INTEGRATIONS)[number];

export type IntegrationReadiness = "missing" | "installed" | "login_required" | "ready" | "broken" | "unsupported";

export type AuthenticationState =
  | "unknown"
  | "not_required"
  | "not_authenticated"
  | "authentication_in_progress"
  | "authenticated"
  | "expired"
  | "invalid"
  | "error";

export interface IntegrationStatus {
  id: string;
  displayName: string;
  installed: boolean;
  executablePath: string | null;
  version: string | null;
  auth: AuthenticationState;
  readiness: IntegrationReadiness;
}
