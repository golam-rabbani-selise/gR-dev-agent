import { describe, it, expect, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { findAttachmentRefs, readAttachment, expandAttachments } from "../../src/cli/attachments";

describe("findAttachmentRefs", () => {
  it("finds a single @<path> reference", () => {
    expect(findAttachmentRefs("summarize @notes.txt please")).toEqual(["@notes.txt"]);
  });

  it("finds multiple distinct references and de-duplicates repeats", () => {
    expect(findAttachmentRefs("compare @a.md and @b.md, also @a.md again")).toEqual(["@a.md", "@b.md"]);
  });

  it("returns nothing for a message with no @ reference", () => {
    expect(findAttachmentRefs("just a normal chat message")).toEqual([]);
  });

  it("stops a reference at whitespace (paths with spaces aren't supported)", () => {
    expect(findAttachmentRefs("look at @file.txt now")).toEqual(["@file.txt"]);
  });
});

describe("readAttachment / expandAttachments (real filesystem, temp dir)", () => {
  const dir = fs.mkdtemp(path.join(os.tmpdir(), "gr-agent-attach-"));

  afterAll(async () => {
    await fs.rm(await dir, { recursive: true, force: true }).catch(() => {});
  });

  it("reads a real text file's content", async () => {
    const root = await dir;
    await fs.writeFile(path.join(root, "notes.txt"), "hello from a real file");
    const result = await readAttachment("@notes.txt", root);
    expect(result.ok).toBe(true);
    expect(result.text).toBe("hello from a real file");
  });

  it("resolves a relative path against the given root, not the process cwd", async () => {
    const root = await dir;
    await fs.mkdir(path.join(root, "sub"), { recursive: true });
    await fs.writeFile(path.join(root, "sub", "deep.md"), "nested content");
    const result = await readAttachment("@sub/deep.md", root);
    expect(result.ok).toBe(true);
    expect(result.text).toBe("nested content");
  });

  it("fails cleanly (never throws) for a file that doesn't exist", async () => {
    const root = await dir;
    const result = await readAttachment("@does-not-exist.txt", root);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("expandAttachments inlines the real content and leaves a message with no @ref unchanged", async () => {
    const root = await dir;
    await fs.writeFile(path.join(root, "notes.txt"), "the actual file content");
    const { text, notes } = await expandAttachments("please read @notes.txt and summarize", root);
    expect(text).toContain("the actual file content");
    expect(text).not.toContain("@notes.txt"); // the bare reference is replaced, not left dangling
    expect(notes[0]).toContain("Attached notes.txt");

    const unchanged = await expandAttachments("just a normal message", root);
    expect(unchanged.text).toBe("just a normal message");
    expect(unchanged.notes).toEqual([]);
  });

  it("expandAttachments notes a failed attachment instead of silently dropping it", async () => {
    const root = await dir;
    const { text, notes } = await expandAttachments("read @missing.txt", root);
    expect(text).toContain("Could not attach @missing.txt");
    expect(notes[0]).toContain("Couldn't attach @missing.txt");
  });

  it("routes a .pdf extension through pdf-parse instead of a raw utf8 read", async () => {
    const root = await dir;
    // A minimal, valid one-page PDF ("Hi" in Helvetica) — real PDF structure, not a fixture that
    // depends on any file outside this repo.
    const minimalPdf = [
      "%PDF-1.1",
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
      "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
      "5 0 obj<</Length 44>>stream\nBT /F1 24 Tf 50 100 Td (Hi) Tj ET\nendstream endobj",
      "trailer<</Root 1 0 R>>",
    ].join("\n");
    await fs.writeFile(path.join(root, "tiny.pdf"), minimalPdf, "latin1");
    const result = await readAttachment("@tiny.pdf", root);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("Hi");
  });
});
