import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
  // Dependencies stay external (resolved from node_modules at runtime) — bundling CJS deps such as
  // execa/cross-spawn into ESM breaks their dynamic require("child_process").
});
