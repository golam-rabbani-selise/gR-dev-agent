import { Platform } from "../platform/platform";
import { log } from "../util/logger";
import { RiqsError } from "../util/errors";
import { loadManifest, type Installer } from "./integration";
import { detectIntegration } from "./detector";
import type { Config } from "../config/schema";
import type { RiqsStore } from "../riqs/store";

export interface InstallPlan {
  integrationId: string;
  displayName: string;
  installer: Installer;
  /** exact command line that would run, for display before consent (master plan §75, §82). */
  preview: string;
}

export interface InstallOutcome {
  integrationId: string;
  result: "success" | "failed" | "skipped" | "blocked";
  version?: string | null;
  message?: string;
}

/** Consent callback — the caller (CLI) owns the actual prompt UI. */
export type ConsentFn = (plans: InstallPlan[]) => Promise<InstallPlan[]>;

export function buildInstallPlan(integrationId: string, installer: Installer): InstallPlan | null {
  const platform = Platform.platform;
  if (!installer.supportedPlatforms.includes(platform)) return null;
  const preview =
    installer.method === "manual" || installer.command === null
      ? installer.manualInstructions ?? `Manual install — see ${installer.sourceUrl ?? "vendor documentation"}`
      : `${installer.command} ${installer.args.join(" ")}`;
  return { integrationId, displayName: integrationId, installer, preview };
}

export async function planInstalls(ids: string[], config: Config): Promise<{ plans: InstallPlan[]; blocked: InstallOutcome[] }> {
  const manifest = await loadManifest();
  const policy = config.integrations.installation;
  const plans: InstallPlan[] = [];
  const blocked: InstallOutcome[] = [];

  for (const id of ids) {
    const entry = manifest.integrations[id];
    if (!entry) {
      blocked.push({ integrationId: id, result: "blocked", message: "unknown integration" });
      continue;
    }
    if (!policy.enabled) {
      blocked.push({ integrationId: id, result: "blocked", message: "installation disabled by policy (§96)" });
      continue;
    }
    if (!policy.allowedIntegrations.includes(id)) {
      blocked.push({ integrationId: id, result: "blocked", message: "integration not in allowedIntegrations" });
      continue;
    }
    const status = await detectIntegration(id);
    if (status.installed) {
      blocked.push({ integrationId: id, result: "skipped", message: `already installed (${status.version ?? "unknown version"})` });
      continue;
    }
    const usable = entry.installers.find(
      (i) => policy.allowedMethods.includes(i.method) && i.supportedPlatforms.includes(Platform.platform) && i.command !== null,
    );
    const installer = usable ?? entry.installers[0];
    if (!installer) {
      blocked.push({ integrationId: id, result: "blocked", message: "no installer for this platform" });
      continue;
    }
    const plan = buildInstallPlan(id, installer);
    if (!plan) {
      blocked.push({ integrationId: id, result: "blocked", message: "installer not supported on this platform" });
      continue;
    }
    plan.displayName = entry.displayName;
    plans.push(plan);
  }
  return { plans, blocked };
}

/**
 * Execute an approved install plan. Nothing runs without prior consent, no elevation is ever
 * attempted, and the model never supplies the command — it comes verbatim from the manifest
 * (master plan §75, §84, §92, §93).
 */
export async function runInstalls(
  approved: InstallPlan[],
  opts: { store: RiqsStore; nonInteractive: boolean; signal?: AbortSignal },
): Promise<InstallOutcome[]> {
  const outcomes: InstallOutcome[] = [];
  for (const plan of approved) {
    const { installer } = plan;
    if (opts.nonInteractive) {
      outcomes.push({ integrationId: plan.integrationId, result: "blocked", message: "non-interactive mode never installs (§118)" });
      continue;
    }
    if (installer.requiresElevation) {
      outcomes.push({
        integrationId: plan.integrationId,
        result: "blocked",
        message: "requires administrator privileges — run the official elevated installer yourself (§84)",
      });
      await audit(opts.store, plan, false, "blocked-elevation");
      continue;
    }
    if (installer.method === "manual" || installer.command === null) {
      log.info(`${plan.displayName}: ${plan.preview}`);
      outcomes.push({ integrationId: plan.integrationId, result: "skipped", message: "manual installation required" });
      await audit(opts.store, plan, false, "manual");
      continue;
    }

    log.step(`Installing ${plan.displayName}: ${plan.preview}`);
    let ok = false;
    try {
      const cmd = await Platform.findExecutable(installer.command);
      if (!cmd) throw new RiqsError("INTEGRATION", `${installer.command} not found on PATH`);
      const res = await Platform.run(cmd, installer.args, { inherit: true, timeoutMs: 10 * 60_000, signal: opts.signal });
      ok = res.exitCode === 0;
    } catch (e) {
      outcomes.push({ integrationId: plan.integrationId, result: "failed", message: (e as Error).message });
      await audit(opts.store, plan, true, "failed");
      continue;
    }

    const verify = await detectIntegration(plan.integrationId);
    if (ok && verify.installed) {
      outcomes.push({ integrationId: plan.integrationId, result: "success", version: verify.version });
      await audit(opts.store, plan, true, "success", verify.version);
    } else {
      outcomes.push({ integrationId: plan.integrationId, result: "failed", message: "command completed but executable not detected" });
      await audit(opts.store, plan, true, "verify-failed");
    }
  }
  return outcomes;
}

async function audit(store: RiqsStore, plan: InstallPlan, approved: boolean, result: string, version?: string | null): Promise<void> {
  await store.appendAudit({
    kind: "integration.install",
    tool: plan.integrationId,
    method: plan.installer.method,
    command: plan.preview,
    approved,
    result,
    version: version ?? null,
  });
}
