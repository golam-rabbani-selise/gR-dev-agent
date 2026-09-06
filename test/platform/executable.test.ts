import { describe, it, expect } from "vitest";
import { findExecutable, isCommandAvailable } from "../../src/platform/executable";

describe("findExecutable", () => {
  it("finds node on PATH", async () => {
    const p = await findExecutable("node");
    expect(p).toBeTruthy();
  });

  it("returns null for a nonsense command", async () => {
    expect(await findExecutable("definitely-not-a-real-binary-xyz")).toBeNull();
    expect(await isCommandAvailable("definitely-not-a-real-binary-xyz")).toBe(false);
  });
});
