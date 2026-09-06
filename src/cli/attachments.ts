import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PDFParse } from "pdf-parse";

/**
 * Real `@<path>` file attachments for the chat composer (the footer's "@ files" hint has shown this
 * since the very first mockup, but nothing ever implemented it — a bare @path just got forwarded as
 * literal text to whichever CLI was active, and each one handles that differently or not at all;
 * Claude Code's own attempt to read a PDF that way failed outright for a user missing poppler-utils).
 *
 * This reads the file ourselves — plain text as-is, PDFs via pdf-parse (pure JS, no system
 * dependency like poppler) — so it works the same way regardless of which agent answers.
 */

/** Cap per attachment so one huge document doesn't blow the whole prompt budget. */
const MAX_ATTACHMENT_CHARS = 20_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface AttachmentResult {
  ref: string;
  path: string;
  ok: boolean;
  text?: string;
  error?: string;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Every distinct "@<path>" reference in a chat message. Stops at whitespace — a path containing a
 * space isn't supported, matching what the placeholder text itself implies ("@ files"). */
export function findAttachmentRefs(input: string): string[] {
  const matches = input.match(/@(\S+)/g) ?? [];
  // Trailing sentence punctuation ("@notes.txt.", "@notes.txt,") is almost never actually part of
  // the path — trim it so a normal sentence doesn't turn into a broken file reference.
  const trimmed = matches.map((m) => m.replace(/[.,;:!?)\]}'"]+$/, ""));
  return [...new Set(trimmed)];
}

/** Resolve and read one "@<path>" reference. Never throws — failures come back as {ok:false}. */
export async function readAttachment(ref: string, root: string): Promise<AttachmentResult> {
  const rawPath = ref.slice(1);
  const resolved = path.isAbsolute(rawPath) || rawPath.startsWith("~") ? expandHome(rawPath) : path.resolve(root, rawPath);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return { ref, path: resolved, ok: false, error: "not a file" };
    if (stat.size > MAX_ATTACHMENT_BYTES) return { ref, path: resolved, ok: false, error: "too large to read (over 25MB)" };

    if (path.extname(resolved).toLowerCase() === ".pdf") {
      const buf = await fs.readFile(resolved);
      const parser = new PDFParse({ data: buf });
      const result = await parser.getText();
      return { ref, path: resolved, ok: true, text: result.text.slice(0, MAX_ATTACHMENT_CHARS) };
    }

    // Best-effort text read for everything else (code, markdown, config, csv, ...) — a genuinely
    // binary file just comes through as garbled text, which a model can usually tell isn't real
    // content rather than something we need to specifically detect and reject up front.
    const raw = await fs.readFile(resolved, "utf8");
    return { ref, path: resolved, ok: true, text: raw.slice(0, MAX_ATTACHMENT_CHARS) };
  } catch (e) {
    return { ref, path: resolved, ok: false, error: (e as Error).message };
  }
}

/**
 * Replace every "@<path>" reference in a chat message with its actual content, inlined as a labeled
 * block — this is what actually gets sent to the agent for this turn. A reference that fails to
 * read is replaced with a plain note instead, so the agent's own reply can tell the user what went
 * wrong rather than the file silently vanishing from the prompt.
 */
export async function expandAttachments(input: string, root: string): Promise<{ text: string; notes: string[] }> {
  const refs = findAttachmentRefs(input);
  if (refs.length === 0) return { text: input, notes: [] };

  let text = input;
  const notes: string[] = [];
  for (const ref of refs) {
    const result = await readAttachment(ref, root);
    const replacement = result.ok
      ? `\n\n--- Attached file: ${result.path} ---\n${result.text}\n--- end of ${path.basename(result.path)} ---\n`
      : `\n\n[Could not attach ${ref}: ${result.error}]\n`;
    text = text.split(ref).join(replacement);
    notes.push(result.ok ? `Attached ${path.basename(result.path)} (${result.text!.length} chars).` : `Couldn't attach ${ref}: ${result.error}`);
  }
  return { text, notes };
}
