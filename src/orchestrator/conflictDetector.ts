import path from "node:path";
import type { PlanNode } from "../riqs/contracts";
import type { RootCauseModel } from "./resultMerger";

/**
 * Two kinds of conflict:
 *  - file-ownership overlap between concurrent writers (master plan §33) → serialize;
 *  - contradictory findings between investigators (master plan §20) → tie-break assignment.
 */

export interface FileOwnershipConflict {
  a: string;
  b: string;
  overlap: string[];
}

/** Return pairs of writer nodes whose allowedPaths could collide in the same working tree. */
export function detectFileConflicts(nodes: PlanNode[]): FileOwnershipConflict[] {
  const writers = nodes.filter((n) => !n.readOnly);
  const conflicts: FileOwnershipConflict[] = [];
  for (let i = 0; i < writers.length; i++) {
    for (let j = i + 1; j < writers.length; j++) {
      const a = writers[i]!;
      const b = writers[j]!;
      if (dependencyOrdered(a, b, nodes)) continue; // already serialized by the DAG
      const overlap = globOverlap(a.allowedPaths, b.allowedPaths);
      if (overlap.length) conflicts.push({ a: a.id, b: b.id, overlap });
    }
  }
  return conflicts;
}

export function needsTieBreak(model: RootCauseModel): boolean {
  return model.contradictions.length > 0;
}

export function tieBreakNode(model: RootCauseModel, dependsOn: string[]): PlanNode {
  const subs = model.contradictions.map((c) => c.subsystem).join(", ");
  return {
    id: "tie-break",
    role: "reviewer",
    objective:
      `Investigators disagree about: ${subs}. Compare each claim against the actual call chain and the ` +
      `shared evidence, then state which finding the code supports and why.`,
    dependsOn,
    readOnly: true,
    allowedPaths: ["**"],
    skills: [],
    worker: null,
    optional: false,
  };
}

function dependencyOrdered(a: PlanNode, b: PlanNode, nodes: PlanNode[]): boolean {
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const node = nodes.find((n) => n.id === cur);
      stack.push(...(node?.dependsOn ?? []));
    }
    return false;
  };
  return reaches(a.id, b.id) || reaches(b.id, a.id);
}

function globOverlap(a: string[], b: string[]): string[] {
  if (a.includes("**") || b.includes("**")) return ["**"];
  const norm = (g: string) => path.posix.normalize(g.replace(/\\/g, "/")).replace(/\/?\*\*.*$/, "").replace(/\/?\*.*$/, "");
  const aPrefixes = a.map(norm);
  const bPrefixes = b.map(norm);
  const overlap: string[] = [];
  for (const ap of aPrefixes) {
    for (const bp of bPrefixes) {
      if (ap === bp || ap.startsWith(bp + "/") || bp.startsWith(ap + "/") || ap === "" || bp === "") overlap.push(ap || bp || "**");
    }
  }
  return [...new Set(overlap)];
}
