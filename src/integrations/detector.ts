import { Platform } from "../platform/platform";
import {
  loadManifest,
  type IntegrationManifestEntry,
  type IntegrationStatus,
  type IntegrationReadiness,
  type AuthenticationState,
} from "./integration";

/**
 * Detect an external agent CLI: presence, version, and — where the manifest tells us how — auth
 * state (master plan §77, §78, §90). We never assume "installed" means "ready" (§90).
 */
export async function detectIntegration(id: string): Promise<IntegrationStatus> {
  const manifest = await loadManifest();
  const entry = manifest.integrations[id];
  if (!entry) {
    return { id, displayName: id, installed: false, executablePath: null, version: null, auth: "unknown", readiness: "unsupported" };
  }

  const exe = await firstExecutable(entry);
  if (!exe) {
    return { id, displayName: entry.displayName, installed: false, executablePath: null, version: null, auth: "unknown", readiness: "missing" };
  }

  let version: string | null = null;
  let broken = false;
  try {
    const res = await Platform.run(exe, entry.versionArgs, { timeoutMs: 15_000 });
    version = firstLine(res.stdout || res.stderr) || null;
    if (res.exitCode !== 0 && !version) broken = true;
  } catch {
    broken = true;
  }

  const auth = await detectAuth(entry, exe);
  const readiness = computeReadiness({ installed: true, broken, auth, hasAuthMethods: entry.authentication.methods.length > 0 });

  return { id, displayName: entry.displayName, installed: true, executablePath: exe, version, auth, readiness };
}

export async function detectAll(ids?: string[]): Promise<IntegrationStatus[]> {
  const manifest = await loadManifest();
  const list = ids ?? Object.keys(manifest.integrations);
  return Promise.all(list.map((id) => detectIntegration(id)));
}

async function firstExecutable(entry: IntegrationManifestEntry): Promise<string | null> {
  for (const name of entry.executables) {
    const p = await Platform.findExecutable(name);
    if (p) return p;
  }
  return null;
}

/**
 * Auth detection. The manifest can carry `statusArgs` for a non-destructive status command; without
 * a verified way to check, we report `unknown` rather than guessing (master plan §120, §111).
 */
async function detectAuth(entry: IntegrationManifestEntry, exe: string): Promise<AuthenticationState> {
  if (entry.authentication.methods.length === 0) return "not_required";
  const statusArgs = entry.authentication.statusArgs;
  if (!statusArgs) return "unknown";
  try {
    const res = await Platform.run(exe, statusArgs, { timeoutMs: 15_000 });
    return parseAuthStatus(res.stdout, res.stderr, res.exitCode);
  } catch {
    return "unknown";
  }
}

/**
 * Classify a status command's output. Some tools reply with structured JSON (e.g. `claude auth
 * status --json` -> `{"loggedIn": true}`) rather than a human sentence, so we try that first —
 * checking common boolean field names — before falling back to the plain-text heuristic. Exported
 * for unit testing without spawning a real process.
 */
export function parseAuthStatus(stdout: string, stderr: string, exitCode: number): AuthenticationState {
  const boolFields = ["loggedIn", "isLoggedIn", "authenticated", "isAuthenticated", "logged_in", "is_authenticated"];
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object") {
      for (const field of boolFields) {
        const v = (parsed as Record<string, unknown>)[field];
        if (typeof v === "boolean") return v ? "authenticated" : "not_authenticated";
      }
    }
  } catch {
    // Not JSON — fall through to the text heuristic below.
  }
  const text = `${stdout}\n${stderr}`.toLowerCase();
  if (exitCode === 0 && /logged in|authenticated|active session/.test(text)) return "authenticated";
  if (/not logged in|unauthenticated|login required|no api key/.test(text)) return "not_authenticated";
  // Some tools (e.g. `opencode auth list`) report a credential count instead of a sentence.
  const credentialCount = /(\d+)\s+credentials?/.exec(text);
  if (exitCode === 0 && credentialCount) return Number(credentialCount[1]) > 0 ? "authenticated" : "not_authenticated";
  if (exitCode === 0 && /no (stored )?credentials/.test(text)) return "not_authenticated";
  return "unknown";
}

function computeReadiness(x: {
  installed: boolean;
  broken: boolean;
  auth: AuthenticationState;
  hasAuthMethods: boolean;
}): IntegrationReadiness {
  if (!x.installed) return "missing";
  if (x.broken) return "broken";
  if (!x.hasAuthMethods || x.auth === "not_required" || x.auth === "authenticated") return "ready";
  if (x.auth === "not_authenticated" || x.auth === "expired" || x.auth === "invalid") return "login_required";
  // auth unknown but installed: treat as installed (not routed until confirmed) — conservative.
  return "installed";
}

function firstLine(s: string): string {
  return s.split(/\r?\n/)[0]?.trim() ?? "";
}
