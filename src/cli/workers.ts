import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { writeWorkers } from "../config/loader";
import { buildWorkerRegistry } from "../workers/registry";
import { RoleSchema, type Role } from "../riqs/contracts";
import { table } from "../ui/render";
import { log } from "../util/logger";
import { RiqsError } from "../util/errors";

export function registerWorkers(program: Command): void {
  const cmd = program.command("workers").description("inspect and configure workers (master plan §126-§138)");

  cmd
    .command("list", { isDefault: true })
    .description("show workers, their roles and readiness")
    .action(async () => {
      const g = program.opts<GlobalOpts>();
      const ctx = await resolveContext(g);
      const registry = await buildWorkerRegistry({ config: ctx.config, workers: ctx.workers, agents: ctx.agents });
      log.info(
        table(
          ["worker", "enabled", "ready", "roles", "backing"],
          registry.list().map((e) => [e.id, String(e.enabled), String(e.ready), e.roles.join(",") || "-", e.backing]),
        ),
      );
    });

  cmd
    .command("enable <id>")
    .description("enable a worker")
    .action((id: string) => setEnabled(program, id, true));
  cmd
    .command("disable <id>")
    .description("disable a worker")
    .action((id: string) => setEnabled(program, id, false));

  cmd
    .command("assign <id> <role>")
    .description("give a worker a role")
    .action((id: string, role: string) => mutateRole(program, id, role, true));
  cmd
    .command("unassign <id> <role>")
    .description("remove a role from a worker")
    .action((id: string, role: string) => mutateRole(program, id, role, false));
}

async function setEnabled(program: Command, id: string, enabled: boolean): Promise<void> {
  const ctx = await resolveContext(program.opts<GlobalOpts>());
  const w = ctx.workers.workers[id] ?? { enabled, roles: [], capabilities: [] };
  ctx.workers.workers[id] = { ...w, enabled };
  await writeWorkers(ctx.paths, ctx.workers);
  log.success(`worker ${id} ${enabled ? "enabled" : "disabled"}`);
}

async function mutateRole(program: Command, id: string, role: string, add: boolean): Promise<void> {
  const parsed = RoleSchema.safeParse(role);
  if (!parsed.success) throw new RiqsError("CONFIG", `Unknown role: ${role}`, { hint: `Valid: ${RoleSchema.options.join(", ")}` });
  const ctx = await resolveContext(program.opts<GlobalOpts>());
  const w = ctx.workers.workers[id] ?? { enabled: true, roles: [] as Role[], capabilities: [] };
  const roles = new Set<Role>(w.roles);
  if (add) roles.add(parsed.data);
  else roles.delete(parsed.data);
  ctx.workers.workers[id] = { ...w, roles: [...roles] };
  await writeWorkers(ctx.paths, ctx.workers);
  log.success(`worker ${id}: roles = ${[...roles].join(", ") || "(none)"}`);
}
