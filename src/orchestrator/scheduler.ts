import type { PlanNode } from "../riqs/contracts";
import { DependencyGraph } from "./dependencyGraph";
import type { AssignmentStore } from "./assignmentStore";
import { log } from "../util/logger";
import { CancelledError } from "../util/errors";

export interface SchedulerOptions {
  parallelism: number;
  /** pairs of node ids that must not run concurrently (writer file-ownership overlap, §33). */
  mutex: [string, string][];
  signal?: AbortSignal;
}

export type NodeRunner = (node: PlanNode) => Promise<"COMPLETED" | "FAILED">;

/**
 * Generic DAG executor (master plan §7, §8, §9). Runs ready nodes up to `parallelism`, honours
 * mutual-exclusion pairs by serialising them, blocks descendants of failed nodes, and is
 * cancellation-safe: on abort it stops scheduling new work and lets in-flight nodes settle.
 */
export class Scheduler {
  constructor(
    private readonly graph: DependencyGraph,
    private readonly assignments: AssignmentStore,
  ) {}

  async run(runner: NodeRunner, opts: SchedulerOptions): Promise<void> {
    const inFlight = new Map<string, Promise<void>>();
    const running = new Set<string>();

    const conflicts = (id: string): boolean =>
      opts.mutex.some(([a, b]) => (a === id && running.has(b)) || (b === id && running.has(a)));

    while (true) {
      const completed = this.assignments.completed();
      const terminal = this.assignments.terminal();
      const failed = this.assignments.failed();

      // Block anything whose dependency failed.
      for (const node of this.graph.blockedBy(failed)) {
        if (!terminal.has(node.id) && this.assignments.get(node.id) === "PENDING") {
          log.warn(`${node.id}: blocked (upstream failure)`);
          await this.assignments.set(node.id, "BLOCKED");
        }
      }

      if (this.assignments.allSettled(this.graph.size) && inFlight.size === 0) break;

      const abort = opts.signal?.aborted;
      let ready = abort ? [] : this.graph.ready(this.assignments.completed(), this.assignments.terminal());
      ready = ready.filter((n) => this.assignments.get(n.id) === "PENDING" && !running.has(n.id) && !conflicts(n.id));

      while (running.size < opts.parallelism && ready.length > 0) {
        const node = ready.shift()!;
        if (conflicts(node.id)) continue;
        running.add(node.id);
        void this.assignments.set(node.id, "RUNNING");
        const p = (async () => {
          try {
            const outcome = await runner(node);
            await this.assignments.set(node.id, outcome);
          } catch (e) {
            if (e instanceof CancelledError) {
              await this.assignments.set(node.id, "CANCELLED");
            } else {
              log.error(`${node.id} crashed: ${(e as Error).message}`);
              await this.assignments.set(node.id, "FAILED");
            }
          } finally {
            running.delete(node.id);
            inFlight.delete(node.id);
          }
        })();
        inFlight.set(node.id, p);
        ready = ready.filter((n) => !conflicts(n.id));
      }

      if (inFlight.size === 0) {
        if (abort) break;
        // nothing running and nothing ready but not all settled → deadlock guard
        if (this.graph.ready(completed, terminal).length === 0) {
          log.warn("scheduler: no runnable nodes remain; stopping");
          break;
        }
        continue;
      }
      await Promise.race(inFlight.values());
    }

    await Promise.allSettled(inFlight.values());
    if (opts.signal?.aborted) throw new CancelledError("Run cancelled");
  }
}
