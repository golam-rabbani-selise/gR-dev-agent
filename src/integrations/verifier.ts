import { Platform } from "../platform/platform";
import { loadManifest } from "./integration";
import { detectIntegration } from "./detector";

export interface VerifyResult {
  id: string;
  ok: boolean;
  details: string[];
}

/** Post-install / post-login readiness check with a harmless health command (master plan §91). */
export async function verifyIntegration(id: string): Promise<VerifyResult> {
  const manifest = await loadManifest();
  const entry = manifest.integrations[id];
  const details: string[] = [];
  if (!entry) return { id, ok: false, details: ["unknown integration"] };

  const status = await detectIntegration(id);
  details.push(status.installed ? `executable: ${status.executablePath}` : "executable: not found");
  if (status.version) details.push(`version: ${status.version}`);
  details.push(`auth: ${status.auth}`);
  details.push(`readiness: ${status.readiness}`);

  if (status.installed) {
    const exe = status.executablePath!;
    const res = await Platform.run(exe, entry.healthArgs, { timeoutMs: 15_000 }).catch(() => null);
    details.push(`health command exit: ${res ? res.exitCode : "error"}`);
  }

  return { id, ok: status.readiness === "ready", details };
}
