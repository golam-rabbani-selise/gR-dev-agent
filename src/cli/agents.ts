import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { writeAgents } from "../config/loader";
import { RoleSchema } from "../riqs/contracts";
import { table } from "../ui/render";
import { log } from "../util/logger";
import { RiqsError } from "../util/errors";
import { text, multiselect } from "../ui/prompt";

export function registerAgents(program: Command): void {
  const cmd = program.command("agents").description("named worker+model personas (master plan §164-§192)");

  cmd
    .command("list", { isDefault: true })
    .action(async () => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const rows = Object.entries(ctx.agents.agents).map(([id, a]) => [id, a.worker, a.model, String(a.enabled), a.roles.join(",")]);
      log.info(rows.length ? table(["agent", "worker", "model", "enabled", "roles"], rows) : "No agents defined.");
    });

  cmd
    .command("create")
    .description("interactively create an agent")
    .action(async () => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const name = await text("Agent id", "claude-opus-architect");
      if (!name) return;
      const worker = await text("Backing worker", "native");
      if (!worker) return;
      const model = (await text("Model (blank = default)", "opus")) || "default";
      const roles = await multiselect(
        "Roles",
        RoleSchema.options.map((r) => ({ value: r, label: r })),
      );
      ctx.agents.agents[name] = { worker, model, enabled: true, roles, skills: [], capabilities: [] };
      await writeAgents(ctx.paths, ctx.agents);
      log.success(`agent ${name} created`);
    });

  cmd
    .command("set <id> <field> <value>")
    .description("set worker|model|enabled on an agent")
    .action(async (id: string, field: string, value: string) => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const a = ctx.agents.agents[id];
      if (!a) throw new RiqsError("CONFIG", `Unknown agent: ${id}`);
      if (field === "worker") a.worker = value;
      else if (field === "model") a.model = value;
      else if (field === "enabled") a.enabled = value === "true";
      else throw new RiqsError("CONFIG", `Unknown field: ${field}`);
      await writeAgents(ctx.paths, ctx.agents);
      log.success(`agent ${id}.${field} = ${value}`);
    });

  cmd
    .command("delete <id>")
    .action(async (id: string) => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      if (!ctx.agents.agents[id]) throw new RiqsError("CONFIG", `Unknown agent: ${id}`);
      delete ctx.agents.agents[id];
      await writeAgents(ctx.paths, ctx.agents);
      log.success(`agent ${id} deleted`);
    });
}
