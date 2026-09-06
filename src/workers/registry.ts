import type { AgentWorker } from "./worker";
import { NativeWorker } from "./nativeWorker";
import { ManualWorker } from "./manualWorker";
import { CliWorker } from "./cliWorker";
import type { Config, WorkersConfig, AgentsConfig } from "../config/schema";
import type { Role } from "../riqs/contracts";
import { IntegrationRegistry } from "../integrations/registry";
import { loadManifest } from "../integrations/integration";
import { resolveNativeProvider, resolveProvider } from "../llm/registry";
import { log } from "../util/logger";

export interface WorkerEntry {
  id: string;
  worker: AgentWorker;
  roles: Role[];
  enabled: boolean;
  /** ready = eligible for AUTO routing (installed + authenticated/none-required, master plan §97). */
  ready: boolean;
  /** present = the tool exists and can be used when the user routes to it EXPLICITLY (§154). */
  present: boolean;
  /** underlying integration/provider for reporting. */
  backing: string;
  model?: string;
}

export interface WorkerRegistry {
  entries: Map<string, WorkerEntry>;
  /** manual handoff is always present as a last resort (master plan §152). */
  manual: AgentWorker;
  list(): WorkerEntry[];
  ready(): WorkerEntry[];
  get(id: string): WorkerEntry | undefined;
  forRole(role: Role): WorkerEntry[];
}

export async function buildWorkerRegistry(opts: {
  config: Config;
  workers: WorkersConfig;
  agents: AgentsConfig;
  nativeProviderOverride?: string;
}): Promise<WorkerRegistry> {
  const { config, workers, agents } = opts;
  const integrations = new IntegrationRegistry();
  await integrations.refresh();
  const manifest = await loadManifest();

  const entries = new Map<string, WorkerEntry>();

  // --- native worker(s) ---
  const nativeCfg = workers.workers["native"];
  if (!nativeCfg || nativeCfg.enabled) {
    try {
      const resolved = resolveNativeProvider(config, opts.nativeProviderOverride);
      entries.set("native", {
        id: "native",
        worker: new NativeWorker("native", resolved.provider, resolved.model === "default" ? undefined : resolved.model),
        roles: nativeCfg?.roles ?? (["planner", "investigator", "backend", "frontend", "coder", "tester", "reviewer", "general"] as Role[]),
        enabled: true,
        ready: true,
        present: true,
        backing: `${resolved.providerId}:${resolved.model}`,
      });
    } catch (e) {
      log.warn(`native worker unavailable: ${(e as Error).message}`);
      entries.set("native", {
        id: "native",
        worker: new ManualWorker("native"),
        roles: nativeCfg?.roles ?? [],
        enabled: nativeCfg?.enabled ?? true,
        ready: false,
        present: false,
        backing: "unconfigured",
      });
    }
  }

  // --- external CLI workers, from workers.json + manifest + detected readiness ---
  for (const [id, entry] of Object.entries(manifest.integrations)) {
    const wc = workers.workers[id];
    const status = integrations.get(id);
    const ready = integrations.isReady(id);
    const present = status?.installed === true && status.readiness !== "broken";
    const spec = entry.worker;
    entries.set(id, {
      id,
      worker: new CliWorker({
        id,
        executables: entry.executables,
        promptDelivery: spec.promptDelivery,
        argv: spec.argv,
        useWorktreeCwd: spec.useWorktreeCwd,
        writesResultFile: spec.writesResultFile,
      }),
      roles: wc?.roles ?? [],
      enabled: wc?.enabled ?? false,
      ready,
      present,
      backing: `${id}${status?.version ? " " + status.version : ""}`,
    });
  }

  // --- named agents (worker + model + roles), master plan §164 ---
  for (const [agentId, ac] of Object.entries(agents.agents)) {
    if (!ac.enabled) continue;
    const backingEntry = entries.get(ac.worker);
    let worker: AgentWorker;
    let ready = false;
    if (ac.worker === "native") {
      try {
        // Prefer an explicit provider config keyed by the agent id or its model name.
        const explicit = config.native.providers[agentId] ?? config.native.providers[ac.model];
        const p = explicit ? resolveProvider(agentId, explicit) : resolveNativeProvider(config).provider;
        worker = new NativeWorker(agentId, p, ac.model === "default" ? undefined : ac.model);
        ready = true;
      } catch (e) {
        log.warn(`agent ${agentId} native provider unavailable: ${(e as Error).message}`);
        worker = new ManualWorker(agentId);
      }
    } else if (backingEntry) {
      worker = backingEntry.worker;
      ready = backingEntry.ready;
    } else {
      worker = new ManualWorker(agentId);
    }
    entries.set(agentId, { id: agentId, worker, roles: ac.roles, enabled: true, ready, present: ready || !!backingEntry?.present, backing: `${ac.worker}:${ac.model}`, model: ac.model });
  }

  const registry: WorkerRegistry = {
    entries,
    manual: new ManualWorker("manual"),
    list: () => [...entries.values()],
    ready: () => [...entries.values()].filter((e) => e.enabled && e.ready),
    get: (id) => entries.get(id),
    forRole: (role) => [...entries.values()].filter((e) => e.enabled && e.ready && e.roles.includes(role)),
  };
  return registry;
}
