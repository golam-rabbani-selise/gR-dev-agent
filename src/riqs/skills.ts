import { promises as fs } from "node:fs";
import path from "node:path";
import { RiqsPaths } from "./paths";

export interface Skill {
  name: string;
  title: string;
  path: string;
  content: string;
  /** generated skills live under skills/generated/ (per-repo skill generation, Milestone 2). */
  generated: boolean;
}

/** Discover plain-markdown skills; any tool can consume them (master plan §23). */
export async function discoverSkills(paths: RiqsPaths): Promise<Skill[]> {
  const roots: { dir: string; generated: boolean }[] = [
    { dir: paths.skillsDir(), generated: false },
    { dir: path.join(paths.skillsDir(), "generated"), generated: true },
  ];
  const skills: Skill[] = [];
  for (const { dir, generated } of roots) {
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files.filter((f) => f.endsWith(".md")).sort()) {
      const full = path.join(dir, f);
      const content = await fs.readFile(full, "utf8");
      const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? f.replace(/\.md$/, "");
      skills.push({ name: f.replace(/\.md$/, ""), title, path: full, content, generated });
    }
  }
  return skills;
}

export async function loadSkill(paths: RiqsPaths, name: string): Promise<Skill | null> {
  return (await discoverSkills(paths)).find((s) => s.name === name) ?? null;
}

export async function skillText(paths: RiqsPaths, names: string[], maxChars = 8_000): Promise<string> {
  if (names.length === 0) return "";
  const all = await discoverSkills(paths);
  let out = "";
  for (const name of names) {
    const s = all.find((x) => x.name === name);
    if (!s) continue;
    const block = `\n---\n# skill: ${s.name}\n\n${s.content.trim()}\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}
