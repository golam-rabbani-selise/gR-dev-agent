import type { PlanNode } from "../riqs/contracts";
import { RiqsError } from "../util/errors";

/** JSON DAG over plan nodes (master plan §9). */
export class DependencyGraph {
  private nodes = new Map<string, PlanNode>();

  constructor(nodes: PlanNode[]) {
    for (const n of nodes) {
      if (this.nodes.has(n.id)) throw new RiqsError("INTERNAL", `Duplicate plan node id: ${n.id}`);
      this.nodes.set(n.id, n);
    }
    for (const n of nodes) {
      for (const dep of n.dependsOn) {
        if (!this.nodes.has(dep)) throw new RiqsError("CONTRACT", `Plan node "${n.id}" depends on unknown node "${dep}"`);
      }
    }
    this.assertAcyclic();
  }

  get size(): number {
    return this.nodes.size;
  }

  node(id: string): PlanNode {
    const n = this.nodes.get(id);
    if (!n) throw new RiqsError("INTERNAL", `Unknown plan node: ${id}`);
    return n;
  }

  all(): PlanNode[] {
    return [...this.nodes.values()];
  }

  /** Nodes whose dependencies are all in `completed` and which are neither done nor failed. */
  ready(completed: Set<string>, terminal: Set<string>): PlanNode[] {
    return this.all().filter(
      (n) => !completed.has(n.id) && !terminal.has(n.id) && n.dependsOn.every((d) => completed.has(d)),
    );
  }

  /** A node is blocked when any dependency has failed (and cannot be satisfied). */
  blockedBy(failed: Set<string>): PlanNode[] {
    return this.all().filter((n) => n.dependsOn.some((d) => failed.has(d)));
  }

  topologicalOrder(): PlanNode[] {
    const result: PlanNode[] = [];
    const done = new Set<string>();
    const temp = new Set<string>();
    const visit = (id: string) => {
      if (done.has(id)) return;
      if (temp.has(id)) throw new RiqsError("CONTRACT", `Cycle detected at ${id}`);
      temp.add(id);
      for (const d of this.node(id).dependsOn) visit(d);
      temp.delete(id);
      done.add(id);
      result.push(this.node(id));
    };
    for (const id of this.nodes.keys()) visit(id);
    return result;
  }

  private assertAcyclic(): void {
    this.topologicalOrder();
  }
}
