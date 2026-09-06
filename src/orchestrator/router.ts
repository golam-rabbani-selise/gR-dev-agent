import type { Config } from "../config/schema";
import type { PlanNode, Role } from "../riqs/contracts";
import type { WorkerRegistry, WorkerEntry } from "../workers/registry";
import { RiqsError } from "../util/errors";
import { log } from "../util/logger";

export interface RouteRequest {
  node: PlanNode;
  taskCategory: string;
  /** explicit per-task routing supplied on the CLI (highest priority, master plan §154). */
  taskRouting?: Partial<Record<Role, string | string[]>>;
  disabledWorkers?: string[];
}

export interface RouteDecision {
  nodeId: string;
  role: Role;
  workers: WorkerEntry[]; // >1 => ensemble (master plan §143)
  reason: string;
  strictUnavailable?: string;
}

/**
 * Routing priority (master plan §154):
 *   1. explicit current-task instruction (node.worker / taskRouting)
 *   2. task-type defaults
 *   3. global routing map
 *   4. global preferences (ordered fallback)
 *   5. any ready worker holding the role
 * Strict policy never silently substitutes; fallback does but says so (§145).
 */
export class Router {
  constructor(
    private readonly config: Config,
    private readonly registry: WorkerRegistry,
  ) {}

  route(req: RouteRequest): RouteDecision {
    const { node } = req;
    const role = node.role;
    const disabled = new Set(req.disabledWorkers ?? []);
    const strict = this.config.routingPolicy === "strict";

    const pick = (ids: string | string[] | undefined, reason: string, explicit = false): RouteDecision | null => {
      if (!ids) return null;
      const wanted = Array.isArray(ids) ? ids : [ids];
      const resolved = wanted.map((id) => this.registry.get(id)).filter((e): e is WorkerEntry => !!e && !disabled.has(e.id));
      // Explicit user routing may target an installed-but-unverified worker (§154); auto routing needs `ready`.
      const usable = resolved.filter((e) => e.enabled && (e.ready || (explicit && e.present)));
      for (const e of usable) {
        if (explicit && !e.ready && e.present) log.warn(`route ${node.id}: using "${e.id}" on your explicit instruction (readiness not verified)`);
      }
      if (usable.length === wanted.length) return { nodeId: node.id, role, workers: usable, reason };
      if (usable.length > 0 && !strict) {
        log.warn(`route ${node.id}: ${wanted.filter((w) => !usable.some((r) => r.id === w)).join(", ")} unavailable; proceeding with ${usable.map((r) => r.id).join(", ")}`);
        return { nodeId: node.id, role, workers: usable, reason: reason + " (partial, fallback)" };
      }
      if (strict) return { nodeId: node.id, role, workers: [], reason, strictUnavailable: wanted.join(", ") };
      return null;
    };

    return (
      pick(node.worker ?? undefined, "explicit plan-node routing", true) ??
      pick(req.taskRouting?.[role], "explicit per-task routing", true) ??
      pick(this.config.taskDefaults[req.taskCategory]?.[role], `task-type default (${req.taskCategory})`) ??
      pick(this.config.routing[role], "global routing map") ??
      this.byPreference(node, role, disabled, strict) ??
      this.anyReady(node, role, disabled, strict)
    );
  }

  private byPreference(node: PlanNode, role: Role, disabled: Set<string>, strict: boolean): RouteDecision | null {
    const order = this.config.preferences[role] ?? (this.config.primaryWorker ? [this.config.primaryWorker] : []);
    for (const id of order) {
      const e = this.registry.get(id);
      if (e && e.enabled && e.ready && !disabled.has(id)) {
        return { nodeId: node.id, role, workers: [e], reason: "global preference order" };
      }
    }
    if (strict && order.length) return { nodeId: node.id, role, workers: [], reason: "global preference order", strictUnavailable: order.join(", ") };
    return null;
  }

  private anyReady(node: PlanNode, role: Role, disabled: Set<string>, strict: boolean): RouteDecision {
    const candidates = this.registry.forRole(role).filter((e) => !disabled.has(e.id));
    if (candidates.length === 0) {
      // single-tool fallback (master plan §28, §130): fall back to native, then manual.
      const native = this.registry.get("native");
      if (native && native.enabled && native.ready && !disabled.has("native")) {
        return { nodeId: node.id, role, workers: [native], reason: "single-tool fallback → native" };
      }
      if (strict) throw new RiqsError("WORKER", `No ready worker for role "${role}" and routing policy is strict`);
      return { nodeId: node.id, role, workers: [], reason: "no ready worker → manual handoff", strictUnavailable: role };
    }
    const primary = this.config.primaryWorker
      ? candidates.find((c) => c.id === this.config.primaryWorker)
      : undefined;
    return { nodeId: node.id, role, workers: [primary ?? candidates[0]!], reason: "first ready worker for role" };
  }
}
