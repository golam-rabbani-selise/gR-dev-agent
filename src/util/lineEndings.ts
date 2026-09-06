/**
 * Line-ending detection and preservation (master plan §61).
 * A one-line patch on a CRLF file must not rewrite the whole file to LF.
 */

export type Eol = "\n" | "\r\n";

export interface EolStyle {
  eol: Eol;
  /** true when the original text ended with a trailing newline. */
  finalNewline: boolean;
  /** true when the file mixed \n and \r\n (rare; we normalize to the dominant one). */
  mixed: boolean;
}

export function detectEol(text: string): EolStyle {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lfOnly = (text.match(/(?<!\r)\n/g) ?? []).length;
  const eol: Eol = crlf > lfOnly ? "\r\n" : "\n";
  return {
    eol,
    finalNewline: /\r?\n$/.test(text),
    mixed: crlf > 0 && lfOnly > 0,
  };
}

/** Split text into logical lines regardless of the incoming EOL. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/);
}

/** Re-join lines using the given style, restoring the original trailing-newline behaviour. */
export function joinLines(lines: string[], style: EolStyle): string {
  const body = lines.join(style.eol);
  return style.finalNewline && !body.endsWith(style.eol) ? body + style.eol : body;
}

/** Convert arbitrary new content to match an existing file's style. */
export function applyEol(content: string, style: EolStyle): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const withEol = style.eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
  if (style.finalNewline && !/\r?\n$/.test(withEol)) return withEol + style.eol;
  if (!style.finalNewline) return withEol.replace(/\r?\n$/, "");
  return withEol;
}
