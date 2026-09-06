import type { AgentResult, Finding } from "../riqs/contracts";

export type Confidence = "CONFIRMED" | "SUPPORTED" | "SUSPECTED" | "NOT ROOT CAUSE";

export interface MergedFinding {
  subsystem: string;
  summary: string;
  classification: Confidence;
  score: number;
  supportingWorkers: string[];
  files: string[];
  kinds: Finding["kind"][];
}

export interface RootCauseModel {
  confirmed: MergedFinding[];
  supported: MergedFinding[];
  suspected: MergedFinding[];
  notRootCause: MergedFinding[];
  rootCauseHypotheses: { text: string; workers: string[] }[];
  recommendedChanges: { file: string; summary: string; workers: string[] }[];
  risks: string[];
  contradictions: Contradiction[];
}

export interface Contradiction {
  subsystem: string;
  a: { worker: string; summary: string };
  b: { worker: string; summary: string };
}

const NEGATION = /\b(no|not|isn'?t|does not|doesn'?t|cannot|can'?t|ruled out|unrelated|independent)\b/i;

/**
 * Build one root-cause model from many worker results (master plan §19). We deduplicate, group by
 * subsystem, weight by worker confidence + agreement, and surface contradictions for a tie-break.
 */
export function mergeResults(results: AgentResult[]): RootCauseModel {
  const groups = new Map<string, { finding: Finding; worker: string }[]>();
  for (const r of results) {
    for (const f of r.findings) {
      const key = normKey(f.subsystem, f.summary);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ finding: f, worker: r.worker });
    }
  }

  const merged: MergedFinding[] = [];
  const contradictions: Contradiction[] = [];

  for (const items of groups.values()) {
    const workers = [...new Set(items.map((i) => i.worker))];
    const avgConf = items.reduce((s, i) => s + i.finding.confidence, 0) / items.length;
    const agreement = workers.length;
    const score = avgConf * (1 + 0.35 * (agreement - 1));
    const first = items[0]!.finding;
    const negative = NEGATION.test(first.summary) || first.kind === "recommendation";

    merged.push({
      subsystem: first.subsystem,
      summary: first.summary,
      classification: classify(score, agreement, negative),
      score: round(score),
      supportingWorkers: workers,
      files: [...new Set(items.flatMap((i) => i.finding.files))],
      kinds: [...new Set(items.map((i) => i.finding.kind))],
    });
  }

  // contradiction detection: same subsystem, opposite polarity between workers
  const bySubsystem = new Map<string, { worker: string; summary: string; negative: boolean }[]>();
  for (const r of results) {
    for (const f of r.findings) {
      if (!bySubsystem.has(f.subsystem)) bySubsystem.set(f.subsystem, []);
      bySubsystem.get(f.subsystem)!.push({ worker: r.worker, summary: f.summary, negative: NEGATION.test(f.summary) });
    }
  }
  for (const [subsystem, items] of bySubsystem) {
    const pos = items.find((i) => !i.negative);
    const neg = items.find((i) => i.negative && i.worker !== pos?.worker);
    if (pos && neg) {
      contradictions.push({ subsystem, a: { worker: pos.worker, summary: pos.summary }, b: { worker: neg.worker, summary: neg.summary } });
    }
  }

  const hypMap = new Map<string, Set<string>>();
  for (const r of results) for (const h of r.rootCauseHypotheses) {
    const k = h.trim().toLowerCase();
    if (!hypMap.has(k)) hypMap.set(k, new Set());
    hypMap.get(k)!.add(r.worker);
  }
  const recMap = new Map<string, { summary: string; workers: Set<string> }>();
  for (const r of results) for (const c of r.recommendedChanges) {
    const k = c.file;
    if (!recMap.has(k)) recMap.set(k, { summary: c.summary, workers: new Set() });
    recMap.get(k)!.workers.add(r.worker);
  }

  merged.sort((a, b) => b.score - a.score);
  return {
    confirmed: merged.filter((m) => m.classification === "CONFIRMED"),
    supported: merged.filter((m) => m.classification === "SUPPORTED"),
    suspected: merged.filter((m) => m.classification === "SUSPECTED"),
    notRootCause: merged.filter((m) => m.classification === "NOT ROOT CAUSE"),
    rootCauseHypotheses: [...hypMap].map(([text, workers]) => ({ text, workers: [...workers] })),
    recommendedChanges: [...recMap].map(([file, v]) => ({ file, summary: v.summary, workers: [...v.workers] })),
    risks: [...new Set(results.flatMap((r) => r.risks))],
    contradictions,
  };
}

function classify(score: number, agreement: number, negative: boolean): Confidence {
  if (negative) return "NOT ROOT CAUSE";
  if (score >= 0.8 && agreement >= 2) return "CONFIRMED";
  if (score >= 0.8 || agreement >= 2) return "SUPPORTED";
  return "SUSPECTED";
}

function normKey(subsystem: string, summary: string): string {
  return `${subsystem}::${summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
