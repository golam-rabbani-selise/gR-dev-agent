import { describe, it, expect } from "vitest";
import { detectEol, applyEol } from "../../src/util/lineEndings";

describe("line endings (master plan §61)", () => {
  it("detects CRLF vs LF", () => {
    expect(detectEol("a\r\nb\r\n").eol).toBe("\r\n");
    expect(detectEol("a\nb\n").eol).toBe("\n");
  });

  it("preserves CRLF when writing new content into a CRLF file", () => {
    const style = detectEol("existing\r\nfile\r\n");
    const out = applyEol("one\ntwo\nthree", style);
    expect(out).toBe("one\r\ntwo\r\nthree\r\n");
  });

  it("preserves LF and trailing-newline absence", () => {
    const style = detectEol("x\ny"); // no final newline
    expect(applyEol("a\r\nb", style)).toBe("a\nb");
  });
});
