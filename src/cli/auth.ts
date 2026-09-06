import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { detectAll } from "../integrations/detector";
import { loginIntegration, logoutIntegration } from "../integrations/authManager";
import { KNOWN_INTEGRATIONS } from "../integrations/integration";
import { table } from "../ui/render";
import { log } from "../util/logger";
import { confirm } from "../ui/prompt";

export function registerAuth(program: Command): void {
  const cmd = program.command("auth").description("external integration authentication (master plan §101-§124)");

  cmd
    .command("status", { isDefault: true })
    .action(async () => {
      await resolveContext(program.opts<GlobalOpts>(), false);
      const statuses = await detectAll();
      log.info(
        table(
          ["integration", "installed", "authenticated", "ready"],
          statuses.map((s) => [
            s.displayName,
            s.installed ? "yes" : "no",
            s.auth === "authenticated" ? "yes" : s.auth === "not_required" ? "n/a" : s.auth,
            s.readiness === "ready" ? "yes" : "no",
          ]),
        ),
      );
    });

  cmd
    .command("login [id]")
    .description("launch a vendor's official login flow (with your consent)")
    .action(async (id: string | undefined) => {
      const g = program.opts<GlobalOpts>();
      const ctx = await resolveContext(g, false);
      const targets = id ? [id] : [...KNOWN_INTEGRATIONS];
      for (const t of targets) {
        const outcome = await loginIntegration(t, {
          store: ctx.store,
          nonInteractive: ctx.nonInteractive,
          approve: async (method, exe) => {
            log.info(`\n${t}: will run \`${method.command} ${method.args.join(" ")}\` (${exe})`);
            log.info("gR DEV AGENT will not see or store your credentials.");
            return confirm(`Launch ${t} login now?`, false);
          },
        });
        log.info(`  ${t}: ${outcome.result}${outcome.message ? ` — ${outcome.message}` : ""}`);
      }
    });

  cmd
    .command("logout <id>")
    .action(async (id: string) => {
      const ctx = await resolveContext(program.opts<GlobalOpts>(), false);
      const outcome = await logoutIntegration(id, ctx.store);
      log.info(`${id}: ${outcome.message ?? outcome.result}`);
    });
}
