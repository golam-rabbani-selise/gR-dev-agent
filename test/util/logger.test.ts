import { describe, it, expect, afterEach } from "vitest";
import { log, setLogSink } from "../../src/util/logger";

describe("setLogSink (lets an interactive UI capture log lines instead of the raw terminal)", () => {
  afterEach(() => {
    setLogSink(undefined); // never leak a sink into the next test
  });

  it("routes every log line to the sink instead of writing to stdout/stderr", () => {
    const captured: string[] = [];
    setLogSink((line) => captured.push(line));
    log.step("Investigating…");
    log.success("investigate: partial (confidence 0.3)");
    log.warn("could not create worktree — using main tree");
    expect(captured).toEqual([
      expect.stringContaining("Investigating…"),
      expect.stringContaining("investigate: partial (confidence 0.3)"),
      expect.stringContaining("could not create worktree — using main tree"),
    ]);
  });

  it("stops routing to the sink once cleared", () => {
    const captured: string[] = [];
    setLogSink((line) => captured.push(line));
    setLogSink(undefined);
    log.step("this should not be captured");
    expect(captured).toEqual([]);
  });
});
