import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { WorkflowPresetSchema, normalizePreset } from "../../src/riqs/workflows";
import { WORKFLOW_FILES } from "../../src/templates/scaffold";

describe("workflow presets (master plan §25)", () => {
  it("every shipped preset parses and normalises to a valid DAG", () => {
    for (const [name, yaml] of Object.entries(WORKFLOW_FILES)) {
      const preset = WorkflowPresetSchema.parse(parseYaml(yaml));
      const steps = normalizePreset(preset);
      expect(steps.length, name).toBeGreaterThan(0);
      const ids = new Set(steps.map((s) => s.id));
      for (const s of steps) for (const d of s.dependsOn) expect(ids.has(d), `${name}:${s.id} dep ${d}`).toBe(true);
    }
  });

  it("permission-bug runs its investigations in parallel then a merge", () => {
    const preset = WorkflowPresetSchema.parse(parseYaml(WORKFLOW_FILES["workflows/permission-bug.yaml"]!));
    const steps = normalizePreset(preset);
    const parallel = steps.filter((s) => s.dependsOn.length === 0);
    expect(parallel.length).toBeGreaterThanOrEqual(3);
    expect(steps.find((s) => s.id === "root-cause-merge")!.dependsOn.length).toBeGreaterThanOrEqual(3);
  });
});
