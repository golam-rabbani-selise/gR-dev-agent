import { promises as fs } from "node:fs";
import path from "node:path";
import { RiqsPaths } from "./paths";

export interface MemoryDoc {
  name: string;
  content: string;
}

/** Tool-neutral shared memory: plain markdown under .riqs-agent/memory (master plan §22). */
export async function loadMemory(paths: RiqsPaths): Promise<MemoryDoc[]> {
  const dir = paths.memoryDir();
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const docs: MemoryDoc[] = [];
  for (const f of files.filter((f) => f.endsWith(".md")).sort()) {
    docs.push({ name: f, content: await fs.readFile(path.join(dir, f), "utf8") });
  }
  return docs;
}

export async function loadMemoryText(paths: RiqsPaths, maxChars = 12_000): Promise<string> {
  const docs = await loadMemory(paths);
  let out = "";
  for (const d of docs) {
    const block = `\n## memory/${d.name}\n\n${d.content.trim()}\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}
