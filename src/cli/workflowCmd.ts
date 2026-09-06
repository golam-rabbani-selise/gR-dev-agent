import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { listPresets, loadPreset, normalizePreset } from "../riqs/workflows";
import { discoverSkills } from "../riqs/skills";
import { table } from "../ui/render";
import { log } from "../util/logger";

export function registerWorkflowCmd(program: Command): void {
  const cmd = program.command("workflow").description("inspect workflow presets and skills");

  cmd
    .command("list", { isDefault: true })
    .action(async () => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const presets = await listPresets(ctx.paths);
      log.info(presets.length ? presets.map((p) => `- ${p}`).join("\n") : "No presets. Run `gr-agent init`.");
    });

  cmd
    .command("show <name>")
    .action(async (name: string) => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const preset = await loadPreset(ctx.paths, name);
      const steps = normalizePreset(preset);
      log.info(`${preset.name} — ${preset.description ?? ""}`);
      log.info(
        table(
          ["id", "role", "readOnly", "dependsOn"],
          steps.map((s) => [s.id, s.role, String(s.readOnly), s.dependsOn.join(",") || "-"]),
        ),
      );
    });

  cmd
    .command("skills")
    .description("list discovered skills")
    .action(async () => {
      const ctx = await resolveContext(program.opts<GlobalOpts>());
      const skills = await discoverSkills(ctx.paths);
      log.info(
        skills.length
          ? table(["name", "title", "generated"], skills.map((s) => [s.name, s.title, String(s.generated)]))
          : "No skills found.",
      );
    });
}
