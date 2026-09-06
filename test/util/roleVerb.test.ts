import { describe, it, expect } from "vitest";
import { roleVerb } from "../../src/util/roleVerb";

describe("roleVerb", () => {
  it("gives a friendly present-participle phrase for each known role", () => {
    expect(roleVerb("investigator")).toBe("Investigating");
    expect(roleVerb("coder")).toBe("Implementing");
    expect(roleVerb("tester")).toBe("Testing");
    expect(roleVerb("reviewer")).toBe("Reviewing");
    expect(roleVerb("planner")).toBe("Planning");
  });

  it("falls back to a generic verb for an unrecognised role instead of throwing", () => {
    expect(roleVerb("something-unexpected")).toBe("Working");
  });
});
