import { describe, it, expect } from "vitest";
import path from "node:path";
import { isSubPath, normalizePath } from "../../src/platform/paths";

describe("path helpers", () => {
  it("normalizePath collapses .. and .", () => {
    expect(normalizePath("a/b/../c")).toBe(path.normalize("a/b/../c"));
  });

  it("isSubPath accepts nested and rejects escapes", () => {
    const root = path.resolve("/tmp/ws");
    expect(isSubPath(root, path.join(root, "src/a.ts"))).toBe(true);
    expect(isSubPath(root, root)).toBe(true);
    expect(isSubPath(root, path.resolve("/tmp/other"))).toBe(false);
    expect(isSubPath(root, path.join(root, "../escape"))).toBe(false);
  });
});
