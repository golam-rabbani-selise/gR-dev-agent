import { describe, it, expect, afterEach } from "vitest";
import { withSpinner, isSpinnerActive, setSpinnerSink } from "../../src/util/spinner";

describe("withSpinner", () => {
  afterEach(() => {
    // Guard against a failed test leaving the module-level flag stuck for the next one.
    expect(isSpinnerActive()).toBe(false);
  });

  it("runs the work and returns its result even with no TTY (this test env)", async () => {
    const result = await withSpinner("doing a thing", async () => 42);
    expect(result).toBe(42);
  });

  it("propagates a thrown error instead of swallowing it", async () => {
    await expect(
      withSpinner("failing thing", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("never overlaps two spinners — a concurrent call still runs its work, just without animating", async () => {
    // Force the "already active" branch deterministically without needing a real TTY: hold the
    // module's flag open via a slow first call, then start a second one while it's still pending.
    const originalIsTTY = process.stdout.isTTY;
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    try {
      let secondStarted = false;
      const first = withSpinner("first", async () => {
        // While this is in flight, isSpinnerActive() should be true and a second call should not
        // try to animate on top of it.
        expect(isSpinnerActive()).toBe(true);
        const second = withSpinner("second", async () => {
          secondStarted = true;
          return "second-result";
        });
        const secondResult = await second;
        expect(secondResult).toBe("second-result");
        return "first-result";
      });
      const firstResult = await first;
      expect(firstResult).toBe("first-result");
      expect(secondStarted).toBe(true);
    } finally {
      (process.stdout as unknown as { isTTY: boolean }).isTTY = originalIsTTY;
    }
  });
});

describe("setSpinnerSink (lets an interactive UI own rendering the current frame itself)", () => {
  afterEach(() => {
    setSpinnerSink(undefined); // never leak a sink into the next test
  });

  it("sends frame text to the sink instead of writing raw ANSI to stdout, and clears it (undefined) when done", async () => {
    const frames: (string | undefined)[] = [];
    setSpinnerSink((frame) => frames.push(frame));
    const result = await withSpinner("Investigating…", async () => "done");
    expect(result).toBe("done");
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toContain("Investigating…");
    expect(frames[frames.length - 1]).toBeUndefined(); // cleared once the work finishes
  });

  it("still propagates a thrown error and still clears the sink's frame", async () => {
    const frames: (string | undefined)[] = [];
    setSpinnerSink((frame) => frames.push(frame));
    await expect(withSpinner("failing", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(frames[frames.length - 1]).toBeUndefined();
  });
});
