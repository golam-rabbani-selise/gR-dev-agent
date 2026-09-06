import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { detectAll, detectIntegration } from "../integrations/detector";
import { planInstalls, runInstalls, type InstallPlan } from "../integrations/installer";
import { verifyIntegration } from "../integrations/verifier";
import { KNOWN_INTEGRATIONS } from "../integrations/integration";
import { table, heading } from "../ui/render";
import { log } from "../util/logger";
import { confirm, multiselect } from "../ui/prompt";

export function registerIntegrations(program: Command): void {
  const cmd = program.command("integrations").description("detect / install / verify external agent CLIs (master plan §74-§99)");

  cmd
    .command("list", { isDefault: true })
    .alias("detect")
    .action(async () => {
      const g = program.opts<GlobalOpts>();
      await resolveContext(g, false);
      const statuses = await detectAll();
      log.info(
        table(
          ["integration", "installed", "auth", "readiness", "version"],
          statuses.map((s) => [s.displayName, s.installed ? "yes" : "no", s.installed ? s.auth : "-", s.readiness.toUpperCase(), s.version ?? ""]),
        ),
      );
    });

  cmd
    .command("verify <id>")
    .action(async (id: string) => {
      await resolveContext(program.opts<GlobalOpts>(), false);
      const res = await verifyIntegration(id);
      log.info(`${id}: ${res.ok ? "READY" : "not ready"}`);
      for (const d of res.details) log.info(`  ${d}`);
    });

  cmd
    .command("install [ids...]")
    .description("install missing integrations (consent required for each)")
    .action(async (ids: string[]) => {
      const g = program.opts<GlobalOpts>();
      const ctx = await resolveContext(g, false);
      const targets = ids.length ? ids : [...KNOWN_INTEGRATIONS];
      const { plans, blocked } = await planInstalls(targets, ctx.config);
      for (const b of blocked) log.info(`  ${b.integrationId}: ${b.result} — ${b.message ?? ""}`);
      if (!plans.length) {
        log.info("Nothing to install.");
        return;
      }
      const approved = await approvePlans(plans, ctx.nonInteractive);
      if (!approved.length) {
        log.warn("No installs approved.");
        return;
      }
      const outcomes = await runInstalls(approved, { store: ctx.store, nonInteractive: ctx.nonInteractive });
      log.info("\n" + table(["integration", "result", "detail"], outcomes.map((o) => [o.integrationId, o.result, o.message ?? o.version ?? ""])));
    });

  cmd
    .command("setup")
    .description("guided detect → install → verify for all integrations")
    .action(async () => {
      const g = program.opts<GlobalOpts>();
      const ctx = await resolveContext(g, false);
      log.info(heading("Scanning integrations…"));
      const statuses = await detectAll();
      log.info(
        table(["integration", "readiness"], statuses.map((s) => [s.displayName, s.readiness.toUpperCase()])),
      );
      const missing = statuses.filter((s) => s.readiness === "missing").map((s) => s.id);
      if (!missing.length) {
        log.success("All known integrations are installed.");
        return;
      }
      const chosen = ctx.nonInteractive
        ? []
        : await multiselect(
            "Install which missing integrations?",
            missing.map((id) => ({ value: id, label: statuses.find((s) => s.id === id)!.displayName })),
          );
      if (!chosen.length) {
        log.info("Skipped. gR DEV AGENT works with the native worker alone.");
        return;
      }
      const { plans, blocked } = await planInstalls(chosen, ctx.config);
      for (const b of blocked) log.info(`  ${b.integrationId}: ${b.result} — ${b.message ?? ""}`);
      const approved = await approvePlans(plans, ctx.nonInteractive);
      if (!approved.length) return;
      const outcomes = await runInstalls(approved, { store: ctx.store, nonInteractive: ctx.nonInteractive });
      log.info("\n" + table(["integration", "result"], outcomes.map((o) => [o.integrationId, o.result])));
      for (const o of outcomes.filter((x) => x.result === "success")) {
        const v = await detectIntegration(o.integrationId);
        if (v.readiness === "login_required") log.warn(`${o.integrationId}: installed but login required — run \`gr-agent auth login ${o.integrationId}\``);
      }
    });
}

/** Per-plan consent, then a single explicit batch confirmation (master plan §82, §83). */
async function approvePlans(plans: InstallPlan[], nonInteractive: boolean): Promise<InstallPlan[]> {
  if (nonInteractive) {
    log.warn("non-interactive: no installs performed (§118)");
    return [];
  }
  log.info("\n" + heading("Planned installations"));
  for (const p of plans) {
    log.info(`\n${p.displayName}`);
    log.info(`  method: ${p.installer.method}`);
    log.info(`  command: ${p.preview}`);
    if (p.installer.sourceUrl) log.info(`  source: ${p.installer.sourceUrl}`);
    if (!p.installer.verified) log.warn("  metadata not marked verified — confirm the command matches the vendor's current docs");
  }
  const selected: InstallPlan[] = [];
  for (const p of plans) {
    if (await confirm(`Install ${p.displayName} with: ${p.preview} ?`, false)) selected.push(p);
  }
  if (!selected.length) return [];
  const ok = await confirm(`Proceed with ${selected.length} installation(s)?`, false);
  return ok ? selected : [];
}
