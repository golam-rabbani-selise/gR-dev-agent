import type { AssignmentState } from "../riqs/contracts";
import type { RiqsStore } from "../riqs/store";

/**
 * In-memory assignment state machine (master plan §8), mirrored to the checkpoint on every change so
 * a resume from any tool sees the same progress.
 */
export class AssignmentStore {
  private states = new Map<string, AssignmentState>();
  private onChange?: () => Promise<void>;

  constructor(private readonly store: RiqsStore) {}

  bindPersist(fn: () => Promise<void>): void {
    this.onChange = fn;
  }

  hydrate(states: Record<string, AssignmentState>): void {
    this.states = new Map(Object.entries(states));
  }

  snapshot(): Record<string, AssignmentState> {
    return Object.fromEntries(this.states);
  }

  get(id: string): AssignmentState {
    return this.states.get(id) ?? "PENDING";
  }

  async set(id: string, state: AssignmentState): Promise<void> {
    this.states.set(id, state);
    await this.store.appendAudit({ kind: "assignment.state", id, state });
    if (this.onChange) await this.onChange();
  }

  completed(): Set<string> {
    return new Set([...this.states].filter(([, s]) => s === "COMPLETED").map(([id]) => id));
  }

  terminal(): Set<string> {
    return new Set([...this.states].filter(([, s]) => s === "COMPLETED" || s === "FAILED" || s === "CANCELLED").map(([id]) => id));
  }

  failed(): Set<string> {
    return new Set([...this.states].filter(([, s]) => s === "FAILED").map(([id]) => id));
  }

  allSettled(total: number): boolean {
    const settled = [...this.states.values()].filter((s) => s === "COMPLETED" || s === "FAILED" || s === "CANCELLED" || s === "BLOCKED").length;
    return settled >= total;
  }
}
