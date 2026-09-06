import { Platform } from "../platform/platform";
import { log } from "../util/logger";
import { RiqsError } from "../util/errors";
import { loadManifest, type AuthMethod } from "./integration";
import { detectIntegration } from "./detector";
import type { RiqsStore } from "../riqs/store";

export interface LoginOutcome {
  integrationId: string;
  result: "authenticated" | "unknown" | "failed" | "skipped";
  message?: string;
}

/**
 * Login onboarding (master plan §101–124). gR DEV AGENT only *launches* the vendor's own official
 * login flow with the terminal attached; it never sees, stores, or proxies credentials.
 */
export async function loginIntegration(
  id: string,
  opts: { store: RiqsStore; nonInteractive: boolean; approve: (m: AuthMethod, exe: string) => Promise<boolean>; signal?: AbortSignal },
): Promise<LoginOutcome> {
  if (opts.nonInteractive) {
    return { integrationId: id, result: "skipped", message: "non-interactive mode never launches login (§118)" };
  }
  const manifest = await loadManifest();
  const entry = manifest.integrations[id];
  if (!entry) throw new RiqsError("INTEGRATION", `Unknown integration: ${id}`);
  if (entry.authentication.methods.length === 0) {
    return { integrationId: id, result: "authenticated", message: "no authentication required" };
  }

  const status = await detectIntegration(id);
  if (!status.installed) return { integrationId: id, result: "failed", message: "not installed" };

  const method = entry.authentication.methods[0]!;
  if (!method.command) {
    return { integrationId: id, result: "skipped", message: `login method "${method.type}" has no automatable command — sign in with ${entry.displayName} directly` };
  }
  const exe = await Platform.findExecutable(method.command);
  if (!exe) return { integrationId: id, result: "failed", message: `${method.command} not found` };

  const approved = await opts.approve(method, exe);
  if (!approved) {
    await opts.store.appendAudit({ kind: "integration.login", integration: id, userApproved: false, result: "declined" });
    return { integrationId: id, result: "skipped", message: "login declined" };
  }

  log.step(`Launching ${entry.displayName} official login (${method.command} ${method.args.join(" ")}) …`);
  log.info("gR DEV AGENT will not see or store your password.");
  const res = await Platform.run(exe, method.args, { inherit: true, timeoutMs: 15 * 60_000, signal: opts.signal });

  // Re-verify (master plan §111). Without a verified status command we can only report `unknown`.
  const after = await detectIntegration(id);
  const result: LoginOutcome["result"] =
    after.auth === "authenticated" ? "authenticated" : res.exitCode === 0 ? "unknown" : "failed";
  await opts.store.appendAudit({ kind: "integration.login", integration: id, userApproved: true, result });
  return {
    integrationId: id,
    result,
    message:
      result === "unknown"
        ? "login process completed; gR DEV AGENT cannot verify the session automatically for this tool"
        : undefined,
  };
}

export async function logoutIntegration(id: string, store: RiqsStore): Promise<LoginOutcome> {
  const manifest = await loadManifest();
  const entry = manifest.integrations[id];
  if (!entry) throw new RiqsError("INTEGRATION", `Unknown integration: ${id}`);
  await store.appendAudit({ kind: "integration.logout", integration: id, userApproved: true, result: "requested" });
  return { integrationId: id, result: "skipped", message: `Run the ${entry.displayName} logout command directly.` };
}
