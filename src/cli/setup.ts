import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { detectAll } from "../integrations/detector";
import { planInstalls, runInstalls } from "../integrations/installer";
import { loginIntegration } from "../integrations/authManager";
import { table, heading } from "../ui/render";
import { log } from "../util/logger";
import { confirm, multiselect, intro, outro } from "../ui/prompt";

/** Guided onboarding (master plan §114, §115, §125). Every side effect is individually consented. */
export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("guided: detect tools, (optionally) install + sign in to workers, then run doctor")
    .action(async () => {
      const g = program.opts<GlobalOpts>();
      const ctx = await resolveContext(g, false);
      intro("gR DEV AGENT Setup");

      log.info(heading("Platform & workspace"));
      const initialised = ctx.initialised;
      if (!initialised) log.warn("No agent directory here yet — run `gr-agent init` first (then re-run setup).");

      log.info("\n" + heading("AI workers"));
      let statuses = await detectAll();
      log.info(table(["worker", "readiness"], statuses.map((s) => [s.displayName, s.readiness.toUpperCase()])));

      if (!ctx.nonInteractive) {
        const missing = statuses.filter((s) => s.readiness === "missing").map((s) => s.id);
        if (missing.length && (await confirm("Install missing AI workers?", false))) {
          const chosen = await multiselect(
            "Select workers to install",
            missing.map((id) => ({ value: id, label: statuses.find((s) => s.id === id)!.displayName })),
          );
          if (chosen.length) {
            const { plans, blocked } = await planInstalls(chosen, ctx.config);
            for (const b of blocked) log.info(`  ${b.integrationId}: ${b.result} — ${b.message ?? ""}`);
            for (const p of plans) log.info(`  ${p.displayName}: ${p.preview}${p.installer.verified ? "" : "  (verify against vendor docs)"}`);
            if (plans.length && (await confirm(`Proceed with ${plans.length} installation(s)?`, false))) {
              const outcomes = await runInstalls(plans, { store: ctx.store, nonInteractive: ctx.nonInteractive });
              log.info(table(["worker", "result"], outcomes.map((o) => [o.integrationId, o.result])));
            }
          }
        }

        statuses = await detectAll();
        const loginNeeded = statuses.filter((s) => s.readiness === "login_required").map((s) => s.id);
        if (loginNeeded.length && (await confirm(`Sign in to ${loginNeeded.join(", ")} now?`, false))) {
          for (const id of loginNeeded) {
            const outcome = await loginIntegration(id, {
              store: ctx.store,
              nonInteractive: ctx.nonInteractive,
              approve: async (m) => confirm(`Launch ${id} login (${m.command} ${m.args.join(" ")})?`, false),
            });
            log.info(`  ${id}: ${outcome.result}`);
          }
        }
      }

      statuses = await detectAll();
      const ready = statuses.filter((s) => s.readiness === "ready").map((s) => s.displayName);
      log.success(`Ready external workers: ${ready.join(", ") || "none (native worker only)"}`);
      outro("Setup complete. Try: gr-agent run --workflow bug-fix \"<task>\"");
    });
}
