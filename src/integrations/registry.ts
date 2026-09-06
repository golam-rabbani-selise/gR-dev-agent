import { detectAll } from "./detector";
import { loadManifest, type IntegrationStatus } from "./integration";

/**
 * The integration registry the orchestrator consults. Only `ready` integrations are eligible to be
 * routed real work (master plan §97, §105).
 */
export class IntegrationRegistry {
  private statuses = new Map<string, IntegrationStatus>();

  async refresh(): Promise<void> {
    const all = await detectAll();
    this.statuses = new Map(all.map((s) => [s.id, s]));
  }

  get(id: string): IntegrationStatus | undefined {
    return this.statuses.get(id);
  }

  all(): IntegrationStatus[] {
    return [...this.statuses.values()];
  }

  isReady(id: string): boolean {
    return this.statuses.get(id)?.readiness === "ready";
  }

  async workerInvoke(id: string) {
    const manifest = await loadManifest();
    return manifest.integrations[id]?.worker;
  }
}
