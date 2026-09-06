#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/platform/paths.ts
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import envPaths from "env-paths";
function currentPlatform() {
  const p = process.platform;
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "linux";
}
function normalizePath(p) {
  return path.normalize(p);
}
function resolvePath(...segments) {
  return path.resolve(...segments);
}
function isSubPath(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
}
async function realParentContains(parent, child) {
  const realParent = await fs.realpath(parent);
  let probe = path.resolve(child);
  for (; ; ) {
    try {
      const realChild = await fs.realpath(probe);
      return isSubPath(realParent, realChild);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const next = path.dirname(probe);
      if (next === probe) return false;
      probe = next;
    }
  }
}
function tmpDir() {
  return os.tmpdir();
}
function userPaths() {
  return envPaths("gr-dev-agent", { suffix: "" });
}
function homeDir() {
  return os.homedir();
}
var init_paths = __esm({
  "src/platform/paths.ts"() {
    "use strict";
  }
});

// src/platform/executable.ts
import { promises as fs2, constants as FS } from "fs";
import path2 from "path";
function executableExtensions() {
  if (currentPlatform() !== "win32") return [""];
  const pathext = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.PS1";
  return ["", ...pathext.split(";").map((e) => e.toLowerCase())];
}
async function isExecutableFile(p) {
  try {
    const st = await fs2.stat(p);
    if (!st.isFile()) return false;
    if (currentPlatform() === "win32") return true;
    await fs2.access(p, FS.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function findExecutable(name) {
  const exts = executableExtensions();
  if (name.includes(path2.sep) || name.includes("/")) {
    const base = path2.resolve(name);
    for (const ext of exts) {
      const cand = base + ext;
      if (await isExecutableFile(cand)) return cand;
    }
    return null;
  }
  const dirs = (process.env.PATH ?? "").split(path2.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path2.join(dir, name + ext);
      if (await isExecutableFile(cand)) return cand;
    }
  }
  return null;
}
async function isCommandAvailable(name) {
  return await findExecutable(name) !== null;
}
var init_executable = __esm({
  "src/platform/executable.ts"() {
    "use strict";
    init_paths();
  }
});

// src/platform/shell.ts
async function getDefaultShell() {
  if (currentPlatform() === "win32") {
    for (const c of ["pwsh", "powershell", "cmd"]) {
      const found = await findExecutable(c);
      if (found) return found;
    }
    return "cmd.exe";
  }
  if (process.env.SHELL) return process.env.SHELL;
  for (const c of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    const found = await findExecutable(c);
    if (found) return found;
  }
  return "/bin/sh";
}
var init_shell = __esm({
  "src/platform/shell.ts"() {
    "use strict";
    init_paths();
    init_executable();
  }
});

// src/util/errors.ts
var errors_exports = {};
__export(errors_exports, {
  CancelledError: () => CancelledError,
  RiqsError: () => RiqsError,
  exitCodeFor: () => exitCodeFor,
  isRiqsError: () => isRiqsError
});
function isRiqsError(e) {
  return e instanceof RiqsError;
}
function exitCodeFor(code) {
  switch (code) {
    case "CANCELLED":
      return 130;
    case "CONSENT":
      return 3;
    case "UNSUPPORTED":
      return 4;
    default:
      return 1;
  }
}
var RiqsError, CancelledError;
var init_errors = __esm({
  "src/util/errors.ts"() {
    "use strict";
    RiqsError = class extends Error {
      code;
      details;
      hint;
      constructor(code, message, opts = {}) {
        super(message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
        this.name = "RiqsError";
        this.code = code;
        this.details = opts.details;
        this.hint = opts.hint;
      }
    };
    CancelledError = class extends RiqsError {
      constructor(message = "Operation cancelled") {
        super("CANCELLED", message);
        this.name = "CancelledError";
      }
    };
  }
});

// src/platform/process.ts
import { execa } from "execa";
function killAllChildren() {
  for (const child of liveChildren) {
    try {
      child.kill("SIGTERM");
      const pid = child.pid;
      setTimeout(() => {
        try {
          if (pid) process.kill(pid, "SIGKILL");
        } catch {
        }
      }, 3e3).unref();
    } catch {
    }
  }
}
async function runProcess(file, args, opts = {}) {
  const execaOpts = {
    cwd: opts.cwd,
    env: opts.env,
    extendEnv: true,
    stdin: opts.input !== void 0 ? "pipe" : opts.inherit ? "inherit" : "ignore",
    stdout: opts.inherit ? "inherit" : "pipe",
    stderr: opts.inherit ? "inherit" : "pipe",
    timeout: opts.timeoutMs,
    reject: false,
    windowsHide: true,
    cancelSignal: opts.signal,
    ...opts.input !== void 0 ? { input: opts.input } : {}
  };
  const child = execa(file, args, execaOpts);
  liveChildren.add(child);
  try {
    const res = await child;
    if (opts.signal?.aborted) throw new CancelledError(`Cancelled: ${file}`);
    return {
      exitCode: res.exitCode ?? (res.failed ? 1 : 0),
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr : "",
      timedOut: Boolean(res.timedOut),
      command: `${file} ${args.join(" ")}`.trim()
    };
  } finally {
    liveChildren.delete(child);
  }
}
var liveChildren;
var init_process = __esm({
  "src/platform/process.ts"() {
    "use strict";
    init_paths();
    init_errors();
    liveChildren = /* @__PURE__ */ new Set();
  }
});

// src/platform/environment.ts
import { promises as fs3 } from "fs";
import path3 from "path";
async function loadDotEnv(dir, file = ".env") {
  let raw;
  try {
    raw = await fs3.readFile(path3.join(dir, file), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const key = m[1];
    let value = m[2];
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === void 0) process.env[key] = value;
  }
}
function envAny(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim() !== "") return v;
  }
  return void 0;
}
function isNonInteractive() {
  return process.argv.includes("--non-interactive") || process.env.RIQS_NON_INTERACTIVE === "1" || process.env.CI === "true" || !process.stdin.isTTY;
}
var init_environment = __esm({
  "src/platform/environment.ts"() {
    "use strict";
  }
});

// src/platform/platform.ts
var platform, Platform;
var init_platform = __esm({
  "src/platform/platform.ts"() {
    "use strict";
    init_paths();
    init_executable();
    init_shell();
    init_process();
    init_environment();
    platform = currentPlatform();
    Platform = {
      platform,
      isWindows: platform === "win32",
      isMac: platform === "darwin",
      normalizePath,
      resolvePath,
      isSubPath,
      realParentContains,
      findExecutable,
      isCommandAvailable,
      getDefaultShell,
      run: runProcess,
      killAllChildren,
      tmpDir,
      homeDir,
      userPaths,
      loadDotEnv,
      envAny,
      isNonInteractive
    };
  }
});

// src/util/logger.ts
import pc from "picocolors";
function shouldColor() {
  if (process.env.NO_COLOR || process.argv.includes("--no-color")) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}
function configureLogger(opts) {
  Object.assign(state, opts);
}
function isColor() {
  return state.color;
}
function paint(fn, s) {
  return state.color ? fn(s) : s;
}
function setLogSink(fn) {
  sink = fn;
}
function emit(level, prefix, args) {
  if (LEVELS[level] < LEVELS[state.level]) return;
  if (state.json) {
    const stream2 = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream2.write(JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), level, msg: args.map(String).join(" ") }) + "\n");
    return;
  }
  const line = (prefix ? prefix + " " : "") + args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  if (sink) {
    sink(line);
    return;
  }
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(line + "\n");
}
var LEVELS, state, sink, log;
var init_logger = __esm({
  "src/util/logger.ts"() {
    "use strict";
    LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
    state = {
      level: process.env.RIQS_LOG_LEVEL || "info",
      color: shouldColor(),
      json: false
    };
    log = {
      debug: (...a) => emit("debug", paint(pc.dim, "  \xB7"), a),
      info: (...a) => emit("info", "", a),
      step: (...a) => emit("info", paint(pc.cyan, "\u203A"), a),
      success: (...a) => emit("info", paint(pc.green, "\u2713"), a),
      warn: (...a) => emit("warn", paint(pc.yellow, "!"), a),
      error: (...a) => emit("error", paint(pc.red, "\u2717"), a)
    };
  }
});

// src/riqs/paths.ts
import path4 from "path";
import { existsSync } from "fs";
function resolveAgentDirName(workspaceRoot) {
  if (existsSync(path4.join(workspaceRoot, AGENT_DIR))) return AGENT_DIR;
  if (existsSync(path4.join(workspaceRoot, LEGACY_AGENT_DIR))) return LEGACY_AGENT_DIR;
  return AGENT_DIR;
}
var AGENT_DIR, LEGACY_AGENT_DIR, RiqsPaths;
var init_paths2 = __esm({
  "src/riqs/paths.ts"() {
    "use strict";
    AGENT_DIR = ".gr-agent";
    LEGACY_AGENT_DIR = ".riqs-agent";
    RiqsPaths = class {
      root;
      dir;
      /** the directory name actually in use (".gr-agent" or ".riqs-agent"). */
      dirName;
      constructor(workspaceRoot, dirName) {
        this.root = workspaceRoot;
        this.dirName = dirName ?? resolveAgentDirName(workspaceRoot);
        this.dir = path4.join(workspaceRoot, this.dirName);
      }
      // top-level config
      config = () => path4.join(this.dir, "config.json");
      workers = () => path4.join(this.dir, "workers.json");
      agents = () => path4.join(this.dir, "agents.json");
      // knowledge
      memoryDir = () => path4.join(this.dir, "memory");
      memoryFile = (name) => path4.join(this.dir, "memory", name);
      promptsDir = () => path4.join(this.dir, "prompts");
      promptFile = (name) => path4.join(this.dir, "prompts", `${name}.md`);
      skillsDir = () => path4.join(this.dir, "skills");
      skillFile = (name) => path4.join(this.dir, "skills", `${name}.md`);
      workflowsDir = () => path4.join(this.dir, "workflows");
      workflowFile = (name) => path4.join(this.dir, "workflows", `${name}.yaml`);
      profilesDir = () => path4.join(this.dir, "profiles");
      profileFile = (name) => path4.join(this.dir, "profiles", `${name}.json`);
      // live run state
      workflowDir = () => path4.join(this.dir, "workflow");
      task = () => path4.join(this.dir, "workflow", "task.json");
      plan = () => path4.join(this.dir, "workflow", "plan.json");
      assignmentsDir = () => path4.join(this.dir, "workflow", "assignments");
      assignmentJson = (id) => path4.join(this.dir, "workflow", "assignments", `${id}.json`);
      assignmentMd = (id) => path4.join(this.dir, "workflow", "assignments", `${id}.md`);
      resultsDir = () => path4.join(this.dir, "workflow", "results");
      resultFile = (id) => path4.join(this.dir, "workflow", "results", `${id}.json`);
      evidenceDir = () => path4.join(this.dir, "workflow", "evidence");
      evidenceFile = (id) => path4.join(this.dir, "workflow", "evidence", `${id}.json`);
      locksDir = () => path4.join(this.dir, "workflow", "locks");
      checkpointsDir = () => path4.join(this.dir, "workflow", "checkpoints");
      checkpointFile = (taskId) => path4.join(this.dir, "workflow", "checkpoints", `${taskId}.json`);
      auditLog = () => path4.join(this.dir, "workflow", "audit.log.jsonl");
      reportFile = (taskId) => path4.join(this.dir, "workflow", `report-${taskId}.md`);
      // Human-readable planning/spec documents written by the "/plan" and "/spec" commands — distinct
      // from `plan()` above (the internal task-graph JSON the orchestrator itself reads/writes). These
      // are durable, editable Markdown artifacts meant for the user to read, tweak, and hand to
      // "/implement", so they live in their own top-level folders rather than under "workflow/".
      plansDir = () => path4.join(this.dir, "plans");
      planDoc = (slug) => path4.join(this.dir, "plans", `${slug}.md`);
      specsDir = () => path4.join(this.dir, "specs");
      specDoc = (slug) => path4.join(this.dir, "specs", `${slug}.md`);
      // worktrees live outside .riqs-agent so git can manage them
      worktreesDir = () => path4.join(this.root, ".worktrees");
      worktreeDir = (role) => path4.join(this.root, ".worktrees", role);
    };
  }
});

// src/riqs/contracts.ts
import { z } from "zod";
function parseOrThrow(schema, value, label) {
  const res = schema.safeParse(value);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new RiqsError("CONTRACT", `Invalid ${label}: ${issues}`);
  }
  return res.data;
}
var RoleSchema, TaskStateSchema, AssignmentStateSchema, AgentAssignmentSchema, FindingKindSchema, FindingSchema, RecommendedChangeSchema, AgentResultSchema, EvidenceSchema, PlanNodeSchema, PlanSchema, TaskSchema, CheckpointSchema;
var init_contracts = __esm({
  "src/riqs/contracts.ts"() {
    "use strict";
    init_errors();
    RoleSchema = z.enum([
      "planner",
      "investigator",
      "backend",
      "frontend",
      "database",
      "permission",
      "security",
      "performance",
      "coder",
      "tester",
      "reviewer",
      "regression",
      "documentation",
      "git",
      "release",
      "general"
    ]);
    TaskStateSchema = z.enum([
      "CREATED",
      "PLANNING",
      "ASSIGNED",
      "RUNNING",
      "WAITING",
      "MERGING",
      "IMPLEMENTING",
      "TESTING",
      "REVIEWING",
      "COMPLETED",
      "FAILED",
      "CANCELLED"
    ]);
    AssignmentStateSchema = z.enum([
      "PENDING",
      "RUNNING",
      "COMPLETED",
      "BLOCKED",
      "FAILED",
      "CANCELLED"
    ]);
    AgentAssignmentSchema = z.object({
      taskId: z.string().min(1),
      id: z.string().min(1),
      role: RoleSchema,
      objective: z.string().min(1),
      workspace: z.string().default("."),
      allowedPaths: z.array(z.string()).default(["**"]),
      readOnly: z.boolean().default(true),
      dependencies: z.array(z.string()).default([]),
      outputFile: z.string().min(1),
      skills: z.array(z.string()).default([]),
      context: z.record(z.string(), z.unknown()).default({}),
      /** worktree path when this is an isolated writer (master plan §7). */
      worktree: z.string().optional()
    });
    FindingKindSchema = z.enum(["fact", "hypothesis", "recommendation"]);
    FindingSchema = z.object({
      kind: FindingKindSchema.default("fact"),
      subsystem: z.string().default("unknown"),
      summary: z.string().min(1),
      detail: z.string().default(""),
      files: z.array(z.string()).default([]),
      evidenceIds: z.array(z.string()).default([]),
      confidence: z.number().min(0).max(1).default(0.5)
    });
    RecommendedChangeSchema = z.object({
      file: z.string(),
      summary: z.string(),
      rationale: z.string().default("")
    });
    AgentResultSchema = z.object({
      taskId: z.string().min(1),
      id: z.string().min(1),
      role: RoleSchema,
      worker: z.string().min(1),
      status: z.enum(["completed", "failed", "blocked", "partial"]),
      findings: z.array(FindingSchema).default([]),
      filesInspected: z.array(z.string()).default([]),
      rootCauseHypotheses: z.array(z.string()).default([]),
      recommendedChanges: z.array(RecommendedChangeSchema).default([]),
      risks: z.array(z.string()).default([]),
      diff: z.string().optional(),
      confidence: z.number().min(0).max(1).default(0.5),
      error: z.string().optional(),
      startedAt: z.string().optional(),
      finishedAt: z.string().optional()
    });
    EvidenceSchema = z.object({
      id: z.string().min(1),
      file: z.string(),
      lines: z.string().optional(),
      claim: z.string().min(1),
      sourceAgent: z.string().min(1),
      createdAt: z.string()
    });
    PlanNodeSchema = z.object({
      id: z.string().min(1),
      role: RoleSchema,
      objective: z.string().min(1),
      dependsOn: z.array(z.string()).default([]),
      readOnly: z.boolean().default(true),
      allowedPaths: z.array(z.string()).default(["**"]),
      skills: z.array(z.string()).default([]),
      /** explicit worker/agent id; null => let the router decide. */
      worker: z.union([z.string(), z.array(z.string())]).nullable().default(null),
      optional: z.boolean().default(false)
    });
    PlanSchema = z.object({
      taskId: z.string().min(1),
      parallelizable: z.boolean().default(true),
      mode: z.enum(["auto", "parallel", "sequential", "single-worker", "manual"]).default("auto"),
      nodes: z.array(PlanNodeSchema).min(1),
      createdAt: z.string(),
      source: z.enum(["preset", "native-planner", "manual"]).default("preset")
    });
    TaskSchema = z.object({
      taskId: z.string().min(1),
      objective: z.string().min(1),
      category: z.string().default("general"),
      workflow: z.string().optional(),
      state: TaskStateSchema.default("CREATED"),
      createdAt: z.string(),
      updatedAt: z.string(),
      skipped: z.array(z.string()).default([]),
      acceptanceCriteria: z.array(z.string()).default([])
    });
    CheckpointSchema = z.object({
      taskId: z.string().min(1),
      phase: z.string(),
      savedAt: z.string(),
      task: TaskSchema,
      plan: PlanSchema.nullable(),
      assignmentStates: z.record(z.string(), AssignmentStateSchema).default({}),
      completedResults: z.array(z.string()).default([]),
      modifiedFiles: z.array(z.string()).default([]),
      worktrees: z.array(z.object({ role: z.string(), path: z.string(), branch: z.string() })).default([]),
      testStatus: z.enum(["unknown", "passed", "failed", "skipped"]).default("unknown"),
      reason: z.string().optional()
    });
  }
});

// src/integrations/integration.ts
import { promises as fs4 } from "fs";
import { fileURLToPath } from "url";
import path5 from "path";
import { z as z2 } from "zod";
async function loadManifest() {
  if (cached) return cached;
  const candidates = [
    fileURLToPath(new URL("../integrations.manifest.json", import.meta.url)),
    fileURLToPath(new URL("../../integrations.manifest.json", import.meta.url)),
    path5.resolve(process.cwd(), "integrations.manifest.json")
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(await fs4.readFile(file, "utf8"));
      cached = parseOrThrow(ManifestSchema, raw, "integrations.manifest.json");
      return cached;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  throw new RiqsError("INTEGRATION", "integrations.manifest.json not found");
}
var InstallerSchema, AuthMethodSchema, WorkerInvokeSchema, IntegrationSchema, ManifestSchema, cached, KNOWN_INTEGRATIONS;
var init_integration = __esm({
  "src/integrations/integration.ts"() {
    "use strict";
    init_contracts();
    init_errors();
    InstallerSchema = z2.object({
      id: z2.string(),
      method: z2.enum(["npm", "brew", "winget", "choco", "scoop", "official-installer", "manual"]),
      command: z2.string().nullable(),
      args: z2.array(z2.string()).default([]),
      sourceUrl: z2.string().nullable().optional(),
      requiresElevation: z2.boolean().default(false),
      supportedPlatforms: z2.array(z2.enum(["darwin", "win32", "linux"])).default(["darwin", "win32", "linux"]),
      verified: z2.boolean().default(false),
      manualInstructions: z2.string().optional()
    });
    AuthMethodSchema = z2.object({
      id: z2.string(),
      type: z2.enum(["interactive-cli", "browser-oauth", "device-code", "api-key", "provider-managed", "manual"]),
      command: z2.string().nullable().optional(),
      args: z2.array(z2.string()).default([]),
      verified: z2.boolean().default(false)
    });
    WorkerInvokeSchema = z2.object({
      promptDelivery: z2.enum(["stdin", "file", "arg"]).default("arg"),
      argv: z2.array(z2.string()).default([]),
      useWorktreeCwd: z2.boolean().default(true),
      writesResultFile: z2.boolean().default(false),
      verified: z2.boolean().default(false)
    });
    IntegrationSchema = z2.object({
      displayName: z2.string(),
      executables: z2.array(z2.string()).min(1),
      versionArgs: z2.array(z2.string()).default(["--version"]),
      healthArgs: z2.array(z2.string()).default(["--version"]),
      installers: z2.array(InstallerSchema).default([]),
      authentication: z2.object({ methods: z2.array(AuthMethodSchema).default([]), statusArgs: z2.array(z2.string()).nullable().default(null) }).default({ methods: [], statusArgs: null }),
      worker: WorkerInvokeSchema.default({}),
      /**
       * The model this CLI genuinely uses when we don't pass --model ourselves — set ONLY when directly
       * confirmed against the vendor's own CLI output (e.g. `cursor-agent models` marking one "(current,
       * default)"), never guessed. Forcing an unverified --model has broken real invocations (codex
       * rejected an assumed model outright), so most entries leave this unset rather than fabricate one.
       */
      defaultModelLabel: z2.string().optional()
    });
    ManifestSchema = z2.object({
      schemaVersion: z2.number(),
      note: z2.string().optional(),
      integrations: z2.record(z2.string(), IntegrationSchema)
    });
    cached = null;
    KNOWN_INTEGRATIONS = ["claude", "codex", "cursor", "opencode", "antigravity"];
  }
});

// src/integrations/detector.ts
async function detectIntegration(id) {
  const manifest = await loadManifest();
  const entry = manifest.integrations[id];
  if (!entry) {
    return { id, displayName: id, installed: false, executablePath: null, version: null, auth: "unknown", readiness: "unsupported" };
  }
  const exe = await firstExecutable(entry);
  if (!exe) {
    return { id, displayName: entry.displayName, installed: false, executablePath: null, version: null, auth: "unknown", readiness: "missing" };
  }
  let version = null;
  let broken = false;
  try {
    const res = await Platform.run(exe, entry.versionArgs, { timeoutMs: 15e3 });
    version = firstLine(res.stdout || res.stderr) || null;
    if (res.exitCode !== 0 && !version) broken = true;
  } catch {
    broken = true;
  }
  const auth = await detectAuth(entry, exe);
  const readiness = computeReadiness({ installed: true, broken, auth, hasAuthMethods: entry.authentication.methods.length > 0 });
  return { id, displayName: entry.displayName, installed: true, executablePath: exe, version, auth, readiness };
}
async function detectAll(ids) {
  const manifest = await loadManifest();
  const list = ids ?? Object.keys(manifest.integrations);
  return Promise.all(list.map((id) => detectIntegration(id)));
}
async function firstExecutable(entry) {
  for (const name of entry.executables) {
    const p = await Platform.findExecutable(name);
    if (p) return p;
  }
  return null;
}
async function detectAuth(entry, exe) {
  if (entry.authentication.methods.length === 0) return "not_required";
  const statusArgs = entry.authentication.statusArgs;
  if (!statusArgs) return "unknown";
  try {
    const res = await Platform.run(exe, statusArgs, { timeoutMs: 15e3 });
    return parseAuthStatus(res.stdout, res.stderr, res.exitCode);
  } catch {
    return "unknown";
  }
}
function parseAuthStatus(stdout, stderr, exitCode) {
  const boolFields = ["loggedIn", "isLoggedIn", "authenticated", "isAuthenticated", "logged_in", "is_authenticated"];
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed === "object") {
      for (const field of boolFields) {
        const v = parsed[field];
        if (typeof v === "boolean") return v ? "authenticated" : "not_authenticated";
      }
    }
  } catch {
  }
  const text3 = `${stdout}
${stderr}`.toLowerCase();
  if (exitCode === 0 && /logged in|authenticated|active session/.test(text3)) return "authenticated";
  if (/not logged in|unauthenticated|login required|no api key/.test(text3)) return "not_authenticated";
  const credentialCount = /(\d+)\s+credentials?/.exec(text3);
  if (exitCode === 0 && credentialCount) return Number(credentialCount[1]) > 0 ? "authenticated" : "not_authenticated";
  if (exitCode === 0 && /no (stored )?credentials/.test(text3)) return "not_authenticated";
  return "unknown";
}
function computeReadiness(x) {
  if (!x.installed) return "missing";
  if (x.broken) return "broken";
  if (!x.hasAuthMethods || x.auth === "not_required" || x.auth === "authenticated") return "ready";
  if (x.auth === "not_authenticated" || x.auth === "expired" || x.auth === "invalid") return "login_required";
  return "installed";
}
function firstLine(s) {
  return s.split(/\r?\n/)[0]?.trim() ?? "";
}
var init_detector = __esm({
  "src/integrations/detector.ts"() {
    "use strict";
    init_platform();
    init_integration();
  }
});

// src/ui/render.ts
import pc2 from "picocolors";
function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}
function heading(text3) {
  return isColor() ? pc2.bold(pc2.cyan(text3)) : text3;
}
var init_render = __esm({
  "src/ui/render.ts"() {
    "use strict";
    init_logger();
  }
});

// src/util/lineEndings.ts
function detectEol(text3) {
  const crlf = (text3.match(/\r\n/g) ?? []).length;
  const lfOnly = (text3.match(/(?<!\r)\n/g) ?? []).length;
  const eol = crlf > lfOnly ? "\r\n" : "\n";
  return {
    eol,
    finalNewline: /\r?\n$/.test(text3),
    mixed: crlf > 0 && lfOnly > 0
  };
}
function applyEol(content, style) {
  const normalized = content.replace(/\r\n/g, "\n");
  const withEol = style.eol === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
  if (style.finalNewline && !/\r?\n$/.test(withEol)) return withEol + style.eol;
  if (!style.finalNewline) return withEol.replace(/\r?\n$/, "");
  return withEol;
}
var init_lineEndings = __esm({
  "src/util/lineEndings.ts"() {
    "use strict";
  }
});

// src/util/json.ts
import { promises as fs6 } from "fs";
import path7 from "path";
import { randomBytes } from "crypto";
async function readJson(file, fallback) {
  try {
    const raw = await fs6.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT" && fallback !== void 0) return fallback;
    throw e;
  }
}
async function detectFileEol(file) {
  try {
    return detectEol(await fs6.readFile(file, "utf8"));
  } catch {
    return { eol: "\n", finalNewline: true, mixed: false };
  }
}
async function writeFileAtomic(file, contents) {
  await fs6.mkdir(path7.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  await fs6.writeFile(tmp, contents, "utf8");
  try {
    await fs6.rename(tmp, file);
  } catch (e) {
    await fs6.rm(tmp, { force: true }).catch(() => {
    });
    throw e;
  }
}
async function writeJson(file, value) {
  await writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}
var init_json = __esm({
  "src/util/json.ts"() {
    "use strict";
    init_lineEndings();
  }
});

// src/config/schema.ts
import { z as z3 } from "zod";
var SCHEMA_VERSION, WorkflowModeSchema, RoutingPolicySchema, RouteTargetSchema, ProviderConfigSchema, ConfigSchema, WorkersConfigSchema, AgentsConfigSchema, ProfileSchema;
var init_schema = __esm({
  "src/config/schema.ts"() {
    "use strict";
    init_contracts();
    SCHEMA_VERSION = 1;
    WorkflowModeSchema = z3.enum(["auto", "parallel", "sequential", "single-worker", "manual"]);
    RoutingPolicySchema = z3.enum(["strict", "fallback"]);
    RouteTargetSchema = z3.union([z3.string(), z3.array(z3.string()).min(1)]);
    ProviderConfigSchema = z3.object({
      provider: z3.enum(["anthropic", "openai", "openrouter", "ollama"]),
      model: z3.string().default("default"),
      baseUrl: z3.string().optional(),
      apiKeyEnv: z3.string().optional(),
      maxOutputTokens: z3.number().int().positive().optional(),
      temperature: z3.number().min(0).max(2).optional()
    });
    ConfigSchema = z3.object({
      schemaVersion: z3.number().default(SCHEMA_VERSION),
      mode: WorkflowModeSchema.default("auto"),
      routingPolicy: RoutingPolicySchema.default("fallback"),
      primaryWorker: z3.string().optional(),
      parallelism: z3.number().int().min(1).max(16).default(4),
      routing: z3.record(RoleSchema, RouteTargetSchema).default({}),
      preferences: z3.record(RoleSchema, z3.array(z3.string())).default({}),
      taskDefaults: z3.record(z3.string(), z3.record(RoleSchema, RouteTargetSchema)).default({}),
      skip: z3.array(z3.string()).default([]),
      native: z3.object({
        default: z3.string().default("default"),
        providers: z3.record(z3.string(), ProviderConfigSchema).default({})
      }).default({ default: "default", providers: {} }),
      integrations: z3.object({
        installation: z3.object({
          enabled: z3.boolean().default(true),
          allowAutomaticDownload: z3.boolean().default(false),
          allowedMethods: z3.array(z3.string()).default(["npm", "winget", "brew"]),
          allowedIntegrations: z3.array(z3.string()).default(["claude", "codex", "cursor", "opencode", "antigravity"])
        }).default({})
      }).default({})
    });
    WorkersConfigSchema = z3.object({
      schemaVersion: z3.number().default(SCHEMA_VERSION),
      workers: z3.record(
        z3.string(),
        z3.object({
          enabled: z3.boolean().default(true),
          roles: z3.array(RoleSchema).default([]),
          capabilities: z3.array(z3.string()).default([])
        })
      ).default({})
    });
    AgentsConfigSchema = z3.object({
      schemaVersion: z3.number().default(SCHEMA_VERSION),
      agents: z3.record(
        z3.string(),
        z3.object({
          worker: z3.string(),
          model: z3.string().default("default"),
          enabled: z3.boolean().default(true),
          roles: z3.array(RoleSchema).default([]),
          instructions: z3.string().optional(),
          toolPermissions: z3.array(z3.string()).optional(),
          skills: z3.array(z3.string()).default([]),
          capabilities: z3.array(z3.string()).default([])
        })
      ).default({})
    });
    ProfileSchema = z3.object({
      name: z3.string(),
      mode: WorkflowModeSchema.optional(),
      routingPolicy: RoutingPolicySchema.optional(),
      primaryWorker: z3.string().optional(),
      workers: WorkersConfigSchema.shape.workers.optional(),
      routing: ConfigSchema.shape.routing.optional(),
      skip: z3.array(z3.string()).optional()
    });
  }
});

// src/config/defaults.ts
function defaultConfig() {
  return ConfigSchema.parse({});
}
function defaultWorkersConfig() {
  return WorkersConfigSchema.parse({
    workers: {
      native: { enabled: true, roles: ["planner", "investigator", "backend", "frontend", "coder", "tester", "reviewer", "general"] },
      claude: { enabled: false, roles: ["planner", "permission", "security", "reviewer"] },
      codex: { enabled: false, roles: ["backend", "coder", "tester"] },
      cursor: { enabled: false, roles: ["frontend", "coder"] },
      opencode: { enabled: false, roles: ["reviewer", "regression"] },
      antigravity: { enabled: false, roles: [] }
    }
  });
}
function defaultAgentsConfig() {
  return AgentsConfigSchema.parse({ agents: {} });
}
var init_defaults = __esm({
  "src/config/defaults.ts"() {
    "use strict";
    init_schema();
  }
});

// src/config/loader.ts
import { promises as fs7 } from "fs";
import path8 from "path";
async function loadConfig(workspaceRoot) {
  const paths = new RiqsPaths(workspaceRoot);
  const initialised = await fs7.stat(paths.dir).then((s) => s.isDirectory()).catch(() => false);
  const userGlobal = await loadUserGlobalConfig();
  const projectRaw = await readJson(paths.config(), {});
  const config = parseOrThrow(ConfigSchema, deepMerge(userGlobal, projectRaw), "config.json");
  const workers = parseOrThrow(
    WorkersConfigSchema,
    await readJson(paths.workers(), null) ?? defaultWorkersConfig(),
    "workers.json"
  );
  const agents = parseOrThrow(
    AgentsConfigSchema,
    await readJson(paths.agents(), null) ?? defaultAgentsConfig(),
    "agents.json"
  );
  return { paths, config, workers, agents, initialised };
}
async function loadUserGlobalConfig() {
  const file = path8.join(Platform.userPaths().config, "config.json");
  return readJson(file, {});
}
async function loadProfile(paths, name) {
  const raw = await readJson(paths.profileFile(name), null);
  if (raw === null) {
    const { RiqsError: RiqsError2 } = await Promise.resolve().then(() => (init_errors(), errors_exports));
    throw new RiqsError2("CONFIG", `Profile not found: ${name}`, { hint: `Looked in ${paths.profilesDir()}` });
  }
  return parseOrThrow(ProfileSchema, raw, `profile ${name}`);
}
async function writeConfig(paths, config) {
  await writeJson(paths.config(), config);
}
async function writeWorkers(paths, workers) {
  await writeJson(paths.workers(), workers);
}
async function writeAgents(paths, agents) {
  await writeJson(paths.agents(), agents);
}
function scaffoldConfigDefaults() {
  return { config: defaultConfig(), workers: defaultWorkersConfig(), agents: defaultAgentsConfig() };
}
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    const cur = out[k];
    if (isPlainObject(cur) && isPlainObject(v)) out[k] = deepMerge(cur, v);
    else out[k] = v;
  }
  return out;
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
var init_loader = __esm({
  "src/config/loader.ts"() {
    "use strict";
    init_json();
    init_paths2();
    init_platform();
    init_schema();
    init_defaults();
    init_contracts();
  }
});

// src/templates/scaffold.ts
function renderTemplate(content, agentDir) {
  return content.replace(/__AGENT_DIR__/g, agentDir);
}
var ADAPTER_BODY, ADAPTER_FILES, AGENT_DOC_FILES, WORKFLOW_FILES;
var init_scaffold = __esm({
  "src/templates/scaffold.ts"() {
    "use strict";
    ADAPTER_BODY = `gR DEV AGENT owns this repository's engineering workflow. Do not duplicate workflow rules here.

Always read, in order:
- __AGENT_DIR__/memory/project.md
- __AGENT_DIR__/config.json
- __AGENT_DIR__/workflow/task.json (when a run is active)

Follow the active assignment under:
- __AGENT_DIR__/workflow/assignments/

Use the skills under:
- __AGENT_DIR__/skills/

Write structured results to the path named in your assignment's \`outputFile\`.
Never rely on hidden conversation state for handoff \u2014 the assignment file is the input, the result file is the output.
`;
    ADAPTER_FILES = {
      "CLAUDE.md": `# CLAUDE.md

${ADAPTER_BODY}`,
      "AGENTS.md": `# AGENTS.md

${ADAPTER_BODY}`,
      ".cursor/rules/gr-dev-agent.mdc": `---
description: gR DEV AGENT source of truth
alwaysApply: true
---

${ADAPTER_BODY}`,
      ".opencode/instructions.md": `# OpenCode instructions

${ADAPTER_BODY}`
    };
    AGENT_DOC_FILES = {
      "README.md": `# __AGENT_DIR__/

Canonical workflow + knowledge for gR DEV AGENT. Plain JSON / Markdown / YAML so every tool \u2014
native worker, Claude Code, Codex, Cursor, Antigravity, OpenCode, or a manual handoff \u2014 reads the
same thing.

- \`config.json\`  \u2014 mode, routing, parallelism, native provider config
- \`workers.json\` \u2014 which workers are enabled and which roles they hold
- \`agents.json\`  \u2014 named worker+model personas
- \`memory/\`      \u2014 project facts, architecture, conventions, decisions
- \`skills/\`      \u2014 reusable investigation playbooks
- \`workflows/\`   \u2014 parallel workflow presets
- \`workflow/\`    \u2014 live run state (task, plan, assignments, results, evidence, checkpoints)
`,
      "memory/project.md": `# Project memory

_One paragraph: what this repository is, its primary language(s) and frameworks, how it is built and
tested. Keep it current \u2014 every worker reads this first._
`,
      "memory/architecture.md": `# Architecture

_Key modules, the main request/data flow, and where the important boundaries are._
`,
      "memory/conventions.md": `# Conventions

_Naming, error handling, logging, testing patterns a worker should match._
`,
      "memory/permissions.md": `# Permissions model

_How authorization works in this codebase: roles, per-artifact checks, dynamic role expansion,
where the enforcement points are._
`,
      "memory/known-issues.md": `# Known issues

_Recurring bug classes, fragile areas, flaky tests._
`,
      "memory/decisions.md": `# Decisions

_Dated architectural decisions and their rationale._
`,
      "prompts/planner.md": `You are the planner. Decide whether the task can be parallelised, which investigations are
independent, which assignments are read-only vs writers, and the dependency graph. Output the plan
as JSON matching the Plan contract.
`,
      "prompts/backend-agent.md": `Role: backend investigator. Trace Controller \u2192 Command \u2192 Handler \u2192 Service \u2192 Repository for the
described behaviour. Report facts (with file:line), then hypotheses, then recommendations.
`,
      "prompts/frontend-agent.md": `Role: frontend investigator. Determine whether the UI independently renders or requests data it
should not, or only reflects what the server returns.
`,
      "prompts/reviewer.md": `Role: reviewer. Check the proposed change against the acceptance criteria, the call chain, and
regression risk. Approve, request changes, or block \u2014 with reasons.
`,
      "prompts/tester.md": `Role: tester. Locate existing tests for the affected area, identify gaps, add targeted tests, and
run them. Report pass/fail with output.
`,
      "prompts/security-agent.md": `Role: security / permission auditor. Follow the permission-audit skill. Focus on authorization
bypass, missing artifact-level filters, and dynamic role expansion.
`,
      "skills/permission-audit.md": `# Permission audit

## Purpose
Find authorization bypasses: an actor seeing or changing data they lack permission for.

## Inputs
- The entity/screen where the bypass is observed
- The actor's roles and the expected permission

## Search strategy
1. Locate the read/query path for the entity (controller \u2192 service \u2192 repository).
2. Find where RolesAllowedToRead / IdsAllowedToRead (or equivalent) are applied.
3. Check dynamic role expansion and inherited/parent permissions.
4. Compare the Cockpit/list query filter with the single-item query filter.

## Checks
- Is an artifact-level read filter applied on every path, including list/summary endpoints?
- Are dynamic roles resolved consistently between endpoints?
- Do feature flags or environment config change the enforcement?

## Output format
facts (file:line) \u2192 hypotheses \u2192 recommended minimal fix \u2192 regression risks

## Validation
Add a test where the unauthorized actor must receive 403 / an empty result.
`,
      "skills/trace-endpoint.md": `# Trace endpoint

## Purpose
Map an HTTP endpoint end-to-end.

## Search strategy
1. Find the route/attribute matching the path + verb.
2. Follow to the command/handler, then the service, then the repository/query.
3. Note every authorization, validation and mapping step.

## Output format
An ordered call chain with file:line for each hop, plus the DB/query that ultimately runs.
`,
      "skills/async-audit.md": `# Async audit

## Purpose
Find fire-and-forget async, missing awaits, and unhandled rejections.

## Search strategy
- Search for calls returning a Promise/Task that are not awaited.
- Check background jobs and event handlers for error propagation.

## Output format
List of sites (file:line), the risk, and the fix.
`,
      "skills/regression-review.md": `# Regression review

## Purpose
Before finalising, check the diff for unintended behaviour change.

## Checks
- Does the change alter a shared code path used elsewhere?
- Are there callers relying on the old behaviour?
- Are line endings and unrelated formatting untouched?

## Output format
Regression risks with severity, and what to test.
`
    };
    WORKFLOW_FILES = {
      "workflows/bug-fix.yaml": `name: bug-fix
description: Generic investigate \u2192 implement \u2192 test + review.
parallel:
  - id: investigate
    role: investigator
after:
  - id: implement
    role: coder
  - id: test
    role: tester
  - id: review
    role: reviewer
`,
      "workflows/permission-bug.yaml": `name: permission-bug
description: Parallel permission investigation, then minimal fix + targeted tests + security review.
parallel:
  - id: api-authorization
    role: permission
    skills: [trace-endpoint]
  - id: artifact-permissions
    role: permission
    skills: [permission-audit]
  - id: dynamic-role-resolution
    role: permission
    skills: [permission-audit]
  - id: frontend-visibility
    role: frontend
after:
  - id: root-cause-merge
    role: investigator
  - id: implementation
    role: coder
  - id: targeted-tests
    role: tester
  - id: security-review
    role: security
    skills: [permission-audit, regression-review]
`,
      "workflows/endpoint-change.yaml": `name: endpoint-change
description: Change an endpoint safely \u2014 trace, implement, test contract, review.
parallel:
  - id: trace
    role: backend
    skills: [trace-endpoint]
  - id: callers
    role: investigator
after:
  - id: implement
    role: coder
  - id: contract-tests
    role: tester
  - id: review
    role: reviewer
`,
      "workflows/frontend-backend-trace.yaml": `name: frontend-backend-trace
description: Follow one behaviour across the FE/BE boundary.
parallel:
  - id: frontend
    role: frontend
  - id: backend
    role: backend
    skills: [trace-endpoint]
after:
  - id: merge
    role: investigator
  - id: review
    role: reviewer
`,
      "workflows/regression-review.yaml": `name: regression-review
description: Read-only review of the current diff for regressions.
parallel:
  - id: diff-review
    role: reviewer
    skills: [regression-review]
  - id: caller-impact
    role: investigator
after:
  - id: summary
    role: reviewer
`
    };
  }
});

// src/cli/init.ts
import { promises as fs8 } from "fs";
import path9 from "path";
async function scaffoldWorkspace(root, opts = {}) {
  const paths = new RiqsPaths(root);
  const created = [];
  const skipped = [];
  const write = async (rel, content) => {
    const abs = path9.join(root, rel);
    const exists = await fs8.stat(abs).then(() => true).catch(() => false);
    if (exists && !opts.force) {
      skipped.push(rel);
      return;
    }
    await fs8.mkdir(path9.dirname(abs), { recursive: true });
    await fs8.writeFile(abs, content, "utf8");
    created.push(rel);
  };
  const { config, workers, agents } = scaffoldConfigDefaults();
  const writeJsonRel = async (rel, value) => {
    const abs = path9.join(root, rel);
    const exists = await fs8.stat(abs).then(() => true).catch(() => false);
    if (exists && !opts.force) {
      skipped.push(rel);
      return;
    }
    await writeJson(abs, value);
    created.push(rel);
  };
  const dir = paths.dirName;
  await writeJsonRel(path9.relative(root, paths.config()), config);
  await writeJsonRel(path9.relative(root, paths.workers()), workers);
  await writeJsonRel(path9.relative(root, paths.agents()), agents);
  for (const [rel, content] of Object.entries(AGENT_DOC_FILES)) await write(path9.join(dir, rel), renderTemplate(content, dir));
  for (const [rel, content] of Object.entries(WORKFLOW_FILES)) await write(path9.join(dir, rel), content);
  for (const [rel, content] of Object.entries(ADAPTER_FILES)) await write(rel, renderTemplate(content, dir));
  for (const d of [paths.assignmentsDir(), paths.resultsDir(), paths.evidenceDir(), paths.checkpointsDir(), paths.locksDir()]) {
    await fs8.mkdir(d, { recursive: true });
  }
  await write(path9.join(dir, "workflow", ".gitkeep"), "");
  return { root, dir, created, skipped };
}
function logScaffoldResult(result) {
  log.success(`gR DEV AGENT initialised in ${result.root} (${result.dir}/)`);
  if (result.created.length) log.info("\n" + table(["created"], result.created.map((c) => [c])));
  if (result.skipped.length) log.info(`
${result.skipped.length} existing file(s) left untouched (use --force to overwrite).`);
}
function registerInit(program) {
  program.command("init").description("scaffold the agent directory (.gr-agent/) and thin tool adapters in the workspace").option("--force", "overwrite existing generated files").action(async (opts) => {
    const g = program.opts();
    const root = path9.resolve(g.workspace ?? process.cwd());
    const result = await scaffoldWorkspace(root, opts);
    logScaffoldResult(result);
    log.info('\nNext: `gr-agent doctor`, then `gr-agent run --workflow bug-fix "<task>"`.');
  });
}
var init_init = __esm({
  "src/cli/init.ts"() {
    "use strict";
    init_paths2();
    init_json();
    init_loader();
    init_scaffold();
    init_logger();
    init_render();
  }
});

// src/riqs/store.ts
import { promises as fs9 } from "fs";
import path10 from "path";
var RiqsStore;
var init_store = __esm({
  "src/riqs/store.ts"() {
    "use strict";
    init_paths2();
    init_json();
    init_contracts();
    RiqsStore = class {
      paths;
      constructor(workspaceRoot) {
        this.paths = new RiqsPaths(workspaceRoot);
      }
      async ensureRunDirs() {
        for (const d of [
          this.paths.workflowDir(),
          this.paths.assignmentsDir(),
          this.paths.resultsDir(),
          this.paths.evidenceDir(),
          this.paths.locksDir(),
          this.paths.checkpointsDir()
        ]) {
          await fs9.mkdir(d, { recursive: true });
        }
      }
      // --- task ---
      async readTask() {
        const raw = await readJson(this.paths.task(), null);
        return raw === null ? null : parseOrThrow(TaskSchema, raw, "task.json");
      }
      async writeTask(task) {
        await writeJson(this.paths.task(), { ...task, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      }
      // --- plan ---
      async readPlan() {
        const raw = await readJson(this.paths.plan(), null);
        return raw === null ? null : parseOrThrow(PlanSchema, raw, "plan.json");
      }
      async writePlan(plan) {
        await writeJson(this.paths.plan(), parseOrThrow(PlanSchema, plan, "plan.json"));
      }
      // --- assignments ---
      async writeAssignment(a) {
        await writeJson(this.paths.assignmentJson(a.id), parseOrThrow(AgentAssignmentSchema, a, `assignment ${a.id}`));
      }
      async writeAssignmentBundle(id, markdown) {
        await writeFileAtomic(this.paths.assignmentMd(id), markdown);
      }
      async readAssignment(id) {
        const raw = await readJson(this.paths.assignmentJson(id), null);
        return raw === null ? null : parseOrThrow(AgentAssignmentSchema, raw, `assignment ${id}`);
      }
      async listAssignments() {
        const dir = this.paths.assignmentsDir();
        const files = await fs9.readdir(dir).catch(() => []);
        const out = [];
        for (const f of files.filter((f2) => f2.endsWith(".json"))) {
          const raw = await readJson(path10.join(dir, f), null);
          if (raw) out.push(parseOrThrow(AgentAssignmentSchema, raw, `assignment ${f}`));
        }
        return out;
      }
      // --- results ---
      async writeResult(r) {
        await writeJson(this.paths.resultFile(r.id), parseOrThrow(AgentResultSchema, r, `result ${r.id}`));
      }
      async readResult(id) {
        const raw = await readJson(this.paths.resultFile(id), null);
        return raw === null ? null : parseOrThrow(AgentResultSchema, raw, `result ${id}`);
      }
      async listResults() {
        const dir = this.paths.resultsDir();
        const files = await fs9.readdir(dir).catch(() => []);
        const out = [];
        for (const f of files.filter((f2) => f2.endsWith(".json"))) {
          const raw = await readJson(path10.join(dir, f), null);
          if (raw) out.push(parseOrThrow(AgentResultSchema, raw, `result ${f}`));
        }
        return out;
      }
      // --- evidence (master plan §21) ---
      async addEvidence(e) {
        await writeJson(this.paths.evidenceFile(e.id), parseOrThrow(EvidenceSchema, e, `evidence ${e.id}`));
      }
      async listEvidence() {
        const dir = this.paths.evidenceDir();
        const files = await fs9.readdir(dir).catch(() => []);
        const out = [];
        for (const f of files.filter((f2) => f2.endsWith(".json"))) {
          const raw = await readJson(path10.join(dir, f), null);
          if (raw) out.push(parseOrThrow(EvidenceSchema, raw, `evidence ${f}`));
        }
        return out;
      }
      // --- checkpoints (master plan §29) ---
      async writeCheckpoint(cp) {
        await writeJson(this.paths.checkpointFile(cp.taskId), parseOrThrow(CheckpointSchema, cp, "checkpoint"));
      }
      async readCheckpoint(taskId) {
        const raw = await readJson(this.paths.checkpointFile(taskId), null);
        return raw === null ? null : parseOrThrow(CheckpointSchema, raw, "checkpoint");
      }
      async listCheckpoints() {
        const dir = this.paths.checkpointsDir();
        const files = await fs9.readdir(dir).catch(() => []);
        const out = [];
        for (const f of files.filter((f2) => f2.endsWith(".json"))) {
          const raw = await readJson(path10.join(dir, f), null);
          if (raw) out.push(parseOrThrow(CheckpointSchema, raw, `checkpoint ${f}`));
        }
        return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      }
      // --- audit log (non-secret metadata only, master plan §86, §121) ---
      async appendAudit(entry) {
        const line = JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), ...entry }) + "\n";
        await fs9.mkdir(path10.dirname(this.paths.auditLog()), { recursive: true });
        await fs9.appendFile(this.paths.auditLog(), line, "utf8");
      }
      async writeReport(taskId, markdown) {
        const file = this.paths.reportFile(taskId);
        await writeFileAtomic(file, markdown);
        return file;
      }
    };
  }
});

// src/cli/context.ts
import path11 from "path";
import { promises as fs10 } from "fs";
async function resolveContext(opts, requireInit = true) {
  const workspaceRoot = path11.resolve(opts.workspace ?? process.cwd());
  const stat = await fs10.stat(workspaceRoot).catch(() => null);
  if (!stat?.isDirectory()) throw new RiqsError("WORKSPACE", `Not a directory: ${workspaceRoot}`);
  await Platform.loadDotEnv(workspaceRoot);
  const loaded = await loadConfig(workspaceRoot);
  if (requireInit && !loaded.initialised) {
    throw new RiqsError("CONFIG", `No agent directory (.gr-agent/ or .riqs-agent/) in ${workspaceRoot}`, {
      hint: "Run `gr-agent init` first."
    });
  }
  return {
    ...loaded,
    workspaceRoot,
    store: new RiqsStore(workspaceRoot),
    nonInteractive: Boolean(opts.nonInteractive) || Platform.isNonInteractive()
  };
}
var init_context = __esm({
  "src/cli/context.ts"() {
    "use strict";
    init_platform();
    init_loader();
    init_store();
    init_errors();
  }
});

// src/tools/workspaceGuard.ts
import { promises as fs11 } from "fs";
import path12 from "path";
var WorkspaceGuard;
var init_workspaceGuard = __esm({
  "src/tools/workspaceGuard.ts"() {
    "use strict";
    init_platform();
    init_errors();
    WorkspaceGuard = class _WorkspaceGuard {
      root;
      constructor(root) {
        this.root = root;
      }
      static async create(root) {
        const resolved = path12.resolve(root);
        let real;
        try {
          real = await fs11.realpath(resolved);
        } catch {
          throw new RiqsError("WORKSPACE", `Workspace does not exist: ${resolved}`);
        }
        return new _WorkspaceGuard(real);
      }
      /** Resolve a possibly-relative path and assert it stays inside the workspace. */
      async resolveInside(target) {
        const abs = path12.isAbsolute(target) ? target : path12.join(this.root, target);
        const contained = await Platform.realParentContains(this.root, abs);
        if (!contained) {
          throw new RiqsError("WORKSPACE", `Path escapes the workspace: ${target}`, {
            hint: "Workers may only read and write inside the workspace root."
          });
        }
        return path12.resolve(abs);
      }
      /** Synchronous lexical check for hot paths that cannot await (defence-in-depth, not the primary gate). */
      isLexicallyInside(target) {
        const abs = path12.isAbsolute(target) ? target : path12.join(this.root, target);
        return Platform.isSubPath(this.root, abs);
      }
      relative(target) {
        return path12.relative(this.root, path12.resolve(target)) || ".";
      }
    };
  }
});

// src/tools/git.ts
var Git;
var init_git = __esm({
  "src/tools/git.ts"() {
    "use strict";
    init_platform();
    init_errors();
    Git = class _Git {
      constructor(cwd, gitPath) {
        this.cwd = cwd;
        this.gitPath = gitPath;
      }
      cwd;
      gitPath;
      static async open(cwd) {
        const gitPath = await Platform.findExecutable("git");
        if (!gitPath) return null;
        const g = new _Git(cwd, gitPath);
        const res = await g.raw(["rev-parse", "--is-inside-work-tree"]);
        return res.exitCode === 0 && res.stdout.trim() === "true" ? g : null;
      }
      async raw(args, opts = {}) {
        return Platform.run(this.gitPath, args, { cwd: this.cwd, timeoutMs: 6e4, signal: opts.signal });
      }
      async must(args) {
        const res = await this.raw(args);
        if (res.exitCode !== 0) {
          throw new RiqsError("GIT", `git ${args.join(" ")} failed: ${res.stderr.trim() || res.stdout.trim()}`);
        }
        return res.stdout;
      }
      async version() {
        return (await this.must(["--version"])).trim();
      }
      async currentBranch() {
        return (await this.must(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      }
      async headSha() {
        return (await this.must(["rev-parse", "HEAD"])).trim();
      }
      async status() {
        const out = await this.must(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
        const parts = out.split("\0").filter(Boolean);
        const entries = [];
        for (let i = 0; i < parts.length; i++) {
          const rec = parts[i];
          const xy = rec.slice(0, 2);
          const p = rec.slice(3);
          if (xy[0] === "R" || xy[1] === "R") i++;
          entries.push({ path: p, index: xy[0].trim(), worktree: xy[1].trim() });
        }
        return entries;
      }
      async isClean() {
        return (await this.status()).length === 0;
      }
      async diff(args = []) {
        return this.must(["diff", "--no-color", ...args]);
      }
      async diffStat(args = []) {
        return this.must(["diff", "--stat", "--no-color", ...args]);
      }
      // --- worktree isolation (master plan §7, §8) ---
      async worktreeAdd(dir, branch, base = "HEAD") {
        await this.must(["worktree", "add", "-b", branch, dir, base]);
      }
      async worktreeList() {
        const out = await this.must(["worktree", "list", "--porcelain", "-z"]);
        const blocks = out.split("\0\0").filter(Boolean);
        return blocks.map((b) => {
          const lines2 = b.split("\0");
          const get = (k) => lines2.find((l) => l.startsWith(k + " "))?.slice(k.length + 1) ?? "";
          return { path: get("worktree"), branch: get("branch").replace("refs/heads/", ""), sha: get("HEAD") };
        });
      }
      async worktreeRemove(dir, force = false) {
        await this.must(["worktree", "remove", ...force ? ["--force"] : [], dir]);
      }
    };
  }
});

// src/riqs/locks.ts
import { promises as fs12 } from "fs";
import path13 from "path";
var LockManager;
var init_locks = __esm({
  "src/riqs/locks.ts"() {
    "use strict";
    init_errors();
    LockManager = class {
      constructor(paths) {
        this.paths = paths;
      }
      paths;
      lockPath(key) {
        const safe = key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200) || "root";
        return path13.join(this.paths.locksDir(), `${safe}.lock`);
      }
      async acquire(key, owner, opts = {}) {
        const dir = this.lockPath(key);
        await fs12.mkdir(this.paths.locksDir(), { recursive: true });
        const deadline = Date.now() + (opts.timeoutMs ?? 12e4);
        const poll = opts.pollMs ?? 200;
        for (; ; ) {
          try {
            await fs12.mkdir(dir);
            await fs12.writeFile(path13.join(dir, "owner"), `${owner}
${(/* @__PURE__ */ new Date()).toISOString()}
`, "utf8");
            let released = false;
            return async () => {
              if (released) return;
              released = true;
              await fs12.rm(dir, { recursive: true, force: true });
            };
          } catch (e) {
            if (e.code !== "EEXIST") throw e;
            if (Date.now() > deadline) {
              const holder = await fs12.readFile(path13.join(dir, "owner"), "utf8").catch(() => "unknown");
              throw new RiqsError("LOCK", `Timed out waiting for lock "${key}" held by ${holder.split("\n")[0]}`);
            }
            await new Promise((r) => setTimeout(r, poll));
          }
        }
      }
      async withLock(key, owner, fn, opts) {
        const release = await this.acquire(key, owner, opts);
        try {
          return await fn();
        } finally {
          await release();
        }
      }
      async listLocks() {
        const entries = await fs12.readdir(this.paths.locksDir()).catch(() => []);
        return entries.filter((e) => e.endsWith(".lock"));
      }
    };
  }
});

// src/riqs/memory.ts
import { promises as fs13 } from "fs";
import path14 from "path";
async function loadMemory(paths) {
  const dir = paths.memoryDir();
  const files = await fs13.readdir(dir).catch(() => []);
  const docs = [];
  for (const f of files.filter((f2) => f2.endsWith(".md")).sort()) {
    docs.push({ name: f, content: await fs13.readFile(path14.join(dir, f), "utf8") });
  }
  return docs;
}
async function loadMemoryText(paths, maxChars = 12e3) {
  const docs = await loadMemory(paths);
  let out = "";
  for (const d of docs) {
    const block = `
## memory/${d.name}

${d.content.trim()}
`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}
var init_memory = __esm({
  "src/riqs/memory.ts"() {
    "use strict";
  }
});

// src/riqs/skills.ts
import { promises as fs14 } from "fs";
import path15 from "path";
async function discoverSkills(paths) {
  const roots = [
    { dir: paths.skillsDir(), generated: false },
    { dir: path15.join(paths.skillsDir(), "generated"), generated: true }
  ];
  const skills = [];
  for (const { dir, generated } of roots) {
    const files = await fs14.readdir(dir).catch(() => []);
    for (const f of files.filter((f2) => f2.endsWith(".md")).sort()) {
      const full = path15.join(dir, f);
      const content = await fs14.readFile(full, "utf8");
      const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? f.replace(/\.md$/, "");
      skills.push({ name: f.replace(/\.md$/, ""), title, path: full, content, generated });
    }
  }
  return skills;
}
async function skillText(paths, names, maxChars = 8e3) {
  if (names.length === 0) return "";
  const all = await discoverSkills(paths);
  let out = "";
  for (const name of names) {
    const s = all.find((x) => x.name === name);
    if (!s) continue;
    const block = `
---
# skill: ${s.name}

${s.content.trim()}
`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}
var init_skills = __esm({
  "src/riqs/skills.ts"() {
    "use strict";
  }
});

// src/llm/promptEnvelope.ts
function buildPromptEnvelope(a, ctx) {
  const lines2 = [];
  lines2.push("You are a worker in gR DEV AGENT.");
  lines2.push("");
  lines2.push(`Role:
${a.role}`);
  lines2.push("");
  lines2.push(`Task ID:
${a.taskId}`);
  lines2.push("");
  lines2.push(`Assignment ID:
${a.id}`);
  lines2.push("");
  lines2.push(`Objective:
${a.objective}`);
  lines2.push("");
  lines2.push("Rules:");
  lines2.push("- Read .riqs-agent/memory/project.md first (provided below if present).");
  lines2.push("- Read the relevant skill files (provided below if any).");
  lines2.push(
    a.readOnly ? "- This assignment is READ-ONLY. Do not modify any file." : `- You may modify files only within: ${a.allowedPaths.join(", ")}`
  );
  lines2.push("- Do not perform unrelated refactoring.");
  lines2.push("- Inspect actual code before making claims.");
  lines2.push("- Clearly separate facts, hypotheses and recommendations.");
  lines2.push("- Include file paths and line references whenever possible.");
  lines2.push("- Return findings in the required structured JSON format.");
  lines2.push("");
  lines2.push(`Allowed paths: ${a.allowedPaths.join(", ")}`);
  if (a.dependencies.length) lines2.push(`Upstream assignments already completed: ${a.dependencies.join(", ")}`);
  lines2.push("");
  if (ctx.memory) lines2.push(`--- shared memory ---
${ctx.memory}
`);
  if (ctx.skills) lines2.push(`--- skills ---
${ctx.skills}
`);
  if (ctx.evidence) lines2.push(`--- shared evidence ---
${ctx.evidence}
`);
  lines2.push(`Write your structured result to:
${a.outputFile}`);
  return lines2.join("\n");
}
function resultContractHint() {
  return [
    "Your final answer MUST be a single JSON object with this shape:",
    "{",
    '  "status": "completed" | "failed" | "blocked" | "partial",',
    '  "findings": [{ "kind": "fact"|"hypothesis"|"recommendation", "subsystem": string,',
    '                "summary": string, "detail": string, "files": string[], "confidence": 0..1 }],',
    '  "filesInspected": string[],',
    '  "rootCauseHypotheses": string[],',
    '  "recommendedChanges": [{ "file": string, "summary": string, "rationale": string }],',
    '  "risks": string[],',
    '  "confidence": 0..1',
    "}"
  ].join("\n");
}
var init_promptEnvelope = __esm({
  "src/llm/promptEnvelope.ts"() {
    "use strict";
  }
});

// src/workers/worker.ts
function baseResult(a, worker) {
  return {
    taskId: a.taskId,
    id: a.id,
    role: a.role,
    worker,
    status: "partial",
    findings: [],
    filesInspected: [],
    rootCauseHypotheses: [],
    recommendedChanges: [],
    risks: [],
    confidence: 0.3,
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var init_worker = __esm({
  "src/workers/worker.ts"() {
    "use strict";
  }
});

// src/tools/fs.ts
import { promises as fs15 } from "fs";
import path16 from "path";
var DEFAULT_MAX_BYTES, RepoFs;
var init_fs = __esm({
  "src/tools/fs.ts"() {
    "use strict";
    init_json();
    init_lineEndings();
    init_errors();
    DEFAULT_MAX_BYTES = 512 * 1024;
    RepoFs = class {
      constructor(guard) {
        this.guard = guard;
      }
      guard;
      async readFile(rel, opts = {}) {
        const abs = await this.guard.resolveInside(rel);
        const stat = await fs15.stat(abs).catch(() => {
          throw new RiqsError("WORKSPACE", `File not found: ${rel}`);
        });
        if (stat.isDirectory()) throw new RiqsError("WORKSPACE", `Not a file: ${rel}`);
        const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
        const buf = await fs15.readFile(abs);
        const slice = buf.subarray(0, max);
        return {
          path: this.guard.relative(abs),
          content: slice.toString("utf8"),
          truncated: buf.byteLength > max,
          bytes: buf.byteLength
        };
      }
      async listDir(rel = ".") {
        const abs = await this.guard.resolveInside(rel);
        const dirents = await fs15.readdir(abs, { withFileTypes: true });
        return {
          path: this.guard.relative(abs),
          entries: dirents.filter((d) => d.name !== ".git" && d.name !== "node_modules").map((d) => ({ name: d.name, type: d.isDirectory() ? "dir" : "file" })).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)
        };
      }
      async exists(rel) {
        try {
          await this.guard.resolveInside(rel);
          await fs15.access(path16.join(this.guard.root, rel));
          return true;
        } catch {
          return false;
        }
      }
      /** Write inside the workspace, preserving the target file's existing line-ending style (§61). */
      async writeFile(rel, content) {
        const abs = await this.guard.resolveInside(rel);
        const style = await detectFileEol(abs);
        await writeFileAtomic(abs, applyEol(content, style));
      }
    };
  }
});

// src/tools/search.ts
import { promises as fs16 } from "fs";
import path17 from "path";
import fg from "fast-glob";
var IGNORE, RepoSearch;
var init_search = __esm({
  "src/tools/search.ts"() {
    "use strict";
    init_platform();
    IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/bin/**", "**/obj/**", "**/.worktrees/**"];
    RepoSearch = class {
      constructor(guard) {
        this.guard = guard;
      }
      guard;
      async grep(pattern, opts = {}) {
        const max = opts.maxResults ?? 200;
        const rg = await Platform.findExecutable("rg");
        if (rg) return this.grepRipgrep(rg, pattern, opts, max);
        return this.grepNode(pattern, opts, max);
      }
      async findFiles(glob) {
        const patterns = Array.isArray(glob) ? glob : [glob];
        const matches = await fg(patterns, {
          cwd: this.guard.root,
          ignore: IGNORE,
          dot: false,
          onlyFiles: true,
          suppressErrors: true
        });
        return matches.sort();
      }
      async grepRipgrep(rg, pattern, opts, max) {
        const args = ["--json", "--max-count", String(max)];
        if (opts.ignoreCase) args.push("-i");
        for (const g of opts.glob ?? []) args.push("-g", g);
        for (const ig of IGNORE) args.push("-g", `!${ig}`);
        args.push("--", pattern, ".");
        const res = await Platform.run(rg, args, { cwd: this.guard.root, timeoutMs: 3e4 });
        const hits = [];
        for (const line of res.stdout.split("\n")) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "match") {
              hits.push({
                file: obj.data.path.text,
                line: obj.data.line_number,
                text: String(obj.data.lines.text ?? "").replace(/\r?\n$/, "").slice(0, 400)
              });
              if (hits.length >= max) break;
            }
          } catch {
          }
        }
        return hits;
      }
      async grepNode(pattern, opts, max) {
        const re = new RegExp(pattern, opts.ignoreCase ? "i" : "");
        const files = await fg(opts.glob ?? ["**/*"], {
          cwd: this.guard.root,
          ignore: IGNORE,
          onlyFiles: true,
          suppressErrors: true,
          dot: false
        });
        const hits = [];
        for (const rel of files) {
          if (hits.length >= max) break;
          const abs = path17.join(this.guard.root, rel);
          let content;
          try {
            const buf = await fs16.readFile(abs);
            if (buf.includes(0)) continue;
            content = buf.toString("utf8");
          } catch {
            continue;
          }
          const lines2 = content.split(/\r?\n/);
          for (let i = 0; i < lines2.length && hits.length < max; i++) {
            if (re.test(lines2[i])) hits.push({ file: rel, line: i + 1, text: lines2[i].slice(0, 400) });
          }
        }
        return hits;
      }
    };
  }
});

// src/util/spinner.ts
function setSpinnerSink(fn) {
  sink2 = fn;
}
async function withSpinner(label, fn) {
  if (sink2) return withSpinnerSink(label, sink2, fn);
  if (!process.stdout.isTTY || active) return fn();
  active = true;
  let frame = 0;
  const start = Date.now();
  const render2 = () => {
    const elapsed = Math.round((Date.now() - start) / 1e3);
    process.stdout.write(`\r\x1B[2K${FRAMES[frame % FRAMES.length]} ${label} (${elapsed}s)`);
    frame++;
  };
  render2();
  const timer = setInterval(render2, FRAME_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    process.stdout.write("\r\x1B[2K");
    active = false;
  }
}
async function withSpinnerSink(label, sinkFn, fn) {
  let frame = 0;
  const start = Date.now();
  const render2 = () => {
    const elapsed = Math.round((Date.now() - start) / 1e3);
    sinkFn(`${FRAMES[frame % FRAMES.length]} ${label} (${elapsed}s)`);
    frame++;
  };
  render2();
  const timer = setInterval(render2, FRAME_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    sinkFn(void 0);
  }
}
var FRAMES, FRAME_MS, active, sink2;
var init_spinner = __esm({
  "src/util/spinner.ts"() {
    "use strict";
    FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
    FRAME_MS = 100;
    active = false;
  }
});

// src/util/roleVerb.ts
function roleVerb(role) {
  return ROLE_VERBS[role] ?? "Working";
}
var ROLE_VERBS;
var init_roleVerb = __esm({
  "src/util/roleVerb.ts"() {
    "use strict";
    ROLE_VERBS = {
      planner: "Planning",
      investigator: "Investigating",
      backend: "Working on the backend",
      frontend: "Working on the frontend",
      database: "Working on the database",
      permission: "Auditing permissions",
      security: "Reviewing security",
      performance: "Profiling performance",
      coder: "Implementing",
      tester: "Testing",
      reviewer: "Reviewing",
      regression: "Checking for regressions",
      documentation: "Writing docs",
      git: "Working with git",
      release: "Preparing the release",
      general: "Working"
    };
  }
});

// src/workers/nativeWorker.ts
function withinAllowed(p, allowed) {
  if (allowed.includes("**")) return true;
  return allowed.some((glob) => {
    const re = new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
    return re.test(p);
  });
}
function finalize(a, result, raw) {
  const merged = { ...result, ...typeof raw === "object" && raw ? raw : {}, taskId: a.taskId, id: a.id, role: a.role, worker: result.worker };
  const parsed = AgentResultSchema.safeParse({ ...merged, finishedAt: (/* @__PURE__ */ new Date()).toISOString() });
  if (parsed.success) return parsed.data;
  return {
    ...result,
    status: "partial",
    error: `worker returned a malformed result: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    findings: result.findings,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function extractJson(text3) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text3);
  const candidate = fenced ? fenced[1] : text3;
  try {
    return JSON.parse(candidate.trim());
  } catch {
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + `
\u2026 [+${s.length - n} chars]` : s;
}
var MAX_STEPS, NativeWorker;
var init_nativeWorker = __esm({
  "src/workers/nativeWorker.ts"() {
    "use strict";
    init_worker();
    init_contracts();
    init_promptEnvelope();
    init_fs();
    init_search();
    init_git();
    init_logger();
    init_spinner();
    init_roleVerb();
    init_errors();
    MAX_STEPS = 24;
    NativeWorker = class {
      constructor(name, provider, model) {
        this.name = name;
        this.provider = provider;
        this.model = model;
      }
      name;
      provider;
      model;
      kind = "native";
      async isAvailable() {
        return true;
      }
      async execute(a, ctx) {
        const result = baseResult(a, this.name);
        const fs25 = new RepoFs(ctx.guard);
        const search = new RepoSearch(ctx.guard);
        const git = await Git.open(ctx.cwd);
        const messages = [
          { role: "system", content: this.systemPrompt(a, ctx) },
          { role: "user", content: `${ctx.prompt}

${resultContractHint()}

Begin. Respond with one JSON action.` }
        ];
        for (let step = 0; step < MAX_STEPS; step++) {
          if (ctx.signal?.aborted) throw new CancelledError();
          const reply = await withSpinner(
            `${roleVerb(a.role)}\u2026 (${this.name}, step ${step + 1}/${MAX_STEPS})`,
            () => this.provider.chat(messages, {
              model: this.model ?? ctx.model,
              signal: ctx.signal,
              json: true,
              maxOutputTokens: 4096
            })
          );
          messages.push({ role: "assistant", content: reply.text });
          const call = extractJson(reply.text);
          if (!call) {
            messages.push({ role: "user", content: 'Could not parse JSON. Reply with exactly one JSON object: {"tool":...} or {"final":...}.' });
            continue;
          }
          if (call.final !== void 0) {
            return finalize(a, result, call.final);
          }
          const obs = await this.runTool(call, { fs: fs25, search, git, a });
          messages.push({ role: "user", content: `Observation (${call.tool}):
${truncate(obs, 6e3)}

Next JSON action.` });
        }
        log.warn(`native worker ${a.id}: step budget exhausted`);
        result.status = "partial";
        result.error = "step budget exhausted before a final result";
        result.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
        return result;
      }
      systemPrompt(a, ctx) {
        const tools = [
          'read_file { "path": string }  \u2014 read a file (relative to workspace root)',
          'list_dir { "path": string }   \u2014 list a directory',
          'search_code { "pattern": string, "glob"?: string[], "ignoreCase"?: boolean } \u2014 regex search',
          'find_files { "glob": string } \u2014 glob for files',
          "git_status {}                 \u2014 porcelain working-tree status",
          'git_diff { "args"?: string[] }\u2014 unified diff'
        ];
        if (!a.readOnly) tools.push('write_file { "path": string, "content": string } \u2014 write within allowedPaths only');
        return [
          `You are the gR DEV AGENT native worker operating on workspace: ${ctx.workspaceRoot}`,
          "You act by emitting ONE JSON object per turn. No prose outside JSON.",
          'To use a tool: {"thought": "...", "tool": "<name>", "args": { ... }}',
          'To finish:     {"final": { ...result object... }}',
          "",
          "Available tools:",
          ...tools.map((t) => `- ${t}`),
          "",
          "Stay strictly within the assignment objective and allowed paths. Prefer targeted searches over reading large files."
        ].join("\n");
      }
      async runTool(call, dep) {
        const args = call.args ?? {};
        try {
          switch (call.tool) {
            case "read_file": {
              const r = await dep.fs.readFile(String(args.path));
              return `${r.path} (${r.bytes} bytes${r.truncated ? ", truncated" : ""}):
${r.content}`;
            }
            case "list_dir": {
              const r = await dep.fs.listDir(String(args.path ?? "."));
              return `${r.path}:
${r.entries.map((e) => `${e.type === "dir" ? "d" : "-"} ${e.name}`).join("\n")}`;
            }
            case "search_code": {
              const hits = await dep.search.grep(String(args.pattern), {
                glob: args.glob ?? void 0,
                ignoreCase: Boolean(args.ignoreCase)
              });
              return hits.length ? hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join("\n") : "no matches";
            }
            case "find_files": {
              const files = await dep.search.findFiles(String(args.glob));
              return files.slice(0, 200).join("\n") || "no files";
            }
            case "git_status":
              return dep.git ? JSON.stringify(await dep.git.status(), null, 2) : "git unavailable";
            case "git_diff":
              return dep.git ? (await dep.git.diff(args.args ?? [])).slice(0, 8e3) : "git unavailable";
            case "write_file": {
              if (dep.a.readOnly) return "ERROR: assignment is read-only";
              const p = String(args.path);
              if (!withinAllowed(p, dep.a.allowedPaths)) return `ERROR: ${p} is outside allowedPaths`;
              await dep.fs.writeFile(p, String(args.content ?? ""));
              return `wrote ${p}`;
            }
            default:
              return `ERROR: unknown tool "${call.tool}"`;
          }
        } catch (e) {
          return `ERROR: ${e.message}`;
        }
      }
    };
  }
});

// src/workers/manualWorker.ts
import { promises as fs17 } from "fs";
var ManualWorker;
var init_manualWorker = __esm({
  "src/workers/manualWorker.ts"() {
    "use strict";
    init_worker();
    init_contracts();
    init_logger();
    init_errors();
    ManualWorker = class {
      constructor(name = "manual", opts = {}) {
        this.opts = opts;
        this.name = name;
      }
      opts;
      kind = "manual";
      name;
      async isAvailable() {
        return true;
      }
      async execute(a, ctx) {
        const resultPath = ctx.paths.resultFile(a.id);
        await ctx.store.writeAssignmentBundle(a.id, this.bundle(a, ctx));
        log.step(`Manual handoff for "${a.id}" (${a.role}).`);
        log.info(`  Assignment: ${ctx.paths.assignmentMd(a.id)}`);
        log.info(`  Write the result JSON to: ${resultPath}`);
        if (ctx.nonInteractive) {
          const existing = await this.tryRead(resultPath);
          if (existing) return existing;
          throw new RiqsError("WORKER", `Manual assignment ${a.id} has no result and the session is non-interactive`, {
            hint: `Provide ${resultPath} then re-run, or use \`gr-agent result import\`.`
          });
        }
        const deadline = Date.now() + (this.opts.timeoutMs ?? 30 * 6e4);
        const poll = this.opts.pollMs ?? 2e3;
        let mtime = 0;
        for (; ; ) {
          if (ctx.signal?.aborted) throw new CancelledError();
          const stat = await fs17.stat(resultPath).catch(() => null);
          if (stat && stat.mtimeMs !== mtime) {
            mtime = stat.mtimeMs;
            const parsed = await this.tryRead(resultPath);
            if (parsed) {
              log.success(`Received manual result for ${a.id}`);
              return parsed;
            }
            log.warn(`  ${a.id}: result file present but not yet valid \u2014 still waiting`);
          }
          if (Date.now() > deadline) {
            const fallback = baseResult(a, this.name);
            fallback.status = "blocked";
            fallback.error = "manual handoff timed out";
            return fallback;
          }
          await new Promise((r) => setTimeout(r, poll));
        }
      }
      async tryRead(file) {
        try {
          const raw = JSON.parse(await fs17.readFile(file, "utf8"));
          const parsed = AgentResultSchema.safeParse(raw);
          return parsed.success ? parsed.data : null;
        } catch {
          return null;
        }
      }
      bundle(a, ctx) {
        const meta = [
          `- Task: ${a.taskId}`,
          `- Role: ${a.role}`,
          `- Read-only: ${a.readOnly}`,
          `- Allowed paths: ${a.allowedPaths.join(", ")}`,
          ...a.worktree ? [`- Worktree: ${a.worktree}`] : []
        ];
        return [
          `# gR DEV AGENT assignment \u2014 ${a.id}`,
          "",
          ...meta,
          "",
          "## Prompt",
          "",
          ctx.prompt,
          "",
          "## How to return your result",
          "",
          "Write a JSON object matching the RIQS AgentResult contract to:",
          "",
          "```",
          ctx.paths.resultFile(a.id),
          "```",
          "",
          "Then re-run `gr-agent resume` (or the orchestrator will pick it up automatically).",
          ""
        ].join("\n");
      }
    };
  }
});

// src/workers/cliWorker.ts
import { promises as fs18 } from "fs";
import path18 from "path";
async function readResult(file) {
  try {
    return JSON.parse(await fs18.readFile(file, "utf8"));
  } catch {
    return null;
  }
}
function extractResult(stdout) {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(stdout);
  const body = fence ? fence[1] : stdout;
  const s = body.indexOf("{");
  const e = body.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(body.slice(s, e + 1));
  } catch {
    return null;
  }
}
function normalize(a, raw, worker) {
  const base = baseResult(a, worker);
  const merged = { ...base, ...typeof raw === "object" && raw ? raw : {}, taskId: a.taskId, id: a.id, role: a.role, worker, finishedAt: (/* @__PURE__ */ new Date()).toISOString() };
  const parsed = AgentResultSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  base.status = "partial";
  base.error = `external worker returned a malformed result: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
  base.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  return base;
}
var CliWorker;
var init_cliWorker = __esm({
  "src/workers/cliWorker.ts"() {
    "use strict";
    init_worker();
    init_contracts();
    init_platform();
    init_logger();
    init_spinner();
    init_roleVerb();
    init_errors();
    init_manualWorker();
    CliWorker = class {
      constructor(spec) {
        this.spec = spec;
        this.name = spec.id;
      }
      spec;
      kind = "cli";
      name;
      async isAvailable() {
        for (const exe of this.spec.executables) {
          if (await Platform.isCommandAvailable(exe)) return true;
        }
        return false;
      }
      async resolveExe() {
        for (const exe of this.spec.executables) {
          const found = await Platform.findExecutable(exe);
          if (found) return found;
        }
        return null;
      }
      async execute(a, ctx) {
        const exe = await this.resolveExe();
        if (!exe) {
          log.warn(`${this.name} CLI not found \u2014 falling back to manual handoff for ${a.id}`);
          return new ManualWorker(this.name).execute(a, ctx);
        }
        if (ctx.signal?.aborted) throw new CancelledError();
        const result = baseResult(a, this.name);
        const promptFile = path18.join(ctx.paths.workflowDir(), `prompt-${a.id}.txt`);
        await fs18.mkdir(path18.dirname(promptFile), { recursive: true });
        await fs18.writeFile(promptFile, ctx.prompt, "utf8");
        const subs = {
          "{prompt}": ctx.prompt,
          "{promptFile}": promptFile,
          "{objective}": a.objective,
          "{model}": this.modelArg(ctx),
          "{cwd}": this.spec.useWorktreeCwd ? ctx.cwd : ctx.workspaceRoot,
          "{resultFile}": ctx.paths.resultFile(a.id)
        };
        const argv = this.spec.argv.map((t) => subs[t] !== void 0 ? subs[t] : t).filter((x) => x !== "");
        const summaryArgv = this.spec.argv.map(
          (t) => t === "{prompt}" ? `<prompt: ${ctx.prompt.length} chars, saved to ${path18.basename(promptFile)}>` : subs[t] !== void 0 ? subs[t] : t
        );
        log.debug(`${this.name}: ${path18.basename(exe)} ${summaryArgv.join(" ")}`);
        log.debug(`${this.name} full argv: ${path18.basename(exe)} ${argv.join(" ")}`);
        const run = await withSpinner(
          `${roleVerb(a.role)}\u2026 (${this.name})`,
          () => Platform.run(exe, argv, {
            cwd: this.spec.useWorktreeCwd ? ctx.cwd : ctx.workspaceRoot,
            input: this.spec.promptDelivery === "stdin" ? ctx.prompt : void 0,
            timeoutMs: 15 * 6e4,
            signal: ctx.signal
          })
        );
        if (this.spec.writesResultFile) {
          const fromFile = await readResult(ctx.paths.resultFile(a.id));
          if (fromFile) return normalize(a, fromFile, this.name);
        }
        const fromStdout = extractResult(run.stdout);
        if (fromStdout) return normalize(a, fromStdout, this.name);
        if (run.exitCode === 0 && run.stdout.trim()) {
          result.status = "partial";
          result.findings.push({
            kind: "fact",
            subsystem: "external-worker-output",
            summary: `${this.name} produced unstructured output`,
            detail: run.stdout.slice(0, 4e3),
            files: [],
            evidenceIds: [],
            confidence: 0.4
          });
          result.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
          return result;
        }
        log.warn(`${this.name} exited ${run.exitCode}; falling back to manual handoff for ${a.id}`);
        return new ManualWorker(this.name).execute(a, ctx);
      }
      modelArg(ctx) {
        return ctx.model && ctx.model !== "default" ? ctx.model : "";
      }
    };
  }
});

// src/integrations/registry.ts
var IntegrationRegistry;
var init_registry = __esm({
  "src/integrations/registry.ts"() {
    "use strict";
    init_detector();
    init_integration();
    IntegrationRegistry = class {
      statuses = /* @__PURE__ */ new Map();
      async refresh() {
        const all = await detectAll();
        this.statuses = new Map(all.map((s) => [s.id, s]));
      }
      get(id) {
        return this.statuses.get(id);
      }
      all() {
        return [...this.statuses.values()];
      }
      isReady(id) {
        return this.statuses.get(id)?.readiness === "ready";
      }
      async workerInvoke(id) {
        const manifest = await loadManifest();
        return manifest.integrations[id]?.worker;
      }
    };
  }
});

// src/llm/provider.ts
var ProviderUnavailableError;
var init_provider = __esm({
  "src/llm/provider.ts"() {
    "use strict";
    ProviderUnavailableError = class extends Error {
      constructor(providerId, reason) {
        super(`LLM provider "${providerId}" unavailable: ${reason}`);
        this.name = "ProviderUnavailableError";
      }
    };
  }
});

// src/llm/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
var DEFAULT_MODEL, AnthropicProvider;
var init_anthropic = __esm({
  "src/llm/anthropic.ts"() {
    "use strict";
    init_provider();
    DEFAULT_MODEL = "claude-sonnet-4-5";
    AnthropicProvider = class {
      id = "anthropic";
      defaultModel;
      client;
      constructor(opts = {}) {
        const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) throw new ProviderUnavailableError("anthropic", "ANTHROPIC_API_KEY is not set");
        this.client = new Anthropic({ apiKey, baseURL: opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL });
        this.defaultModel = opts.model && opts.model !== "default" ? opts.model : DEFAULT_MODEL;
      }
      async chat(messages, opts = {}) {
        const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
        const turns = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
        const model = opts.model && opts.model !== "default" ? opts.model : this.defaultModel;
        const res = await this.client.messages.create(
          {
            model,
            system: system || void 0,
            messages: turns.length ? turns : [{ role: "user", content: "" }],
            max_tokens: opts.maxOutputTokens ?? 4096,
            temperature: opts.temperature ?? 0
          },
          { signal: opts.signal }
        );
        const text3 = res.content.map((b) => b.type === "text" ? b.text : "").join("").trim();
        return {
          text: text3,
          model,
          usage: { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens }
        };
      }
    };
  }
});

// src/llm/openai.ts
import OpenAI from "openai";
function createOpenAiProvider(model) {
  return new OpenAiCompatibleProvider({
    id: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model,
    defaultModel: "gpt-4o-mini"
  });
}
var OpenAiCompatibleProvider;
var init_openai = __esm({
  "src/llm/openai.ts"() {
    "use strict";
    init_provider();
    OpenAiCompatibleProvider = class {
      id;
      defaultModel;
      client;
      constructor(opts = {}) {
        this.id = opts.id ?? "openai";
        const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
        if (!apiKey && opts.apiKeyRequired !== false) {
          throw new ProviderUnavailableError(this.id, `${(opts.id ?? "openai").toUpperCase()} API key is not set`);
        }
        this.client = new OpenAI({ apiKey: apiKey ?? "not-required", baseURL: opts.baseUrl });
        this.defaultModel = opts.model && opts.model !== "default" ? opts.model : opts.defaultModel ?? "gpt-4o-mini";
      }
      async chat(messages, opts = {}) {
        const model = opts.model && opts.model !== "default" ? opts.model : this.defaultModel;
        const res = await this.client.chat.completions.create(
          {
            model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: opts.temperature ?? 0,
            max_tokens: opts.maxOutputTokens,
            response_format: opts.json ? { type: "json_object" } : void 0
          },
          { signal: opts.signal }
        );
        return {
          text: (res.choices[0]?.message?.content ?? "").trim(),
          model,
          usage: { inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens }
        };
      }
      async listModels() {
        try {
          const res = await this.client.models.list();
          return res.data.map((m) => m.id).sort();
        } catch {
          return [];
        }
      }
    };
  }
});

// src/llm/openrouter.ts
function createOpenRouterProvider(model) {
  return new OpenAiCompatibleProvider({
    id: "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    model,
    defaultModel: "openrouter/auto"
  });
}
var init_openrouter = __esm({
  "src/llm/openrouter.ts"() {
    "use strict";
    init_openai();
  }
});

// src/llm/ollama.ts
var OllamaProvider;
var init_ollama = __esm({
  "src/llm/ollama.ts"() {
    "use strict";
    init_provider();
    OllamaProvider = class {
      id = "ollama";
      defaultModel;
      baseUrl;
      constructor(opts = {}) {
        this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
        const model = opts.model && opts.model !== "default" ? opts.model : process.env.OLLAMA_MODEL ?? "llama3.1";
        this.defaultModel = model;
      }
      async chat(messages, opts = {}) {
        const model = opts.model && opts.model !== "default" ? opts.model : this.defaultModel;
        let res;
        try {
          res = await fetch(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model,
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
              stream: false,
              format: opts.json ? "json" : void 0,
              options: { temperature: opts.temperature ?? 0, num_predict: opts.maxOutputTokens }
            }),
            signal: opts.signal ?? null
          });
        } catch (e) {
          throw new ProviderUnavailableError("ollama", `cannot reach ${this.baseUrl} (${e.message})`);
        }
        if (!res.ok) throw new ProviderUnavailableError("ollama", `HTTP ${res.status} ${await res.text()}`);
        const body = await res.json();
        return {
          text: (body.message?.content ?? "").trim(),
          model,
          usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count }
        };
      }
      async listModels() {
        try {
          const res = await fetch(`${this.baseUrl}/api/tags`);
          const body = await res.json();
          return (body.models ?? []).map((m) => m.name).sort();
        } catch {
          return [];
        }
      }
    };
  }
});

// src/llm/registry.ts
function resolveProvider(name, cfg) {
  const providerId = cfg?.provider ?? inferProviderId(name);
  const model = cfg?.model;
  switch (providerId) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: envKey(cfg), baseUrl: cfg?.baseUrl, model });
    case "openai":
      return createOpenAiProvider(model);
    case "openrouter":
      return createOpenRouterProvider(model);
    case "ollama":
      return new OllamaProvider({ baseUrl: cfg?.baseUrl, model });
    default:
      throw new RiqsError("PROVIDER", `Unknown LLM provider: ${providerId}`);
  }
}
function inferProviderId(name) {
  const n = name.toLowerCase();
  if (n.includes("claude") || n.includes("anthropic") || n.includes("sonnet") || n.includes("opus")) return "anthropic";
  if (n.includes("openrouter")) return "openrouter";
  if (n.includes("ollama") || n.includes("llama") || n.includes("qwen") || n.includes("mistral")) return "ollama";
  return "openai";
}
function envKey(cfg) {
  return cfg?.apiKeyEnv ? process.env[cfg.apiKeyEnv] : void 0;
}
function resolveNativeProvider(config, override) {
  const key = override ?? config.native.default;
  const named = config.native.providers[key];
  if (named) {
    const provider = resolveProvider(key, named);
    return { provider, providerId: named.provider, model: named.model };
  }
  const candidates = [
    { id: "anthropic", ok: !!process.env.ANTHROPIC_API_KEY },
    { id: "openai", ok: !!process.env.OPENAI_API_KEY },
    { id: "openrouter", ok: !!process.env.OPENROUTER_API_KEY },
    { id: "ollama", ok: !!process.env.OLLAMA_BASE_URL || true }
    // may be running on the default port
  ];
  for (const c of candidates) {
    if (!c.ok) continue;
    try {
      const provider = resolveProvider(c.id, { provider: c.id, model: "default" });
      return { provider, providerId: c.id, model: "default" };
    } catch (e) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
    }
  }
  throw new RiqsError("PROVIDER", "No LLM provider is configured for the native worker", {
    hint: "Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY, or run a local Ollama and set OLLAMA_BASE_URL."
  });
}
var init_registry2 = __esm({
  "src/llm/registry.ts"() {
    "use strict";
    init_provider();
    init_anthropic();
    init_openai();
    init_openrouter();
    init_ollama();
    init_errors();
  }
});

// src/workers/registry.ts
async function buildWorkerRegistry(opts) {
  const { config, workers, agents } = opts;
  const integrations = new IntegrationRegistry();
  await integrations.refresh();
  const manifest = await loadManifest();
  const entries = /* @__PURE__ */ new Map();
  const nativeCfg = workers.workers["native"];
  if (!nativeCfg || nativeCfg.enabled) {
    try {
      const resolved = resolveNativeProvider(config, opts.nativeProviderOverride);
      entries.set("native", {
        id: "native",
        worker: new NativeWorker("native", resolved.provider, resolved.model === "default" ? void 0 : resolved.model),
        roles: nativeCfg?.roles ?? ["planner", "investigator", "backend", "frontend", "coder", "tester", "reviewer", "general"],
        enabled: true,
        ready: true,
        present: true,
        backing: `${resolved.providerId}:${resolved.model}`
      });
    } catch (e) {
      log.warn(`native worker unavailable: ${e.message}`);
      entries.set("native", {
        id: "native",
        worker: new ManualWorker("native"),
        roles: nativeCfg?.roles ?? [],
        enabled: nativeCfg?.enabled ?? true,
        ready: false,
        present: false,
        backing: "unconfigured"
      });
    }
  }
  for (const [id, entry] of Object.entries(manifest.integrations)) {
    const wc = workers.workers[id];
    const status = integrations.get(id);
    const ready = integrations.isReady(id);
    const present = status?.installed === true && status.readiness !== "broken";
    const spec = entry.worker;
    entries.set(id, {
      id,
      worker: new CliWorker({
        id,
        executables: entry.executables,
        promptDelivery: spec.promptDelivery,
        argv: spec.argv,
        useWorktreeCwd: spec.useWorktreeCwd,
        writesResultFile: spec.writesResultFile
      }),
      roles: wc?.roles ?? [],
      enabled: wc?.enabled ?? false,
      ready,
      present,
      backing: `${id}${status?.version ? " " + status.version : ""}`
    });
  }
  for (const [agentId, ac] of Object.entries(agents.agents)) {
    if (!ac.enabled) continue;
    const backingEntry = entries.get(ac.worker);
    let worker;
    let ready = false;
    if (ac.worker === "native") {
      try {
        const explicit = config.native.providers[agentId] ?? config.native.providers[ac.model];
        const p = explicit ? resolveProvider(agentId, explicit) : resolveNativeProvider(config).provider;
        worker = new NativeWorker(agentId, p, ac.model === "default" ? void 0 : ac.model);
        ready = true;
      } catch (e) {
        log.warn(`agent ${agentId} native provider unavailable: ${e.message}`);
        worker = new ManualWorker(agentId);
      }
    } else if (backingEntry) {
      worker = backingEntry.worker;
      ready = backingEntry.ready;
    } else {
      worker = new ManualWorker(agentId);
    }
    entries.set(agentId, { id: agentId, worker, roles: ac.roles, enabled: true, ready, present: ready || !!backingEntry?.present, backing: `${ac.worker}:${ac.model}`, model: ac.model });
  }
  const registry = {
    entries,
    manual: new ManualWorker("manual"),
    list: () => [...entries.values()],
    ready: () => [...entries.values()].filter((e) => e.enabled && e.ready),
    get: (id) => entries.get(id),
    forRole: (role) => [...entries.values()].filter((e) => e.enabled && e.ready && e.roles.includes(role))
  };
  return registry;
}
var init_registry3 = __esm({
  "src/workers/registry.ts"() {
    "use strict";
    init_nativeWorker();
    init_manualWorker();
    init_cliWorker();
    init_registry();
    init_integration();
    init_registry2();
    init_logger();
  }
});

// src/orchestrator/dependencyGraph.ts
var DependencyGraph;
var init_dependencyGraph = __esm({
  "src/orchestrator/dependencyGraph.ts"() {
    "use strict";
    init_errors();
    DependencyGraph = class {
      nodes = /* @__PURE__ */ new Map();
      constructor(nodes) {
        for (const n of nodes) {
          if (this.nodes.has(n.id)) throw new RiqsError("INTERNAL", `Duplicate plan node id: ${n.id}`);
          this.nodes.set(n.id, n);
        }
        for (const n of nodes) {
          for (const dep of n.dependsOn) {
            if (!this.nodes.has(dep)) throw new RiqsError("CONTRACT", `Plan node "${n.id}" depends on unknown node "${dep}"`);
          }
        }
        this.assertAcyclic();
      }
      get size() {
        return this.nodes.size;
      }
      node(id) {
        const n = this.nodes.get(id);
        if (!n) throw new RiqsError("INTERNAL", `Unknown plan node: ${id}`);
        return n;
      }
      all() {
        return [...this.nodes.values()];
      }
      /** Nodes whose dependencies are all in `completed` and which are neither done nor failed. */
      ready(completed, terminal) {
        return this.all().filter(
          (n) => !completed.has(n.id) && !terminal.has(n.id) && n.dependsOn.every((d) => completed.has(d))
        );
      }
      /** A node is blocked when any dependency has failed (and cannot be satisfied). */
      blockedBy(failed) {
        return this.all().filter((n) => n.dependsOn.some((d) => failed.has(d)));
      }
      topologicalOrder() {
        const result = [];
        const done = /* @__PURE__ */ new Set();
        const temp = /* @__PURE__ */ new Set();
        const visit = (id) => {
          if (done.has(id)) return;
          if (temp.has(id)) throw new RiqsError("CONTRACT", `Cycle detected at ${id}`);
          temp.add(id);
          for (const d of this.node(id).dependsOn) visit(d);
          temp.delete(id);
          done.add(id);
          result.push(this.node(id));
        };
        for (const id of this.nodes.keys()) visit(id);
        return result;
      }
      assertAcyclic() {
        this.topologicalOrder();
      }
    };
  }
});

// src/orchestrator/scheduler.ts
var Scheduler;
var init_scheduler = __esm({
  "src/orchestrator/scheduler.ts"() {
    "use strict";
    init_logger();
    init_errors();
    Scheduler = class {
      constructor(graph, assignments) {
        this.graph = graph;
        this.assignments = assignments;
      }
      graph;
      assignments;
      async run(runner, opts) {
        const inFlight = /* @__PURE__ */ new Map();
        const running = /* @__PURE__ */ new Set();
        const conflicts = (id) => opts.mutex.some(([a, b]) => a === id && running.has(b) || b === id && running.has(a));
        while (true) {
          const completed = this.assignments.completed();
          const terminal = this.assignments.terminal();
          const failed = this.assignments.failed();
          for (const node of this.graph.blockedBy(failed)) {
            if (!terminal.has(node.id) && this.assignments.get(node.id) === "PENDING") {
              log.warn(`${node.id}: blocked (upstream failure)`);
              await this.assignments.set(node.id, "BLOCKED");
            }
          }
          if (this.assignments.allSettled(this.graph.size) && inFlight.size === 0) break;
          const abort = opts.signal?.aborted;
          let ready = abort ? [] : this.graph.ready(this.assignments.completed(), this.assignments.terminal());
          ready = ready.filter((n) => this.assignments.get(n.id) === "PENDING" && !running.has(n.id) && !conflicts(n.id));
          while (running.size < opts.parallelism && ready.length > 0) {
            const node = ready.shift();
            if (conflicts(node.id)) continue;
            running.add(node.id);
            void this.assignments.set(node.id, "RUNNING");
            const p = (async () => {
              try {
                const outcome = await runner(node);
                await this.assignments.set(node.id, outcome);
              } catch (e) {
                if (e instanceof CancelledError) {
                  await this.assignments.set(node.id, "CANCELLED");
                } else {
                  log.error(`${node.id} crashed: ${e.message}`);
                  await this.assignments.set(node.id, "FAILED");
                }
              } finally {
                running.delete(node.id);
                inFlight.delete(node.id);
              }
            })();
            inFlight.set(node.id, p);
            ready = ready.filter((n) => !conflicts(n.id));
          }
          if (inFlight.size === 0) {
            if (abort) break;
            if (this.graph.ready(completed, terminal).length === 0) {
              log.warn("scheduler: no runnable nodes remain; stopping");
              break;
            }
            continue;
          }
          await Promise.race(inFlight.values());
        }
        await Promise.allSettled(inFlight.values());
        if (opts.signal?.aborted) throw new CancelledError("Run cancelled");
      }
    };
  }
});

// src/orchestrator/assignmentStore.ts
var AssignmentStore;
var init_assignmentStore = __esm({
  "src/orchestrator/assignmentStore.ts"() {
    "use strict";
    AssignmentStore = class {
      constructor(store) {
        this.store = store;
      }
      store;
      states = /* @__PURE__ */ new Map();
      onChange;
      bindPersist(fn) {
        this.onChange = fn;
      }
      hydrate(states) {
        this.states = new Map(Object.entries(states));
      }
      snapshot() {
        return Object.fromEntries(this.states);
      }
      get(id) {
        return this.states.get(id) ?? "PENDING";
      }
      async set(id, state2) {
        this.states.set(id, state2);
        await this.store.appendAudit({ kind: "assignment.state", id, state: state2 });
        if (this.onChange) await this.onChange();
      }
      completed() {
        return new Set([...this.states].filter(([, s]) => s === "COMPLETED").map(([id]) => id));
      }
      terminal() {
        return new Set([...this.states].filter(([, s]) => s === "COMPLETED" || s === "FAILED" || s === "CANCELLED").map(([id]) => id));
      }
      failed() {
        return new Set([...this.states].filter(([, s]) => s === "FAILED").map(([id]) => id));
      }
      allSettled(total) {
        const settled = [...this.states.values()].filter((s) => s === "COMPLETED" || s === "FAILED" || s === "CANCELLED" || s === "BLOCKED").length;
        return settled >= total;
      }
    };
  }
});

// src/orchestrator/router.ts
var Router;
var init_router = __esm({
  "src/orchestrator/router.ts"() {
    "use strict";
    init_errors();
    init_logger();
    Router = class {
      constructor(config, registry) {
        this.config = config;
        this.registry = registry;
      }
      config;
      registry;
      route(req) {
        const { node } = req;
        const role = node.role;
        const disabled = new Set(req.disabledWorkers ?? []);
        const strict = this.config.routingPolicy === "strict";
        const pick = (ids, reason, explicit = false) => {
          if (!ids) return null;
          const wanted = Array.isArray(ids) ? ids : [ids];
          const resolved = wanted.map((id) => this.registry.get(id)).filter((e) => !!e && !disabled.has(e.id));
          const usable = resolved.filter((e) => e.enabled && (e.ready || explicit && e.present));
          for (const e of usable) {
            if (explicit && !e.ready && e.present) log.warn(`route ${node.id}: using "${e.id}" on your explicit instruction (readiness not verified)`);
          }
          if (usable.length === wanted.length) return { nodeId: node.id, role, workers: usable, reason };
          if (usable.length > 0 && !strict) {
            log.warn(`route ${node.id}: ${wanted.filter((w) => !usable.some((r) => r.id === w)).join(", ")} unavailable; proceeding with ${usable.map((r) => r.id).join(", ")}`);
            return { nodeId: node.id, role, workers: usable, reason: reason + " (partial, fallback)" };
          }
          if (strict) return { nodeId: node.id, role, workers: [], reason, strictUnavailable: wanted.join(", ") };
          return null;
        };
        return pick(node.worker ?? void 0, "explicit plan-node routing", true) ?? pick(req.taskRouting?.[role], "explicit per-task routing", true) ?? pick(this.config.taskDefaults[req.taskCategory]?.[role], `task-type default (${req.taskCategory})`) ?? pick(this.config.routing[role], "global routing map") ?? this.byPreference(node, role, disabled, strict) ?? this.anyReady(node, role, disabled, strict);
      }
      byPreference(node, role, disabled, strict) {
        const order = this.config.preferences[role] ?? (this.config.primaryWorker ? [this.config.primaryWorker] : []);
        for (const id of order) {
          const e = this.registry.get(id);
          if (e && e.enabled && e.ready && !disabled.has(id)) {
            return { nodeId: node.id, role, workers: [e], reason: "global preference order" };
          }
        }
        if (strict && order.length) return { nodeId: node.id, role, workers: [], reason: "global preference order", strictUnavailable: order.join(", ") };
        return null;
      }
      anyReady(node, role, disabled, strict) {
        const candidates = this.registry.forRole(role).filter((e) => !disabled.has(e.id));
        if (candidates.length === 0) {
          const native = this.registry.get("native");
          if (native && native.enabled && native.ready && !disabled.has("native")) {
            return { nodeId: node.id, role, workers: [native], reason: "single-tool fallback \u2192 native" };
          }
          if (strict) throw new RiqsError("WORKER", `No ready worker for role "${role}" and routing policy is strict`);
          return { nodeId: node.id, role, workers: [], reason: "no ready worker \u2192 manual handoff", strictUnavailable: role };
        }
        const primary = this.config.primaryWorker ? candidates.find((c) => c.id === this.config.primaryWorker) : void 0;
        return { nodeId: node.id, role, workers: [primary ?? candidates[0]], reason: "first ready worker for role" };
      }
    };
  }
});

// src/riqs/workflows.ts
import { promises as fs19 } from "fs";
import { parse as parseYaml } from "yaml";
import { z as z4 } from "zod";
function normalizeStep(raw, deps) {
  if (typeof raw === "string") {
    return {
      id: raw,
      role: ROLE_GUESS[raw] ?? "investigator",
      readOnly: true,
      optional: false,
      skills: [],
      allowedPaths: ["**"],
      dependsOn: deps
    };
  }
  return {
    id: raw.id,
    role: raw.role,
    objective: raw.objective,
    readOnly: raw.readOnly ?? true,
    optional: raw.optional ?? false,
    skills: raw.skills ?? [],
    allowedPaths: raw.allowedPaths ?? ["**"],
    dependsOn: deps
  };
}
function normalizePreset(preset) {
  const parallel = preset.parallel.map((s) => normalizeStep(s, []));
  const parallelIds = parallel.map((s) => s.id);
  const after = [];
  const WRITER_ROLES = /* @__PURE__ */ new Set(["coder", "release", "tester"]);
  let priorIds = [...parallelIds];
  for (const raw of preset.after) {
    const step = normalizeStep(raw, [...priorIds]);
    const explicitReadOnly = typeof raw === "object" && raw.readOnly !== void 0;
    if (WRITER_ROLES.has(step.role) && !explicitReadOnly) step.readOnly = false;
    after.push(step);
    priorIds = [step.id];
  }
  return [...parallel, ...after];
}
async function loadPreset(paths, name) {
  const file = paths.workflowFile(name);
  let raw;
  try {
    raw = await fs19.readFile(file, "utf8");
  } catch {
    throw new RiqsError("CONFIG", `Workflow preset not found: ${name}`, { hint: `Looked in ${paths.workflowsDir()}` });
  }
  return parseOrThrow(WorkflowPresetSchema, parseYaml(raw), `workflow ${name}`);
}
async function listPresets(paths) {
  const files = await fs19.readdir(paths.workflowsDir()).catch(() => []);
  return files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).map((f) => f.replace(/\.ya?ml$/, "")).sort();
}
var StepSchema, StepInput, WorkflowPresetSchema, ROLE_GUESS;
var init_workflows = __esm({
  "src/riqs/workflows.ts"() {
    "use strict";
    init_contracts();
    init_errors();
    StepSchema = z4.object({
      id: z4.string().min(1),
      role: RoleSchema,
      objective: z4.string().optional(),
      readOnly: z4.boolean().optional(),
      optional: z4.boolean().optional(),
      skills: z4.array(z4.string()).optional(),
      allowedPaths: z4.array(z4.string()).optional()
    });
    StepInput = z4.union([z4.string(), StepSchema]);
    WorkflowPresetSchema = z4.object({
      name: z4.string().min(1),
      description: z4.string().optional(),
      mode: z4.enum(["auto", "parallel", "sequential", "single-worker", "manual"]).optional(),
      parallel: z4.array(StepInput).default([]),
      after: z4.array(StepInput).default([])
    });
    ROLE_GUESS = {
      "api-authorization": "permission",
      "artifact-permissions": "permission",
      "dynamic-role-resolution": "permission",
      "frontend-visibility": "frontend",
      "root-cause-merge": "investigator",
      implementation: "coder",
      "targeted-tests": "tester",
      "security-review": "security"
    };
  }
});

// src/orchestrator/planner.ts
async function buildPlan(input, ctx) {
  if (input.workflow) {
    const preset = await loadPreset(ctx.paths, input.workflow);
    const steps = normalizePreset(preset);
    const nodes = steps.filter((s) => !input.skip.includes(s.id) && !input.skip.includes(s.role)).map((s) => ({
      id: s.id,
      role: s.role,
      objective: s.objective ?? `${s.role}: ${input.objective}`,
      dependsOn: s.dependsOn.filter((d) => !input.skip.includes(d)),
      readOnly: s.readOnly,
      allowedPaths: s.allowedPaths,
      skills: s.skills,
      worker: null,
      optional: s.optional
    }));
    return finalizePlan(input, nodes, preset.mode ?? input.mode, "preset");
  }
  const native = await tryNativePlan(input, ctx.config).catch((e) => {
    log.debug(`native planner unavailable: ${e.message}`);
    return null;
  });
  if (native) return native;
  return finalizePlan(input, genericNodes(input), input.mode, "manual");
}
function genericNodes(input) {
  const investigate = {
    id: "investigate",
    role: "investigator",
    objective: `Investigate: ${input.objective}`,
    dependsOn: [],
    readOnly: true,
    allowedPaths: ["**"],
    skills: [],
    worker: null,
    optional: false
  };
  const nodes = [investigate];
  if (!input.skip.includes("coder") && !input.skip.includes("implementation")) {
    nodes.push({
      id: "implement",
      role: "coder",
      objective: `Implement the fix for: ${input.objective}`,
      dependsOn: ["investigate"],
      readOnly: false,
      allowedPaths: ["**"],
      skills: [],
      worker: null,
      optional: false
    });
  }
  const impl = nodes.find((n) => n.id === "implement") ? ["implement"] : ["investigate"];
  if (!input.skip.includes("tester") && !input.skip.includes("tests")) {
    nodes.push({ id: "test", role: "tester", objective: "Run and extend targeted tests", dependsOn: impl, readOnly: false, allowedPaths: ["**"], skills: [], worker: null, optional: true });
  }
  if (!input.skip.includes("reviewer")) {
    nodes.push({ id: "review", role: "reviewer", objective: "Review the change", dependsOn: impl, readOnly: true, allowedPaths: ["**"], skills: [], worker: null, optional: true });
  }
  return nodes;
}
async function tryNativePlan(input, config) {
  const { provider } = resolveNativeProvider(config);
  const sys = 'You are the gR DEV AGENT planner. Output ONLY a JSON object: { "parallelizable": boolean, "nodes": [ { "id": string, "role": <one of planner|investigator|backend|frontend|database|permission|security|performance|coder|tester|reviewer|regression|documentation|git|release|general>, "objective": string, "dependsOn": string[], "readOnly": boolean, "allowedPaths": string[] } ] }. Independent investigations must have dependsOn: []. Writers depend on all investigations. Keep it to 3-6 nodes.';
  const res = await provider.chat(
    [
      { role: "system", content: sys },
      { role: "user", content: `Task: ${input.objective}
Category: ${input.category}
Skipped phases: ${input.skip.join(", ") || "none"}` }
    ],
    { json: true, maxOutputTokens: 1500 }
  );
  const parsed = safeJson(res.text);
  if (!parsed || !Array.isArray(parsed.nodes)) return null;
  const nodes = parsed.nodes.map((n) => ({
    id: String(n.id),
    role: n.role ?? "investigator",
    objective: String(n.objective ?? input.objective),
    dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn.map(String) : [],
    readOnly: n.readOnly !== false,
    allowedPaths: Array.isArray(n.allowedPaths) && n.allowedPaths.length ? n.allowedPaths.map(String) : ["**"],
    skills: [],
    worker: null,
    optional: false
  })).filter((n) => !input.skip.includes(n.id) && !input.skip.includes(n.role));
  if (nodes.length === 0) return null;
  return finalizePlan(input, nodes, input.mode, "native-planner");
}
function finalizePlan(input, nodes, mode, source) {
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) n.dependsOn = n.dependsOn.filter((d) => ids.has(d));
  return PlanSchema.parse({
    taskId: input.taskId,
    parallelizable: nodes.filter((n) => n.dependsOn.length === 0).length > 1,
    mode,
    nodes,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    source
  });
}
function safeJson(text3) {
  const s = text3.indexOf("{");
  const e = text3.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text3.slice(s, e + 1));
  } catch {
    return null;
  }
}
var init_planner = __esm({
  "src/orchestrator/planner.ts"() {
    "use strict";
    init_contracts();
    init_workflows();
    init_registry2();
    init_logger();
  }
});

// src/orchestrator/resultMerger.ts
function mergeResults(results) {
  const groups = /* @__PURE__ */ new Map();
  for (const r of results) {
    for (const f of r.findings) {
      const key = normKey(f.subsystem, f.summary);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ finding: f, worker: r.worker });
    }
  }
  const merged = [];
  const contradictions = [];
  for (const items of groups.values()) {
    const workers = [...new Set(items.map((i) => i.worker))];
    const avgConf = items.reduce((s, i) => s + i.finding.confidence, 0) / items.length;
    const agreement = workers.length;
    const score = avgConf * (1 + 0.35 * (agreement - 1));
    const first = items[0].finding;
    const negative = NEGATION.test(first.summary) || first.kind === "recommendation";
    merged.push({
      subsystem: first.subsystem,
      summary: first.summary,
      classification: classify(score, agreement, negative),
      score: round(score),
      supportingWorkers: workers,
      files: [...new Set(items.flatMap((i) => i.finding.files))],
      kinds: [...new Set(items.map((i) => i.finding.kind))]
    });
  }
  const bySubsystem = /* @__PURE__ */ new Map();
  for (const r of results) {
    for (const f of r.findings) {
      if (!bySubsystem.has(f.subsystem)) bySubsystem.set(f.subsystem, []);
      bySubsystem.get(f.subsystem).push({ worker: r.worker, summary: f.summary, negative: NEGATION.test(f.summary) });
    }
  }
  for (const [subsystem, items] of bySubsystem) {
    const pos = items.find((i) => !i.negative);
    const neg = items.find((i) => i.negative && i.worker !== pos?.worker);
    if (pos && neg) {
      contradictions.push({ subsystem, a: { worker: pos.worker, summary: pos.summary }, b: { worker: neg.worker, summary: neg.summary } });
    }
  }
  const hypMap = /* @__PURE__ */ new Map();
  for (const r of results) for (const h of r.rootCauseHypotheses) {
    const k = h.trim().toLowerCase();
    if (!hypMap.has(k)) hypMap.set(k, /* @__PURE__ */ new Set());
    hypMap.get(k).add(r.worker);
  }
  const recMap = /* @__PURE__ */ new Map();
  for (const r of results) for (const c of r.recommendedChanges) {
    const k = c.file;
    if (!recMap.has(k)) recMap.set(k, { summary: c.summary, workers: /* @__PURE__ */ new Set() });
    recMap.get(k).workers.add(r.worker);
  }
  merged.sort((a, b) => b.score - a.score);
  return {
    confirmed: merged.filter((m) => m.classification === "CONFIRMED"),
    supported: merged.filter((m) => m.classification === "SUPPORTED"),
    suspected: merged.filter((m) => m.classification === "SUSPECTED"),
    notRootCause: merged.filter((m) => m.classification === "NOT ROOT CAUSE"),
    rootCauseHypotheses: [...hypMap].map(([text3, workers]) => ({ text: text3, workers: [...workers] })),
    recommendedChanges: [...recMap].map(([file, v]) => ({ file, summary: v.summary, workers: [...v.workers] })),
    risks: [...new Set(results.flatMap((r) => r.risks))],
    contradictions
  };
}
function classify(score, agreement, negative) {
  if (negative) return "NOT ROOT CAUSE";
  if (score >= 0.8 && agreement >= 2) return "CONFIRMED";
  if (score >= 0.8 || agreement >= 2) return "SUPPORTED";
  return "SUSPECTED";
}
function normKey(subsystem, summary) {
  return `${subsystem}::${summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;
}
function round(n) {
  return Math.round(n * 100) / 100;
}
var NEGATION;
var init_resultMerger = __esm({
  "src/orchestrator/resultMerger.ts"() {
    "use strict";
    NEGATION = /\b(no|not|isn'?t|does not|doesn'?t|cannot|can'?t|ruled out|unrelated|independent)\b/i;
  }
});

// src/orchestrator/conflictDetector.ts
import path19 from "path";
function detectFileConflicts(nodes) {
  const writers = nodes.filter((n) => !n.readOnly);
  const conflicts = [];
  for (let i = 0; i < writers.length; i++) {
    for (let j = i + 1; j < writers.length; j++) {
      const a = writers[i];
      const b = writers[j];
      if (dependencyOrdered(a, b, nodes)) continue;
      const overlap = globOverlap(a.allowedPaths, b.allowedPaths);
      if (overlap.length) conflicts.push({ a: a.id, b: b.id, overlap });
    }
  }
  return conflicts;
}
function needsTieBreak(model) {
  return model.contradictions.length > 0;
}
function tieBreakNode(model, dependsOn) {
  const subs = model.contradictions.map((c) => c.subsystem).join(", ");
  return {
    id: "tie-break",
    role: "reviewer",
    objective: `Investigators disagree about: ${subs}. Compare each claim against the actual call chain and the shared evidence, then state which finding the code supports and why.`,
    dependsOn,
    readOnly: true,
    allowedPaths: ["**"],
    skills: [],
    worker: null,
    optional: false
  };
}
function dependencyOrdered(a, b, nodes) {
  const reaches = (from, to) => {
    const seen = /* @__PURE__ */ new Set();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const node = nodes.find((n) => n.id === cur);
      stack.push(...node?.dependsOn ?? []);
    }
    return false;
  };
  return reaches(a.id, b.id) || reaches(b.id, a.id);
}
function globOverlap(a, b) {
  if (a.includes("**") || b.includes("**")) return ["**"];
  const norm = (g) => path19.posix.normalize(g.replace(/\\/g, "/")).replace(/\/?\*\*.*$/, "").replace(/\/?\*.*$/, "");
  const aPrefixes = a.map(norm);
  const bPrefixes = b.map(norm);
  const overlap = [];
  for (const ap of aPrefixes) {
    for (const bp of bPrefixes) {
      if (ap === bp || ap.startsWith(bp + "/") || bp.startsWith(ap + "/") || ap === "" || bp === "") overlap.push(ap || bp || "**");
    }
  }
  return [...new Set(overlap)];
}
var init_conflictDetector = __esm({
  "src/orchestrator/conflictDetector.ts"() {
    "use strict";
  }
});

// src/orchestrator/checkpoint.ts
async function persistCheckpoint(store, input) {
  const completedResults = (await store.listResults()).map((r) => r.id);
  const cp = {
    taskId: input.task.taskId,
    phase: input.phase,
    savedAt: (/* @__PURE__ */ new Date()).toISOString(),
    task: input.task,
    plan: input.plan,
    assignmentStates: input.assignments.snapshot(),
    completedResults,
    modifiedFiles: input.modifiedFiles ?? [],
    worktrees: input.worktrees ?? [],
    testStatus: input.testStatus ?? "unknown",
    reason: input.reason
  };
  await store.writeCheckpoint(cp);
  return cp;
}
var init_checkpoint = __esm({
  "src/orchestrator/checkpoint.ts"() {
    "use strict";
  }
});

// src/orchestrator/report.ts
function renderReport(input) {
  const L = [];
  const h = (s) => L.push(`
## ${s}
`);
  L.push(`# gR DEV AGENT report \u2014 ${input.task.taskId}`);
  L.push(`
_${(/* @__PURE__ */ new Date()).toISOString()}_`);
  h("Task");
  L.push(input.task.objective);
  if (input.task.acceptanceCriteria.length) {
    L.push("\nAcceptance criteria:");
    for (const c of input.task.acceptanceCriteria) L.push(`- ${c}`);
  }
  h("Root cause");
  if (input.model.confirmed.length) {
    for (const m of input.model.confirmed) L.push(`- **CONFIRMED** (${m.subsystem}, score ${m.score}, ${m.supportingWorkers.join("+")}): ${m.summary}`);
  } else {
    L.push("_No finding reached CONFIRMED. Best current model:_");
    for (const m of [...input.model.supported, ...input.model.suspected].slice(0, 5)) {
      L.push(`- ${m.classification} (${m.subsystem}, score ${m.score}): ${m.summary}`);
    }
  }
  for (const m of input.model.notRootCause) L.push(`- NOT ROOT CAUSE (${m.subsystem}): ${m.summary}`);
  if (input.model.contradictions.length) {
    L.push("\nUnresolved contradictions:");
    for (const c of input.model.contradictions) L.push(`- ${c.subsystem}: ${c.a.worker} says "${c.a.summary}" vs ${c.b.worker} says "${c.b.summary}"`);
  }
  h("Evidence");
  const files = [...new Set(input.results.flatMap((r) => r.filesInspected))].slice(0, 40);
  L.push(files.length ? files.map((f) => `- ${f}`).join("\n") : "_none recorded_");
  h("Changes");
  if (input.model.recommendedChanges.length) {
    for (const c of input.model.recommendedChanges) L.push(`- ${c.file} \u2014 ${c.summary} (${c.workers.join(", ")})`);
  } else {
    L.push("_No code changes were made._");
  }
  if (input.diff && input.diff.trim()) {
    L.push("\n```diff");
    L.push(input.diff.slice(0, 12e3));
    L.push("```");
  }
  h("Tests");
  L.push(input.validation.tests);
  h("Review");
  L.push(input.validation.review);
  h("Regression risks");
  L.push(input.model.risks.length ? input.model.risks.map((r) => `- ${r}`).join("\n") : "_none identified_");
  h("Unresolved issues");
  L.push(input.unresolved.length ? input.unresolved.map((u) => `- ${u}`).join("\n") : "_none_");
  h("Workflow used");
  for (const a of input.attribution) L.push(`- ${a.nodeId} (${a.role}) \u2192 ${a.workers.join(", ") || "manual handoff"}`);
  if (input.skipped.length) L.push(`
Skipped: ${input.skipped.join(", ")}`);
  if (input.validation.tests.includes("SKIPPED") || input.validation.review.includes("SKIPPED")) {
    L.push("\n> **VALIDATION SKIPPED** \u2014 one or more recommended checks were skipped by user request.");
  }
  h("Suggested commit message");
  L.push("```");
  L.push(suggestedCommit(input));
  L.push("```");
  return L.join("\n") + "\n";
}
function suggestedCommit(input) {
  const top = input.model.confirmed[0] ?? input.model.supported[0];
  const scope = top?.subsystem && top.subsystem !== "unknown" ? `(${top.subsystem})` : "";
  const subject = `fix${scope}: ${input.task.objective}`.slice(0, 72);
  const body = [
    "",
    top ? `Root cause: ${top.summary}` : "",
    ...input.model.recommendedChanges.map((c) => `- ${c.file}: ${c.summary}`)
  ].filter(Boolean);
  return [subject, ...body].join("\n");
}
var init_report = __esm({
  "src/orchestrator/report.ts"() {
    "use strict";
  }
});

// src/orchestrator/orchestrator.ts
import { promises as fs20 } from "fs";
import path20 from "path";
import { randomUUID } from "crypto";
function shortId() {
  return randomUUID().slice(0, 8);
}
function logWorkerTable(registry) {
  for (const e of registry.list()) {
    const flag = !e.enabled ? "disabled" : e.ready ? "ready" : "not ready";
    log.info(`  worker ${e.id.padEnd(14)} ${flag.padEnd(10)} ${e.backing}`);
  }
}
var Orchestrator;
var init_orchestrator = __esm({
  "src/orchestrator/orchestrator.ts"() {
    "use strict";
    init_contracts();
    init_store();
    init_paths2();
    init_workspaceGuard();
    init_git();
    init_locks();
    init_memory();
    init_skills();
    init_promptEnvelope();
    init_registry3();
    init_dependencyGraph();
    init_scheduler();
    init_assignmentStore();
    init_router();
    init_planner();
    init_resultMerger();
    init_conflictDetector();
    init_checkpoint();
    init_report();
    init_logger();
    init_roleVerb();
    init_errors();
    Orchestrator = class {
      constructor(deps) {
        this.deps = deps;
        this.paths = new RiqsPaths(deps.workspaceRoot);
        this.store = new RiqsStore(deps.workspaceRoot);
        this.locks = new LockManager(this.paths);
      }
      deps;
      store;
      paths;
      locks;
      guard;
      registry;
      router;
      assignments;
      git = null;
      attribution = [];
      worktrees = [];
      async run(input) {
        await this.store.ensureRunDirs();
        this.guard = await WorkspaceGuard.create(this.deps.workspaceRoot);
        this.git = await Git.open(this.deps.workspaceRoot);
        const mode = input.mode ?? this.deps.config.mode;
        const parallelism = mode === "sequential" || mode === "single-worker" || mode === "manual" ? 1 : input.parallelism ?? this.deps.config.parallelism;
        const skip = [.../* @__PURE__ */ new Set([...this.deps.config.skip ?? [], ...input.skip ?? []])];
        let task = input.resumeTaskId ? await this.store.readTask() : null;
        const resumeCp = input.resumeTaskId ? await this.store.readCheckpoint(input.resumeTaskId) : null;
        if (!task || task.taskId !== input.resumeTaskId) {
          task = TaskSchema.parse({
            taskId: input.resumeTaskId ?? shortId(),
            objective: input.objective,
            category: input.category ?? "general",
            workflow: input.workflow,
            state: "CREATED",
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            skipped: skip,
            acceptanceCriteria: input.acceptanceCriteria ?? []
          });
        }
        await this.store.writeTask({ ...task, state: "PLANNING" });
        let plan = resumeCp?.plan ?? await this.store.readPlan().then((p) => p && p.taskId === task.taskId ? p : null) ?? await buildPlan(
          { taskId: task.taskId, objective: task.objective, category: task.category, workflow: input.workflow, mode, skip },
          { paths: this.paths, config: this.deps.config }
        );
        await this.store.writePlan(plan);
        log.step(`Plan (${plan.source}): ${plan.nodes.map((n) => `${n.id}[${n.role}]`).join(" \u2192 ")}`);
        this.registry = await buildWorkerRegistry({
          config: this.deps.config,
          workers: this.deps.workers,
          agents: this.deps.agents,
          nativeProviderOverride: input.nativeProviderOverride
        });
        this.router = new Router(this.deps.config, this.registry);
        logWorkerTable(this.registry);
        this.assignments = new AssignmentStore(this.store);
        let persistChain = Promise.resolve();
        this.assignments.bindPersist(async () => {
          persistChain = persistChain.catch(() => {
          }).then(
            () => persistCheckpoint(this.store, {
              phase: "running",
              task,
              plan,
              assignments: this.assignments,
              worktrees: this.worktrees
            })
          );
          await persistChain;
        });
        if (resumeCp) {
          this.assignments.hydrate(resumeCp.assignmentStates);
          this.worktrees = resumeCp.worktrees;
          log.info(`Resuming ${task.taskId} from phase "${resumeCp.phase}"`);
        }
        await this.store.writeTask({ ...task, state: "RUNNING" });
        await this.executeGraph(plan, task, parallelism, mode, input, skip);
        await this.store.writeTask({ ...task, state: "MERGING" });
        let results = await this.store.listResults();
        let model = mergeResults(results);
        if (needsTieBreak(model) && !plan.nodes.some((n) => n.id === "tie-break")) {
          log.warn("Contradictory findings \u2014 running a tie-break assignment");
          const tb = tieBreakNode(model, plan.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.id));
          plan = { ...plan, nodes: [...plan.nodes, tb] };
          await this.store.writePlan(plan);
          await this.runSingleNode(tb, task, mode, input);
          results = await this.store.listResults();
          model = mergeResults(results);
        }
        const finalState = this.assignments.failed().size > 0 ? "FAILED" : "COMPLETED";
        const finalTask = { ...task, state: finalState };
        await this.store.writeTask(finalTask);
        const reportPath = await this.finalReport(finalTask, plan, results, model, skip);
        await persistCheckpoint(this.store, { phase: "completed", task: finalTask, plan, assignments: this.assignments, worktrees: this.worktrees, reason: finalState });
        if (this.deps.signal?.aborted) throw new CancelledError();
        return { task: finalTask, reportPath, model };
      }
      async executeGraph(plan, task, parallelism, mode, input, skip) {
        const graph = new DependencyGraph(plan.nodes);
        const fileConflicts = detectFileConflicts(plan.nodes);
        const mutex = fileConflicts.map((c) => [c.a, c.b]);
        if (mutex.length) log.warn(`Serialising writer pairs with overlapping paths: ${mutex.map((m) => m.join("\u2194")).join(", ")}`);
        const scheduler = new Scheduler(graph, this.assignments);
        await scheduler.run(
          async (node) => {
            if (skip.includes(node.id) || skip.includes(node.role)) {
              log.info(`skip ${node.id} (${node.role})`);
              return "COMPLETED";
            }
            return this.runNode(node, task, mode, input);
          },
          { parallelism, mutex, signal: this.deps.signal }
        );
      }
      async runSingleNode(node, task, mode, input) {
        await this.assignments.set(node.id, "RUNNING");
        const outcome = await this.runNode(node, task, mode, input).catch((e) => {
          if (e instanceof CancelledError) throw e;
          log.error(`${node.id}: ${e.message}`);
          return "FAILED";
        });
        await this.assignments.set(node.id, outcome);
      }
      async runNode(node, task, mode, input) {
        const manualEntry = {
          id: "manual",
          worker: this.registry.manual,
          roles: [],
          enabled: true,
          ready: true,
          present: true,
          backing: "manual"
        };
        let decision = this.router.route({
          node,
          taskCategory: task.category,
          taskRouting: input.taskRouting,
          disabledWorkers: input.disabledWorkers
        });
        if (mode === "manual") {
          decision = { nodeId: node.id, role: node.role, workers: [manualEntry], reason: "manual mode" };
        } else if (mode === "single-worker") {
          const id = (typeof input.taskRouting?.[node.role] === "string" ? input.taskRouting[node.role] : void 0) ?? this.deps.config.primaryWorker ?? "native";
          const e = this.registry.get(id);
          if (!e || !e.enabled || !(e.ready || e.present)) {
            log.error(`${node.id}: single-worker "${id}" is not available`);
            return "FAILED";
          }
          decision = { nodeId: node.id, role: node.role, workers: [e], reason: `single-worker (${id})` };
        }
        if (decision.strictUnavailable) {
          log.error(`${node.id}: strict routing \u2014 required worker(s) unavailable: ${decision.strictUnavailable}`);
          return "FAILED";
        }
        const chosen = decision.workers.length ? decision.workers : [manualEntry];
        this.attribution.push({ nodeId: node.id, role: node.role, workers: chosen.map((c) => c.id) });
        log.step(`${roleVerb(node.role)}\u2026`);
        log.debug(`${node.id} (${node.role}) \u2192 ${chosen.map((c) => c.id).join(" + ")}  [${decision.reason}]`);
        const isWriter = !node.readOnly && node.role !== "reviewer";
        const worktree = isWriter && (input.isolateWrites ?? true) ? await this.ensureWorktree(node) : void 0;
        const memory = await loadMemoryText(this.paths).catch(() => "");
        const skills = await skillText(this.paths, node.skills).catch(() => "");
        const evidence = (await this.store.listEvidence()).slice(0, 20).map((e) => `- [${e.id}] ${e.file}${e.lines ? ":" + e.lines : ""} \u2014 ${e.claim} (${e.sourceAgent})`).join("\n");
        const outcomes = [];
        for (const entry of chosen) {
          const ensembleSuffix = chosen.length > 1 ? `__${entry.id}` : "";
          const assignment = {
            taskId: task.taskId,
            id: node.id + ensembleSuffix,
            role: node.role,
            objective: node.objective,
            workspace: ".",
            allowedPaths: node.allowedPaths,
            readOnly: node.readOnly,
            dependencies: node.dependsOn,
            outputFile: this.paths.resultFile(node.id + ensembleSuffix),
            skills: node.skills,
            context: {},
            worktree
          };
          await this.store.writeAssignment(assignment);
          const prompt = buildPromptEnvelope(assignment, { memory, skills, evidence, workspaceRoot: this.deps.workspaceRoot });
          const guard = worktree ? await WorkspaceGuard.create(worktree) : this.guard;
          const ctx = {
            workspaceRoot: this.deps.workspaceRoot,
            guard,
            store: this.store,
            paths: this.paths,
            cwd: worktree ?? this.deps.workspaceRoot,
            signal: this.deps.signal,
            nonInteractive: this.deps.nonInteractive || mode === "manual",
            prompt,
            model: entry.model
          };
          const lockKey = isWriter ? `writer:${node.allowedPaths.join("|")}` : `read:${node.id}`;
          const result = await this.locks.withLock(lockKey, `${node.id}:${entry.id}`, () => entry.worker.execute(assignment, ctx));
          await this.store.writeResult(result);
          await this.recordEvidence(result);
          outcomes.push(result.status === "failed" ? "FAILED" : "COMPLETED");
          log.success(`${assignment.id}: ${result.status} (confidence ${result.confidence})`);
        }
        return outcomes.every((o) => o === "COMPLETED") ? "COMPLETED" : outcomes.includes("COMPLETED") ? "COMPLETED" : "FAILED";
      }
      async ensureWorktree(node) {
        if (!this.git) {
          log.warn(`${node.id}: git unavailable \u2014 writer will operate on the main working tree`);
          return void 0;
        }
        const existing = this.worktrees.find((w) => w.role === node.id);
        if (existing) return existing.path;
        const dir = this.paths.worktreeDir(node.id);
        const branch = `riqs/${node.id}-${shortId()}`;
        try {
          await fs20.mkdir(this.paths.worktreesDir(), { recursive: true });
          await this.git.worktreeAdd(dir, branch);
          this.worktrees.push({ role: node.id, path: dir, branch });
          log.info(`  worktree: ${path20.relative(this.deps.workspaceRoot, dir)} (${branch})`);
          return dir;
        } catch (e) {
          log.warn(`${node.id}: could not create worktree (${e.message}) \u2014 using main tree`);
          return void 0;
        }
      }
      async recordEvidence(result) {
        for (const f of result.findings.slice(0, 10)) {
          if (f.kind !== "fact" || f.files.length === 0) continue;
          await this.store.addEvidence({
            id: `EV-${shortId()}`,
            file: f.files[0],
            claim: f.summary,
            sourceAgent: result.worker,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
      async finalReport(task, plan, results, model, skip) {
        let diff = "";
        if (this.git) diff = await this.git.diff().catch(() => "");
        const testsRun = results.some((r) => r.role === "tester");
        const reviewRun = results.some((r) => r.role === "reviewer");
        const report = renderReport({
          task,
          plan,
          results,
          model,
          attribution: this.attribution,
          validation: {
            tests: skip.includes("tester") || skip.includes("tests") ? "SKIPPED by user" : testsRun ? "tester assignment completed" : "no tester assignment in plan",
            review: skip.includes("reviewer") ? "SKIPPED by user" : reviewRun ? "reviewer assignment completed" : "no reviewer assignment in plan"
          },
          diff,
          unresolved: model.contradictions.map((c) => `${c.subsystem}: unresolved disagreement`),
          skipped: skip
        });
        const file = await this.store.writeReport(task.taskId, report);
        log.success(`Report: ${path20.relative(this.deps.workspaceRoot, file)}`);
        return file;
      }
    };
  }
});

// src/cli/attachments.ts
import { promises as fs21 } from "fs";
import path21 from "path";
import os2 from "os";
import { PDFParse } from "pdf-parse";
function expandHome(p) {
  return p.startsWith("~") ? path21.join(os2.homedir(), p.slice(1)) : p;
}
function findAttachmentRefs(input) {
  const matches = input.match(/@(\S+)/g) ?? [];
  const trimmed = matches.map((m) => m.replace(/[.,;:!?)\]}'"]+$/, ""));
  return [...new Set(trimmed)];
}
async function readAttachment(ref, root) {
  const rawPath = ref.slice(1);
  const resolved = path21.isAbsolute(rawPath) || rawPath.startsWith("~") ? expandHome(rawPath) : path21.resolve(root, rawPath);
  try {
    const stat = await fs21.stat(resolved);
    if (!stat.isFile()) return { ref, path: resolved, ok: false, error: "not a file" };
    if (stat.size > MAX_ATTACHMENT_BYTES) return { ref, path: resolved, ok: false, error: "too large to read (over 25MB)" };
    if (path21.extname(resolved).toLowerCase() === ".pdf") {
      const buf = await fs21.readFile(resolved);
      const parser = new PDFParse({ data: buf });
      const result = await parser.getText();
      return { ref, path: resolved, ok: true, text: result.text.slice(0, MAX_ATTACHMENT_CHARS) };
    }
    const raw = await fs21.readFile(resolved, "utf8");
    return { ref, path: resolved, ok: true, text: raw.slice(0, MAX_ATTACHMENT_CHARS) };
  } catch (e) {
    return { ref, path: resolved, ok: false, error: e.message };
  }
}
async function expandAttachments(input, root) {
  const refs = findAttachmentRefs(input);
  if (refs.length === 0) return { text: input, notes: [] };
  let text3 = input;
  const notes = [];
  for (const ref of refs) {
    const result = await readAttachment(ref, root);
    const replacement = result.ok ? `

--- Attached file: ${result.path} ---
${result.text}
--- end of ${path21.basename(result.path)} ---
` : `

[Could not attach ${ref}: ${result.error}]
`;
    text3 = text3.split(ref).join(replacement);
    notes.push(result.ok ? `Attached ${path21.basename(result.path)} (${result.text.length} chars).` : `Couldn't attach ${ref}: ${result.error}`);
  }
  return { text: text3, notes };
}
var MAX_ATTACHMENT_CHARS, MAX_ATTACHMENT_BYTES;
var init_attachments = __esm({
  "src/cli/attachments.ts"() {
    "use strict";
    MAX_ATTACHMENT_CHARS = 2e4;
    MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
  }
});

// src/cli/stackDetect.ts
import { promises as fs22 } from "fs";
import path22 from "path";
async function detectWorkspaceState(root) {
  const candidates = [root];
  const entries = await fs22.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) candidates.push(path22.join(root, e.name));
  }
  for (const dir of candidates) {
    if (await isDir(path22.join(dir, ".git"))) {
      return { hasRepo: true, repoRoot: dir, stack: await guessStack(dir) };
    }
  }
  return { hasRepo: false, repoRoot: null, stack: "unknown" };
}
async function guessStack(dir) {
  const entries = await fs22.readdir(dir).catch(() => []);
  const has = (name) => entries.includes(name);
  if (entries.some((f) => f.endsWith(".sln") || f.endsWith(".csproj"))) return "backend";
  if (FRONTEND_FILES.some(has)) return "frontend";
  if (BACKEND_FILES.some(has)) return "backend";
  if (has("package.json")) {
    const pkgHint = await guessFromPackageJson(path22.join(dir, "package.json"));
    if (pkgHint !== "unknown") return pkgHint;
  }
  return "unknown";
}
async function guessFromPackageJson(file) {
  try {
    const pkg = JSON.parse(await fs22.readFile(file, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (FRONTEND_DEPS.some((d) => d in deps)) return "frontend";
    if (BACKEND_DEPS.some((d) => d in deps)) return "backend";
  } catch {
  }
  return "unknown";
}
async function isDir(p) {
  return fs22.stat(p).then((s) => s.isDirectory()).catch(() => false);
}
var IGNORED_DIRS, BACKEND_FILES, FRONTEND_FILES, FRONTEND_DEPS, BACKEND_DEPS;
var init_stackDetect = __esm({
  "src/cli/stackDetect.ts"() {
    "use strict";
    IGNORED_DIRS = /* @__PURE__ */ new Set([".git", ".gr-agent", ".riqs-agent", "node_modules", ".worktrees", ".cursor", ".opencode"]);
    BACKEND_FILES = ["go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "requirements.txt", "Pipfile", "pyproject.toml", "manage.py", "composer.json", "Gemfile"];
    FRONTEND_FILES = ["angular.json", "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs", "next.config.ts", "svelte.config.js", "nuxt.config.ts", "index.html"];
    FRONTEND_DEPS = ["react", "react-dom", "vue", "@angular/core", "svelte", "next", "vite", "@vitejs/plugin-react"];
    BACKEND_DEPS = ["express", "fastify", "koa", "@nestjs/core", "hapi", "restify"];
  }
});

// src/ui/prompt.ts
import * as clack from "@clack/prompts";
function interactive() {
  return !Platform.isNonInteractive();
}
async function confirm2(message, initial = false) {
  if (!interactive()) return false;
  const r = await clack.confirm({ message, initialValue: initial });
  if (clack.isCancel(r)) return false;
  return r;
}
async function text2(message, placeholder) {
  if (!interactive()) return null;
  const r = await clack.text({ message, placeholder });
  if (clack.isCancel(r)) return null;
  return r;
}
async function multiselect2(message, options) {
  if (!interactive()) return [];
  const r = await clack.multiselect({ message, options, required: false });
  if (clack.isCancel(r)) return [];
  return r;
}
async function select2(message, options, initialValue) {
  if (!interactive()) return null;
  const r = await clack.select({ message, options, initialValue });
  if (clack.isCancel(r)) return null;
  return r;
}
async function autocomplete2(message, options, initialValue) {
  if (!interactive()) return null;
  const r = await clack.autocomplete({
    message,
    options,
    placeholder: "Type to search\u2026",
    maxItems: 10,
    initialValue
  });
  if (clack.isCancel(r)) return null;
  return r;
}
var intro2, outro2;
var init_prompt = __esm({
  "src/ui/prompt.ts"() {
    "use strict";
    init_platform();
    intro2 = clack.intro;
    outro2 = clack.outro;
  }
});

// src/ui/logo.ts
var WORDMARK, TAGLINE, CREDIT, MARK_ASCII;
var init_logo = __esm({
  "src/ui/logo.ts"() {
    "use strict";
    WORDMARK = "gR DEV AGENT";
    TAGLINE = "Your parallel AI engineering workspace";
    CREDIT = "Developed by Golam Rabbani";
    MARK_ASCII = [
      "       ___ ",
      "  __ _| _ \\",
      " / _` |   /",
      " \\__, |_|_\\",
      " |___/     "
    ];
  }
});

// src/ui/home.ts
import path23 from "path";
import { execFileSync } from "child_process";
import pc3 from "picocolors";
function visibleLength(s) {
  return vlen(s);
}
function stripAnsi(s) {
  return s.replace(ANSI, "");
}
function composerPlaceholder(unicode) {
  return unicode ? "Ask anything, or /implement <task> for a workflow\u2026" : "Ask anything, or /implement <task> for a workflow...";
}
function filterSlashCommands(value) {
  const query = value.replace(/^\//, "").toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.id.slice(1).toLowerCase().startsWith(query));
}
function isCommandMenuOpen(value) {
  return value.startsWith("/") && !value.includes(" ");
}
function rgb(s, r, g, b) {
  return `\x1B[38;2;${r};${g};${b}m${s}\x1B[0m`;
}
function invalidateSizeCache() {
  cachedWidth = null;
  cachedHeight = null;
}
function termWidth() {
  const override = validWidth(Number(process.env.GR_AGENT_WIDTH));
  if (override) return clampWidth(override);
  const now = Date.now();
  if (cachedWidth && now - cachedWidth.at < SIZE_CACHE_MS) return cachedWidth.value;
  const ttyWidth = Math.max(
    validWidth(process.stdout.columns),
    validWidth(typeof process.stdout.getWindowSize === "function" ? process.stdout.getWindowSize()[0] : 0)
  );
  const shellWidth = Math.max(validWidth(sttyColumns()), validWidth(tputColumns()));
  const envWidth = validWidth(Number(process.env.COLUMNS));
  const visibleWidth = Math.max(shellWidth, envWidth);
  let result;
  if (ttyWidth >= 140 && visibleWidth <= 100) result = clampWidth(ttyWidth);
  else if (ttyWidth >= 140 && visibleWidth > 100 && visibleWidth < 140) result = clampWidth(visibleWidth);
  else if (visibleWidth) result = clampWidth(visibleWidth);
  else result = clampWidth(ttyWidth || 100);
  cachedWidth = { value: result, at: now };
  return result;
}
function termHeight() {
  const override = validSize(Number(process.env.GR_AGENT_HEIGHT));
  if (override) return clampHeight(override);
  const now = Date.now();
  if (cachedHeight && now - cachedHeight.at < SIZE_CACHE_MS) return cachedHeight.value;
  const ttyHeight = validSize(process.stdout.rows);
  const shellHeight = Math.max(validSize(sttyRows()), validSize(tputRows()));
  const envHeight = validSize(Number(process.env.LINES));
  const result = clampHeight(Math.max(ttyHeight, shellHeight, envHeight, 30));
  cachedHeight = { value: result, at: now };
  return result;
}
function clampWidth(cols) {
  return Math.max(64, Math.min(cols, 320));
}
function clampHeight(rows) {
  return Math.max(24, Math.min(rows, 150));
}
function validWidth(cols) {
  return typeof cols === "number" && Number.isFinite(cols) && cols >= 44 ? cols : 0;
}
function validSize(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
function sttyColumns() {
  try {
    const out = execFileSync("stty", ["size"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] }).trim();
    const cols = out.split(/\s+/).map(Number)[1] ?? 0;
    return Number.isFinite(cols) ? cols : 0;
  } catch {
    return 0;
  }
}
function sttyRows() {
  try {
    const out = execFileSync("stty", ["size"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] }).trim();
    const rows = out.split(/\s+/).map(Number)[0] ?? 0;
    return Number.isFinite(rows) ? rows : 0;
  } catch {
    return 0;
  }
}
function tputColumns() {
  try {
    const out = execFileSync("tput", ["cols"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] }).trim();
    const cols = Number(out);
    return Number.isFinite(cols) ? cols : 0;
  } catch {
    return 0;
  }
}
function tputRows() {
  try {
    const out = execFileSync("tput", ["lines"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] }).trim();
    const rows = Number(out);
    return Number.isFinite(rows) ? rows : 0;
  } catch {
    return 0;
  }
}
function unicodeOk() {
  if (process.env.GR_ASCII || process.argv.includes("--ascii")) return false;
  if (Platform.isWindows && !process.env.WT_SESSION && !process.env.TERM_PROGRAM) {
    const enc = `${process.env.LC_ALL ?? ""}${process.env.LC_CTYPE ?? ""}${process.env.LANG ?? ""}`.toLowerCase();
    if (!enc.includes("utf") && !process.stdout.isTTY) return false;
  }
  return true;
}
function padEndV(s, width) {
  return vlen(s) < width ? s + " ".repeat(width - vlen(s)) : s;
}
function truncV(s, width) {
  if (width <= 0) return "";
  if (vlen(s) <= width) return s;
  const plain = s.replace(ANSI, "");
  return plain.slice(0, Math.max(0, width - 1)) + "~";
}
function fitLine(s, width) {
  return padEndV(truncV(s, width), width);
}
function divider(width, unicode) {
  return paint2.dim((unicode ? "\u2500" : "-").repeat(width));
}
function footer(m, width, unicode) {
  const sep = paint2.dim(unicode ? "  \u2022  " : "  |  ");
  const left = [paint2.pill(` ${m.mode} `), paint2.muted("enter send"), paint2.muted("@ files"), paint2.muted("/ commands"), paint2.muted("tab agent")].join(sep);
  const active2 = m.agent !== "native" ? m.agent : m.provider === "no provider" ? "no provider" : m.provider;
  const activeLabel = m.agentModel ? `${active2} (${m.agentModel})` : active2;
  const right = `${paint2.muted("~/" + m.workspaceName)}   ${paint2.muted(activeLabel)}`;
  if (vlen(left) + vlen(right) + 2 > width) return fitLine(left, width);
  return left + " ".repeat(width - vlen(left) - vlen(right)) + right;
}
function iconLines(unicode) {
  return unicode ? ["\u250C\u2500\u2500\u2500\u2500\u2500\u2510", "\u2502 \u2197 \u2197 \u2502", "\u2502  \u25E1  \u2502", "\u2514\u2500\u2500\u252C\u2500\u2500\u2518", "   \u2534   "] : MARK_ASCII;
}
function sideBySide(left, right, gap = 3) {
  const h = Math.max(left.length, right.length);
  const lw = Math.max(...left.map(vlen), 0);
  const out = [];
  for (let i = 0; i < h; i++) out.push(padEndV(left[i] ?? "", lw) + " ".repeat(gap) + (right[i] ?? ""));
  return out;
}
function header(m, unicode) {
  const icon = iconLines(unicode).map((line) => paint2.cyan(line));
  const branch = m.branch ?? "-";
  const details = [
    `${paint2.text(WORDMARK)} ${paint2.dim("v" + m.version)}`,
    paint2.muted(TAGLINE),
    paint2.dim(CREDIT),
    "",
    `${paint2.muted("Current directory:")} ${paint2.text("~/" + m.workspaceName)}`,
    `${paint2.text("Tip:")} ${paint2.muted("Use")} ${paint2.text("/help")} ${paint2.muted("for commands.")}`,
    `${paint2.dim("Branch")} ${paint2.text(branch)}   ${paint2.dim("Mode")} ${paint2.text(m.mode)}   ${paint2.dim("Agent")} ${paint2.text(m.agent)}`
  ];
  return sideBySide(icon, details, 3);
}
function ageLabel(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diff = Math.max(0, Date.now() - time);
  const mins = Math.floor(diff / 6e4);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
function checkpointToRecentTask(cp) {
  const count = cp.completedResults.length;
  const message = `${count || 1} message${count === 1 ? "" : "s"}`;
  const age = ageLabel(cp.savedAt);
  return { title: cp.task.objective, meta: age ? `${message} \xB7 ${age}` : message };
}
function commandMenuSection(value, selectedIndex, width) {
  const matches = filterSlashCommands(value);
  const head = `${paint2.dim("Commands")} ${paint2.dim("\xB7")} ${paint2.muted("\u2191\u2193 select \xB7 enter choose \xB7 esc cancel")}`;
  if (matches.length === 0) return [head, "", `  ${paint2.muted("No matching commands")}`];
  const out = [head, ""];
  const clamped = Math.min(Math.max(selectedIndex, 0), matches.length - 1);
  matches.slice(0, 6).forEach((c, i) => {
    const selected = i === clamped;
    const marker = selected ? paint2.cyan(">") : " ";
    const label = selected ? paint2.cyanBold(padEndV(c.id, 16)) : paint2.text(padEndV(c.id, 16));
    const desc = paint2.muted(c.desc + (c.comingSoon ? "  (soon)" : ""));
    const line = `  ${marker} ${label}  ${desc}`;
    out.push(selected ? paint2.selected(fitLine(line, width)) : fitLine(line, width));
  });
  return out;
}
function getSuggestionList(m) {
  if (m.recentTasks?.length) return m.recentTasks.slice(0, 5);
  if (!m.initialised) return SETUP_STARTERS;
  if (!m.hasRepo) return CLONE_STARTERS;
  if (m.stack === "backend") return BACKEND_STARTERS;
  if (m.stack === "frontend") return FRONTEND_STARTERS;
  return STARTERS.slice(0, 5);
}
function resolveSuggestionSubmission(chosen) {
  if (chosen.action === "init") return RUN_INIT_ACTION;
  if (chosen.action === "clone") return RUN_CLONE_ACTION;
  const raw = chosen.value ?? chosen.title;
  return raw.startsWith("/") ? raw : `/implement ${raw}`;
}
function recentSectionTitle(m) {
  if (m.recentTasks?.length) return "Recent tasks";
  if (!m.initialised) return "Get started";
  if (!m.hasRepo) return "Next: clone a repository";
  if (m.stack === "backend") return "Suggested starts (backend)";
  if (m.stack === "frontend") return "Suggested starts (frontend)";
  return "Suggested starts";
}
function recentSection(m, width, selectedIndex = 0) {
  const recents = getSuggestionList(m);
  const title = recentSectionTitle(m);
  const hint = m.recentTasks?.length ? "/resume" : "/help";
  const out = [`${paint2.dim(title)} ${paint2.dim("\xB7")} ${paint2.muted("\u2191\u2193 select \xB7 enter run \xB7 " + hint)}`, ""];
  const inner = Math.max(30, width - 4);
  const clamped = Math.min(Math.max(selectedIndex, 0), Math.max(recents.length - 1, 0));
  recents.forEach((item, i) => {
    const selected = i === clamped;
    const marker = selected ? paint2.cyan(">") : " ";
    const meta = paint2.muted(item.meta);
    const titleWidth = Math.max(12, inner - vlen(item.meta) - 4);
    const titleText = selected ? paint2.cyanBold(truncV(item.title, titleWidth)) : paint2.text(truncV(item.title, titleWidth));
    const line = `  ${marker} ${padEndV(titleText, titleWidth)}  ${meta}`;
    out.push(selected ? paint2.selected(fitLine(line, width)) : fitLine(line, width));
  });
  return out;
}
function wrapText(text3, width) {
  const w = Math.max(10, width);
  const out = [];
  for (const paragraph of text3.split("\n")) {
    if (paragraph === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (vlen(next) > w && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}
function renderAssistantBody(text3, width) {
  const fence = /```([\w+-]*)[ \t]*\n?([\s\S]*?)```/g;
  const out = [];
  let last = 0;
  let match;
  const prose = (segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return;
    for (const l of wrapText(trimmed, width)) out.push(l ? paint2.muted(l) : "");
  };
  while (match = fence.exec(text3)) {
    prose(text3.slice(last, match.index));
    const lang = (match[1] ?? "").trim();
    const code = (match[2] ?? "").replace(/\n$/, "");
    const codeLines = code.split("\n");
    const ruleWidth = Math.max(20, width);
    const headerCore = `\u2500${lang ? ` ${lang} ` : " "}`;
    out.push(paint2.dim(`\u250C${headerCore}${"\u2500".repeat(Math.max(0, ruleWidth - headerCore.length - 2))}\u2510`));
    const innerWidth = ruleWidth;
    for (const codeLine of codeLines) {
      const fitted = padEndV(truncV(`  ${codeLine}`, innerWidth), innerWidth);
      out.push(paint2.codeBg(paint2.text(fitted)));
    }
    out.push(paint2.dim(`\u2514${"\u2500".repeat(Math.max(0, ruleWidth - 2))}\u2518`));
    last = fence.lastIndex;
  }
  const tail = text3.slice(last);
  if (tail.trim() || out.length === 0) prose(tail);
  return out;
}
function chatSection(m, width, maxLines) {
  const history = m.chatHistory ?? [];
  const inner = Math.max(30, width - 2);
  const lines2 = [];
  for (const turn of history) {
    if (turn.role === "user") {
      const wrapped = wrapText(turn.text, inner - 2);
      wrapped.forEach((l, i) => lines2.push(i === 0 ? `${paint2.cyanBold(">")} ${paint2.text(l)}` : `  ${l}`));
    } else {
      lines2.push(paint2.dim(`${turn.agent ?? "gR DEV AGENT"}:`));
      lines2.push(...renderAssistantBody(turn.text, inner));
    }
    lines2.push("");
  }
  if (m.chatPending) lines2.push(paint2.dim("Thinking\u2026"));
  if (lines2.length === 0) return [paint2.muted("Ask anything \u2014 nothing runs against your code unless you use /implement.")];
  if (lines2.length <= maxLines) return lines2;
  const tail = lines2.slice(lines2.length - maxLines);
  return [paint2.dim(`\u2026 earlier messages hidden \u2014 ${history.length} message${history.length === 1 ? "" : "s"} total`), "", ...tail];
}
function runSection(m, width, maxLines) {
  const lines2 = m.runLog ?? [];
  const header2 = `${paint2.dim("Running:")} ${paint2.text(m.runObjective ?? "")}`;
  const body = lines2.length > 0 ? lines2.map((l) => truncV(l, width)) : [paint2.muted("Starting\u2026")];
  const withStatus = m.runStatus ? [...body, paint2.cyan(m.runStatus)] : body;
  if (withStatus.length <= maxLines) return [header2, "", ...withStatus];
  const tail = withStatus.slice(withStatus.length - maxLines);
  const hidden = lines2.length - (tail.length - (m.runStatus ? 1 : 0));
  return [header2, "", paint2.dim(`\u2026 ${Math.max(hidden, 0)} earlier line${hidden === 1 ? "" : "s"} hidden`), "", ...tail];
}
function renderHome(m, composer) {
  const width = termWidth();
  const height = termHeight();
  const unicode = unicodeOk();
  const L = [];
  const menuOpen = composer !== void 0 && isCommandMenuOpen(composer.value);
  const listIndex = composer && composer.value === "" ? composer.selectedIndex ?? 0 : 0;
  const running = m.runLog !== void 0;
  const chatting = !running && ((m.chatHistory?.length ?? 0) > 0 || m.chatPending === true);
  L.push("");
  L.push(...header(m, unicode));
  L.push("");
  if (menuOpen) {
    L.push(...commandMenuSection(composer.value, composer.selectedIndex ?? 0, width));
  } else if (running) {
    L.push(...runSection(m, width, Math.max(6, height - 16)));
  } else if (chatting) {
    L.push(...chatSection(m, width, Math.max(6, height - 16)));
  } else {
    L.push(...recentSection(m, width, listIndex));
  }
  L.push("");
  if (!chatting && !running) {
    L.push(
      m.initialised ? paint2.muted(m.ready ? "Ready." : "Provider setup needed.") : paint2.muted("Workspace not initialised. Run ") + paint2.brand("gr-agent init") + paint2.muted(" when you want workspace files.")
    );
  }
  const bottomLines = 4;
  const fill = Math.max(1, height - L.length - bottomLines);
  for (let i = 0; i < fill; i++) L.push("");
  const highlighted = !menuOpen && !chatting && !running && composer?.value === "" ? getSuggestionList(m)[listIndex] : void 0;
  const composerText = composer ? composer.value || paint2.dim(highlighted?.value ?? composerPlaceholder(unicode)) : "";
  L.push(composer ? `${renderHomePrompt()}${composerText}` : "");
  L.push(divider(width, unicode));
  L.push(footer(m, width, unicode));
  L.push("");
  return L.map((line) => truncV(line, width)).join("\n");
}
function deriveWorkspaceName(root) {
  return path23.basename(root) || "workspace";
}
function renderHomePrompt() {
  return unicodeOk() ? `${paint2.cyan("\u258C")} ${paint2.cyan(">")} ` : "> ";
}
var RUN_INIT_ACTION, RUN_CLONE_ACTION, ANSI, vlen, STARTERS, BACKEND_STARTERS, FRONTEND_STARTERS, SETUP_STARTERS, CLONE_STARTERS, SLASH_COMMANDS, paint2, SIZE_CACHE_MS, cachedWidth, cachedHeight;
var init_home = __esm({
  "src/ui/home.ts"() {
    "use strict";
    init_logger();
    init_platform();
    init_logo();
    RUN_INIT_ACTION = "::gr-agent:run-init::";
    RUN_CLONE_ACTION = "::gr-agent:run-clone::";
    ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    vlen = (s) => s.replace(ANSI, "").length;
    STARTERS = [
      { title: "Investigate a bug", meta: "" },
      { title: "Trace a request end-to-end", meta: "" },
      { title: "Audit permissions", meta: "" },
      { title: "Review current Git changes", meta: "" },
      { title: "Create a new feature", meta: "" }
    ];
    BACKEND_STARTERS = [
      { title: "Trace an API endpoint end-to-end", meta: "" },
      { title: "Audit endpoint permissions", meta: "" },
      { title: "Investigate a backend bug", meta: "" },
      { title: "Review current Git changes", meta: "" },
      { title: "Add a new endpoint", meta: "" }
    ];
    FRONTEND_STARTERS = [
      { title: "Investigate a UI bug", meta: "" },
      { title: "Trace an API call from the UI", meta: "" },
      { title: "Review component structure", meta: "" },
      { title: "Review current Git changes", meta: "" },
      { title: "Create a new component", meta: "" }
    ];
    SETUP_STARTERS = [
      { title: "/setup", meta: "", value: "gr-agent init", action: "init" },
      { title: "/help", meta: "" }
    ];
    CLONE_STARTERS = [
      { title: "/clone", meta: "", value: "clone a repository", action: "clone" },
      { title: "/help", meta: "" }
    ];
    SLASH_COMMANDS = [
      { id: "/help", desc: "Show help" },
      { id: "/plan", desc: "Write an implementation plan for a task, saved under .gr-agent/plans/" },
      { id: "/spec", desc: "Write a specification for a feature, saved under .gr-agent/specs/" },
      { id: "/implement", desc: "Run a real task: investigate -> implement -> test -> review" },
      { id: "/setup", desc: "Create/switch project folder, or remove the current setup" },
      { id: "/clone", desc: "Clone a repository into this workspace" },
      { id: "/mode", desc: "Set the workflow mode for the next task" },
      { id: "/agents", desc: "Choose which AI worker runs your tasks (native, Claude, Codex, Cursor, ...)" },
      { id: "/model", desc: "Pick which model the current worker uses" },
      { id: "/quit", desc: "Exit gR DEV AGENT" }
    ];
    paint2 = {
      brand: (s) => isColor() ? rgb(s, 76, 184, 126) : s,
      brandBold: (s) => isColor() ? pc3.bold(rgb(s, 86, 188, 133)) : s,
      cyan: (s) => isColor() ? rgb(s, 0, 170, 242) : s,
      cyanBold: (s) => isColor() ? pc3.bold(rgb(s, 0, 170, 242)) : s,
      dim: (s) => isColor() ? rgb(s, 105, 111, 120) : s,
      muted: (s) => isColor() ? rgb(s, 168, 181, 204) : s,
      text: (s) => isColor() ? rgb(s, 230, 232, 236) : s,
      line: (s) => isColor() ? rgb(s, 43, 88, 125) : s,
      selected: (s) => isColor() ? `\x1B[48;2;10;30;52m${s}\x1B[0m` : s,
      pill: (s) => isColor() ? `\x1B[48;2;86;188;133m\x1B[38;2;12;18;15m${s}\x1B[0m` : s,
      /** subtle dark background for a fenced code-block line inside a chat reply. */
      codeBg: (s) => isColor() ? `\x1B[48;2;22;27;34m${s}\x1B[0m` : s
    };
    SIZE_CACHE_MS = 250;
    cachedWidth = null;
    cachedHeight = null;
  }
});

// src/ui/ink/inputBuffer.ts
function initialInputState() {
  return { value: "", cursor: 0 };
}
function clampCursor(value, cursor) {
  return Math.max(0, Math.min(cursor, value.length));
}
function insertText(state2, text3) {
  if (text3 === "") return state2;
  const cursor = clampCursor(state2.value, state2.cursor);
  const value = state2.value.slice(0, cursor) + text3 + state2.value.slice(cursor);
  return { value, cursor: cursor + text3.length };
}
function backspace(state2) {
  const cursor = clampCursor(state2.value, state2.cursor);
  if (cursor === 0) return state2;
  const value = state2.value.slice(0, cursor - 1) + state2.value.slice(cursor);
  return { value, cursor: cursor - 1 };
}
function moveLeft(state2) {
  return { ...state2, cursor: clampCursor(state2.value, state2.cursor - 1) };
}
function moveRight(state2) {
  return { ...state2, cursor: clampCursor(state2.value, state2.cursor + 1) };
}
function lineStart(value, cursor) {
  const before = value.lastIndexOf("\n", cursor - 1);
  return before === -1 ? 0 : before + 1;
}
function lineEnd(value, cursor) {
  const after = value.indexOf("\n", cursor);
  return after === -1 ? value.length : after;
}
function moveHome(state2) {
  const cursor = clampCursor(state2.value, state2.cursor);
  return { ...state2, cursor: lineStart(state2.value, cursor) };
}
function moveEnd(state2) {
  const cursor = clampCursor(state2.value, state2.cursor);
  return { ...state2, cursor: lineEnd(state2.value, cursor) };
}
function moveUp(state2) {
  const cursor = clampCursor(state2.value, state2.cursor);
  const curStart = lineStart(state2.value, cursor);
  if (curStart === 0) return state2;
  const col = cursor - curStart;
  const prevEnd = curStart - 1;
  const prevStart = lineStart(state2.value, prevEnd);
  const prevLen = prevEnd - prevStart;
  return { ...state2, cursor: prevStart + Math.min(col, prevLen) };
}
function moveDown(state2) {
  const cursor = clampCursor(state2.value, state2.cursor);
  const curStart = lineStart(state2.value, cursor);
  const curEnd = lineEnd(state2.value, cursor);
  if (curEnd === state2.value.length) return state2;
  const col = cursor - curStart;
  const nextStart = curEnd + 1;
  const nextEnd = lineEnd(state2.value, nextStart);
  const nextLen = nextEnd - nextStart;
  return { ...state2, cursor: nextStart + Math.min(col, nextLen) };
}
function applyEnter(state2) {
  const cursor = clampCursor(state2.value, state2.cursor);
  if (cursor > 0 && state2.value[cursor - 1] === "\\") {
    const value = state2.value.slice(0, cursor - 1) + "\n" + state2.value.slice(cursor);
    return { state: { value, cursor }, submit: null };
  }
  return { state: state2, submit: state2.value };
}
function insertNewline(state2) {
  return insertText(state2, "\n");
}
function visualCursor(state2) {
  const cursor = clampCursor(state2.value, state2.cursor);
  const before = state2.value.slice(0, cursor);
  const line = (before.match(/\n/g) ?? []).length;
  const col = cursor - lineStart(state2.value, cursor);
  return { line, col };
}
function lines(state2) {
  return state2.value.split("\n");
}
var init_inputBuffer = __esm({
  "src/ui/ink/inputBuffer.ts"() {
    "use strict";
  }
});

// src/ui/ink/useTerminalSize.ts
import { useEffect, useState } from "react";
import { useStdout } from "ink";
function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout.columns || 80,
    rows: stdout.rows || 24
  });
  useEffect(() => {
    const onResize = () => {
      setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}
var init_useTerminalSize = __esm({
  "src/ui/ink/useTerminalSize.ts"() {
    "use strict";
  }
});

// src/ui/ink/MultilineInput.tsx
import { Box, Text, useInput } from "ink";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function MultilineInput({
  state: state2,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  suppressVerticalNav,
  interceptEnter,
  onCycleAgent
}) {
  useInput(
    (input, key) => {
      if (disabled) return;
      if (key.tab && key.shift) {
        onCycleAgent?.();
        return;
      }
      if (key.return) {
        if (interceptEnter) return;
        const { state: next, submit } = applyEnter(state2);
        if (submit !== null) {
          onSubmit(submit);
        } else {
          onChange(next);
        }
        return;
      }
      if (key.ctrl && input === "j") {
        onChange(insertNewline(state2));
        return;
      }
      if (key.backspace || key.delete) {
        onChange(backspace(state2));
        return;
      }
      if (key.leftArrow) {
        onChange(moveLeft(state2));
        return;
      }
      if (key.rightArrow) {
        onChange(moveRight(state2));
        return;
      }
      if (key.upArrow) {
        if (!suppressVerticalNav) onChange(moveUp(state2));
        return;
      }
      if (key.downArrow) {
        if (!suppressVerticalNav) onChange(moveDown(state2));
        return;
      }
      if (key.ctrl && input === "a") {
        onChange(moveHome(state2));
        return;
      }
      if (key.ctrl && input === "e") {
        onChange(moveEnd(state2));
        return;
      }
      if (key.ctrl && input === "u") {
        onChange({ value: "", cursor: 0 });
        return;
      }
      if (key.meta || key.ctrl) return;
      if (input) onChange(insertText(state2, input));
    },
    { isActive: !disabled }
  );
  const rows = lines(state2);
  const { line: cursorLine, col: cursorCol } = visualCursor(state2);
  const showPlaceholder = state2.value === "" && placeholder;
  const { columns } = useTerminalSize();
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx(Text, { color: disabled ? "gray" : "cyan", children: "\u2500".repeat(Math.max(1, columns)) }),
    showPlaceholder ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: placeholder }) : rows.map((row, i) => /* @__PURE__ */ jsx(Text, { children: i === cursorLine ? /* @__PURE__ */ jsxs(Fragment, { children: [
      row.slice(0, cursorCol),
      /* @__PURE__ */ jsx(Text, { inverse: true, children: row[cursorCol] ?? " " }),
      row.slice(cursorCol + 1)
    ] }) : row || " " }, i)),
    /* @__PURE__ */ jsx(Text, { color: disabled ? "gray" : "cyan", children: "\u2500".repeat(Math.max(1, columns)) })
  ] });
}
var init_MultilineInput = __esm({
  "src/ui/ink/MultilineInput.tsx"() {
    "use strict";
    init_inputBuffer();
    init_useTerminalSize();
  }
});

// src/ui/ink/CommandPopover.tsx
import { Box as Box2, Text as Text2 } from "ink";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function CommandPopover({ query, selectedIndex }) {
  const matches = filterSlashCommands(query);
  if (matches.length === 0) return null;
  const clampedIndex = Math.max(0, Math.min(selectedIndex, matches.length - 1));
  return /* @__PURE__ */ jsx2(Box2, { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1, children: matches.map((c, i) => {
    const selected = i === clampedIndex;
    return /* @__PURE__ */ jsxs2(Text2, { color: selected ? "cyan" : void 0, backgroundColor: selected ? "#17343a" : void 0, children: [
      c.id.padEnd(14),
      " ",
      c.desc,
      c.comingSoon ? " (soon)" : ""
    ] }, c.id);
  }) });
}
function clampPopoverIndex(index, query) {
  const count = filterSlashCommands(query).length;
  if (count === 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}
var init_CommandPopover = __esm({
  "src/ui/ink/CommandPopover.tsx"() {
    "use strict";
    init_home();
  }
});

// src/ui/ink/WelcomeBanner.tsx
import { Box as Box3, Text as Text3 } from "ink";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function welcomeBannerWidth(columns) {
  return Math.max(NARROW_BREAKPOINT, columns);
}
function welcomeColumnWidths(columns) {
  const width = welcomeBannerWidth(columns);
  const separatorWidth = 3;
  const maxLeftWidth = Math.max(1, width - MIN_RIGHT_COLUMN_WIDTH - separatorWidth);
  const leftWidth = Math.min(Math.max(MIN_LEFT_COLUMN_WIDTH, Math.floor(width * WELCOME_LEFT_RATIO)), maxLeftWidth);
  return { leftWidth, rightWidth: Math.max(1, width - leftWidth - separatorWidth) };
}
function estimateWelcomeBannerRows(columns) {
  if (columns < NARROW_BREAKPOINT) {
    return 11;
  }
  return 17;
}
function WelcomeBanner({ version, mode, agent, agentModel, userName, cwdDisplay }) {
  const { columns } = useTerminalSize();
  const modelLabel = agentModel ?? agent;
  const statusLine = `[${shorten(modelLabel, 16)}]  [${shorten(`${agent} agent`, 18)}]  [${shorten(mode, 10)}]`;
  if (columns < NARROW_BREAKPOINT) {
    return /* @__PURE__ */ jsxs3(Box3, { marginBottom: 1, flexDirection: "column", children: [
      /* @__PURE__ */ jsxs3(Text3, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx3(Text3, { bold: true, color: "cyan", children: WORDMARK }),
        " ",
        /* @__PURE__ */ jsxs3(Text3, { color: "cyan", children: [
          "v",
          version
        ] })
      ] }),
      /* @__PURE__ */ jsx3(Text3, { color: "cyan", wrap: "truncate-end", children: "\u2500".repeat(Math.max(1, columns)) }),
      /* @__PURE__ */ jsxs3(Text3, { bold: true, wrap: "truncate-end", children: [
        "Welcome back, ",
        /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: userName })
      ] }),
      MARK_ASCII.map((line, i) => /* @__PURE__ */ jsx3(Text3, { color: "cyan", wrap: "truncate-end", children: line }, i)),
      /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: statusLine }),
      /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: cwdDisplay }),
      /* @__PURE__ */ jsxs3(Text3, { wrap: "truncate-end", children: [
        /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: "/help" }),
        " ",
        /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: "commands" }),
        "  ",
        /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: "/agents" }),
        " ",
        /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: "workers" })
      ] })
    ] });
  }
  const boxWidth = welcomeBannerWidth(columns);
  const rule = "\u2500".repeat(Math.max(1, boxWidth));
  const { leftWidth, rightWidth } = welcomeColumnWidths(columns);
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", width: boxWidth, marginBottom: 1, children: [
    /* @__PURE__ */ jsx3(Box3, { children: /* @__PURE__ */ jsxs3(Text3, { bold: true, color: "cyan", children: [
      WORDMARK,
      "  \u25CF  ",
      /* @__PURE__ */ jsxs3(Text3, { inverse: true, children: [
        " v",
        version,
        " "
      ] })
    ] }) }),
    /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: rule }),
    /* @__PURE__ */ jsxs3(Box3, { flexDirection: "row", children: [
      /* @__PURE__ */ jsxs3(
        Box3,
        {
          flexDirection: "column",
          alignItems: "center",
          width: leftWidth,
          paddingRight: 2,
          borderStyle: "single",
          borderColor: "cyan",
          borderTop: false,
          borderBottom: false,
          borderLeft: false,
          children: [
            /* @__PURE__ */ jsxs3(Text3, { bold: true, wrap: "truncate-end", children: [
              "Welcome back, ",
              /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: userName })
            ] }),
            /* @__PURE__ */ jsx3(Text3, { children: " " }),
            MARK_ASCII.map((line, i) => /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: line }, i)),
            /* @__PURE__ */ jsx3(Text3, { children: " " }),
            /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: statusLine }),
            /* @__PURE__ */ jsx3(Text3, { children: " " }),
            /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: cwdDisplay })
          ]
        }
      ),
      /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", flexGrow: 1, paddingLeft: 3, children: [
        /* @__PURE__ */ jsx3(Text3, { bold: true, color: "cyan", children: "Quick start" }),
        /* @__PURE__ */ jsxs3(Text3, { dimColor: true, wrap: "truncate-end", children: [
          /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: "/help" }),
          "  Run /help to see every command"
        ] }),
        /* @__PURE__ */ jsxs3(Text3, { dimColor: true, wrap: "truncate-end", children: [
          /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: "/agents" }),
          "  Run /agents to choose a worker"
        ] }),
        /* @__PURE__ */ jsx3(Text3, { children: " " }),
        /* @__PURE__ */ jsx3(Text3, { color: "cyan", wrap: "truncate-end", children: "\u2500".repeat(rightWidth) }),
        /* @__PURE__ */ jsx3(Text3, { children: " " }),
        /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", children: [
          /* @__PURE__ */ jsx3(Text3, { bold: true, color: "cyan", children: "Workspace" }),
          /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: TAGLINE }),
          /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: "Plan tasks, route work to the right agent" }),
          /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: "Keep code changes separate until reviewed" }),
          /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: "Merge findings into one root-cause report" }),
          /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: "Native / Claude / Codex / Cursor / OpenCode / Manual" }),
          /* @__PURE__ */ jsx3(Text3, { dimColor: true, wrap: "truncate-end", children: CREDIT })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx3(Text3, { color: "cyan", children: rule })
  ] });
}
function shorten(value, width) {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}~`;
}
var NARROW_BREAKPOINT, WELCOME_LEFT_RATIO, MIN_LEFT_COLUMN_WIDTH, MIN_RIGHT_COLUMN_WIDTH;
var init_WelcomeBanner = __esm({
  "src/ui/ink/WelcomeBanner.tsx"() {
    "use strict";
    init_logo();
    init_useTerminalSize();
    NARROW_BREAKPOINT = 54;
    WELCOME_LEFT_RATIO = 0.2;
    MIN_LEFT_COLUMN_WIDTH = 32;
    MIN_RIGHT_COLUMN_WIDTH = 24;
  }
});

// src/ui/ink/Transcript.tsx
import { Box as Box4, Static, Text as Text4 } from "ink";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function Transcript({ items }) {
  return /* @__PURE__ */ jsx4(Static, { items, children: (item, index) => {
    if (item.kind === "welcome") {
      return /* @__PURE__ */ jsx4(WelcomeBanner, { ...item.banner }, index);
    }
    const { turn } = item;
    return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", marginBottom: 1, children: [
      /* @__PURE__ */ jsx4(Text4, { color: turn.role === "user" ? "cyan" : "green", bold: true, children: turn.role === "user" ? "You" : turn.agent ?? "Assistant" }),
      /* @__PURE__ */ jsx4(Text4, { children: turn.text === "" ? " " : turn.text })
    ] }, index);
  } });
}
var init_Transcript = __esm({
  "src/ui/ink/Transcript.tsx"() {
    "use strict";
    init_WelcomeBanner();
  }
});

// src/ui/ink/InkApp.tsx
import { useState as useState2 } from "react";
import { Box as Box5, Text as Text5, useApp, useInput as useInput2 } from "ink";
import wrapAnsi from "wrap-ansi";
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function InkApp({
  workspaceName,
  branch,
  agent,
  agentModel,
  version,
  mode,
  showWelcome,
  userName,
  cwdDisplay,
  initialHistory,
  initialInput,
  onSubmit,
  onCycleAgent,
  onAgentCycleRemount,
  liveStatusRef
}) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [history, setHistory] = useState2(initialHistory ?? []);
  const [input, setInput] = useState2(initialInput ?? initialInputState());
  const [pending2, setPending] = useState2(false);
  const [popoverIndex, setPopoverIndex] = useState2(0);
  const [error, setError] = useState2(null);
  const [activeAgent, setActiveAgent] = useState2({ agent, agentModel });
  if (liveStatusRef) liveStatusRef.current = { input, pending: pending2 };
  const popoverOpen = isCommandMenuOpen(input.value) && !pending2;
  const popoverMatches = popoverOpen ? filterSlashCommands(input.value) : [];
  const highlightedCommand = popoverMatches.length > 0 ? popoverMatches[Math.max(0, Math.min(popoverIndex, popoverMatches.length - 1))] : void 0;
  const popoverInterceptsEnter = Boolean(highlightedCommand) && highlightedCommand.id !== input.value;
  const handleCycleAgent = () => {
    if (!onCycleAgent || pending2) return;
    void Promise.resolve(onCycleAgent()).then((selection) => {
      setActiveAgent(selection);
      if (showWelcome) onAgentCycleRemount?.();
    });
  };
  const handleChange = (next) => {
    setInput(next);
    if (isCommandMenuOpen(next.value)) {
      setPopoverIndex((i) => clampPopoverIndex(i, next.value));
    }
  };
  const handleSubmit = (text3) => {
    const trimmed = text3.trim();
    setInput(initialInputState());
    if (trimmed === "") return;
    const nextHistory = [...history, { role: "user", text: trimmed }];
    setHistory(nextHistory);
    setPending(true);
    setError(null);
    onSubmit(trimmed, nextHistory).then((reply) => {
      setPending(false);
      if (reply === null) {
        exit();
        return;
      }
      setHistory((h) => [...h, { role: "assistant", text: reply.text, agent: reply.agent }]);
    }).catch((e) => {
      setPending(false);
      setError(e instanceof Error ? e.message : String(e));
    });
  };
  useInput2(
    (_input, key) => {
      if (popoverMatches.length === 0) return;
      if (key.upArrow) {
        setPopoverIndex((i) => (i - 1 + popoverMatches.length) % popoverMatches.length);
        return;
      }
      if (key.downArrow) {
        setPopoverIndex((i) => (i + 1) % popoverMatches.length);
        return;
      }
      if (key.tab && !key.shift || key.return && popoverInterceptsEnter) {
        const chosen = highlightedCommand;
        setInput({ value: `${chosen.id} `, cursor: chosen.id.length + 1 });
      }
    },
    { isActive: popoverOpen }
  );
  const footerAgent = activeAgent.agentModel ? `${activeAgent.agent} (${activeAgent.agentModel})` : activeAgent.agent;
  const usedRows = (showWelcome ? estimateWelcomeBannerRows(columns) : 0) + history.reduce((sum, turn) => sum + estimateTurnRows(turn, columns), 0);
  const fillerMinHeight = Math.max(0, rows - usedRows - 1);
  const transcriptItems = [
    ...showWelcome ? [
      {
        kind: "welcome",
        banner: {
          version: version ?? "0.0.0",
          workspaceName,
          branch,
          mode: mode ?? "auto",
          agent: activeAgent.agent,
          agentModel: activeAgent.agentModel,
          userName: userName ?? "there",
          cwdDisplay: cwdDisplay ?? `~/${workspaceName}`
        }
      }
    ] : [],
    ...history.map((turn) => ({ kind: "turn", turn }))
  ];
  return /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx5(Transcript, { items: transcriptItems }),
    /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", minHeight: fillerMinHeight > 0 ? fillerMinHeight : void 0, justifyContent: "flex-end", children: [
      pending2 && /* @__PURE__ */ jsx5(Box5, { marginBottom: 1, children: /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: "Thinking\u2026" }) }),
      error && /* @__PURE__ */ jsx5(Box5, { marginBottom: 1, children: /* @__PURE__ */ jsxs5(Text5, { color: "red", children: [
        "Error: ",
        error
      ] }) }),
      popoverOpen && /* @__PURE__ */ jsx5(CommandPopover, { query: input.value, selectedIndex: popoverIndex }),
      /* @__PURE__ */ jsx5(
        MultilineInput,
        {
          state: input,
          onChange: handleChange,
          onSubmit: handleSubmit,
          placeholder: "Type a message, or / for commands\u2026",
          disabled: pending2,
          suppressVerticalNav: popoverOpen,
          interceptEnter: popoverInterceptsEnter,
          onCycleAgent: handleCycleAgent
        }
      ),
      renderFooter(workspaceName, branch, footerAgent, columns)
    ] })
  ] });
}
function estimateTurnRows(turn, columns) {
  const width = Math.max(1, columns);
  const text3 = turn.text === "" ? " " : turn.text;
  const wrappedLines = text3.split("\n").reduce((sum, line) => sum + Math.max(1, wrapAnsi(line, width, { hard: false, trim: false }).split("\n").length), 0);
  return 1 + wrappedLines + 1;
}
function renderFooter(workspaceName, branch, footerAgent, columns) {
  const left = `${workspaceName}${branch ? ` (${branch})` : ""}`;
  const right = `${footerAgent} \xB7 enter send \xB7 \\ + enter newline \xB7 / commands \xB7 shift+tab agent`;
  const width = Math.max(10, columns);
  if (left.length + right.length + 2 <= width) {
    return /* @__PURE__ */ jsxs5(Box5, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: left }),
      /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: right })
    ] });
  }
  return /* @__PURE__ */ jsxs5(Box5, { flexDirection: "column", children: [
    wrapAnsi(left, width, { hard: false, trim: false }).split("\n").map((line, i) => /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: line }, `l${i}`)),
    wrapAnsi(right, width, { hard: false, trim: false }).split("\n").map((line, i) => /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: line }, `r${i}`))
  ] });
}
var init_InkApp = __esm({
  "src/ui/ink/InkApp.tsx"() {
    "use strict";
    init_home();
    init_inputBuffer();
    init_MultilineInput();
    init_CommandPopover();
    init_Transcript();
    init_WelcomeBanner();
    init_useTerminalSize();
  }
});

// src/ui/ink/runInkApp.ts
var runInkApp_exports = {};
__export(runInkApp_exports, {
  runInkApp: () => runInkApp
});
import React2 from "react";
import { render } from "ink";
function canUseInkTui() {
  return Boolean(process.stdin.isTTY) && process.stdin.setRawMode !== void 0;
}
async function runInkApp(options) {
  if (!canUseInkTui()) {
    console.error(
      "--tui=ink needs a real interactive terminal (raw-mode stdin) \u2014 this one doesn't have it (piped input, --non-interactive, or a non-TTY runner). Falling back is automatic for everything else; for this shell specifically, drop --tui or pass --tui=legacy."
    );
    return { resized: false, agentCycled: false };
  }
  const stdout = process.stdout;
  const liveStatusRef = { current: { input: options.initialInput ?? initialInputState(), pending: false } };
  let resized = false;
  let agentCycled = false;
  let suppressing = false;
  let settleTimer;
  const instanceRef = {};
  const requestAgentCycleRemount = () => {
    agentCycled = true;
    instanceRef.current?.unmount();
  };
  const instance = render(React2.createElement(InkApp, { ...options, liveStatusRef, onAgentCycleRemount: requestAgentCycleRemount }));
  instanceRef.current = instance;
  const originalWrite = stdout.write;
  const beginSuppressing = () => {
    if (suppressing) return;
    suppressing = true;
    stdout.write = (() => true);
  };
  const stopSuppressing = () => {
    if (!suppressing) return;
    suppressing = false;
    stdout.write = originalWrite;
  };
  const attemptUnmount = () => {
    if (liveStatusRef.current.pending) {
      settleTimer = setTimeout(attemptUnmount, 300);
      return;
    }
    resized = true;
    instance.unmount();
  };
  const onResizeEvent = () => {
    beginSuppressing();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(attemptUnmount, 220);
  };
  stdout.prependListener("resize", onResizeEvent);
  await instance.waitUntilExit();
  stdout.off("resize", onResizeEvent);
  if (settleTimer) clearTimeout(settleTimer);
  stopSuppressing();
  if (resized) {
    stdout.write("\x1B[2J\x1B[3J\x1B[H");
  }
  return { resized, agentCycled, input: resized || agentCycled ? liveStatusRef.current.input : void 0 };
}
var init_runInkApp = __esm({
  "src/ui/ink/runInkApp.ts"() {
    "use strict";
    init_InkApp();
    init_inputBuffer();
  }
});

// src/cli/run.ts
var run_exports = {};
__export(run_exports, {
  CLAUDE_MODEL_ALIASES: () => CLAUDE_MODEL_ALIASES,
  MODEL_LISTERS: () => MODEL_LISTERS,
  WORKER_CYCLE: () => WORKER_CYCLE,
  cycleWorkerSelection: () => cycleWorkerSelection,
  historyTranscript: () => historyTranscript,
  nextInCycle: () => nextInCycle,
  recentHistory: () => recentHistory,
  registerRun: () => registerRun,
  resolveChatReply: () => resolveChatReply,
  runInteractive: () => runInteractive,
  shouldRemountInkSession: () => shouldRemountInkSession
});
import path24 from "path";
import os3 from "os";
import { promises as fs23 } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { emitKeypressEvents } from "readline";
import { createInterface } from "readline/promises";
import pc4 from "picocolors";
function registerRun(program) {
  program.command("run").description("run a workflow on the workspace").argument("[objective...]", "what to investigate / fix").option("--workflow <name>", "workflow preset (e.g. permission-bug, bug-fix)").option("--mode <mode>", "auto | parallel | sequential | single-worker | manual").option("--worker <id>", "with --mode single-worker: the worker/agent to use").option("--parallel <n>", "max concurrent assignments").option("--skip <phase>", "skip a phase / node / role (repeatable)", collect, []).option("--route <role=worker>", "per-task route override (repeatable)", collect, []).option("--disable-worker <id>", "exclude a worker for this task (repeatable)", collect, []).option("--category <name>", "task category for task-type defaults", "general").option("--profile <name>", "apply a saved routing profile").option("--native-provider <key>", "override the native worker provider config key").option("--criteria <text>", "an acceptance criterion (repeatable)", collect, []).option("--no-isolate-writes", "let writers modify the main tree instead of a worktree").option("-y, --yes", "skip the routing confirmation prompt").action(async (objectiveParts, opts) => {
    const g = program.opts();
    const objective = objectiveParts.join(" ").trim();
    if (!objective) throw Object.assign(new Error('Provide an objective: gr-agent run "<task>"'), {});
    await execute(objective, opts, g);
  });
}
async function resolveGreetingName() {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--global", "user.name"], { timeout: 1500 });
    const name = stdout.trim();
    if (name) return name;
  } catch {
  }
  try {
    const name = os3.userInfo().username?.trim();
    if (name) return name;
  } catch {
  }
  return "there";
}
async function detectNativeProvider() {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  const ollamaUrl = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
  const ollamaUp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  return ollamaUp ? "ollama" : "no provider";
}
async function resolveAgentModelLabel(agent, configuredModel, config) {
  if (agent === "native") {
    try {
      const resolved = resolveNativeProvider(config);
      return resolved.model && resolved.model !== "default" ? resolved.model : resolved.provider.defaultModel;
    } catch {
      return void 0;
    }
  }
  if (configuredModel && configuredModel !== "default") return configuredModel;
  const manifest = await loadManifest().catch(() => null);
  return manifest?.integrations[agent]?.defaultModelLabel;
}
async function buildHomeModel(g) {
  const workspaceRoot = path24.resolve(g.workspace ?? process.cwd());
  await Platform.loadDotEnv(workspaceRoot);
  const loaded = await loadConfig(workspaceRoot);
  const state2 = await detectWorkspaceState(workspaceRoot);
  const git = state2.repoRoot ? await Git.open(state2.repoRoot) : null;
  const branch = git ? await git.currentBranch().catch(() => null) : null;
  const store = new RiqsStore(workspaceRoot);
  const recentTasks = await store.listCheckpoints().then((list) => list.slice(0, 5).map(checkpointToRecentTask)).catch(() => []);
  const enabledAgents = Object.entries(loaded.agents.agents).filter(([, a]) => a.enabled).map(([id]) => id);
  const agent = loaded.config.primaryWorker ?? enabledAgents[0] ?? "native";
  const provider = await detectNativeProvider();
  const agentModel = await resolveAgentModelLabel(agent, loaded.agents.agents[agent]?.model, loaded.config);
  return {
    version: "0.1.0",
    workspaceRoot,
    workspaceName: deriveWorkspaceName(workspaceRoot),
    branch,
    repositories: state2.hasRepo ? 1 : 0,
    mode: loaded.config.mode,
    agent,
    agentModel,
    provider,
    ready: loaded.initialised && provider !== "no provider",
    initialised: loaded.initialised,
    hasRepo: state2.hasRepo,
    stack: state2.stack,
    recentTasks
  };
}
function isRealTty() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
function clearScreen() {
  process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
}
function placeCursorInComposer(composerValue) {
  const col = visibleLength(renderHomePrompt()) + composerValue.length;
  process.stdout.write(`\x1B[3A\r` + (col > 0 ? `\x1B[${col}C` : ""));
}
function reclaimStdinAfterInk() {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  stdin.ref();
  stdin.resume();
  stdin.read(0);
}
async function dispatchInkCommand(command, g, tty, model) {
  const { cmd, args } = command;
  if (cmd === "/help") {
    await showOverlay("Commands", HELP_LINES, tty);
  } else if (cmd === "/plan" || cmd === "/spec") {
    await runGenerateDoc(cmd === "/plan" ? "plan" : "spec", args, g, tty);
  } else if (cmd === "/setup") {
    await runSetupInit(g, tty, model.initialised);
  } else if (cmd === "/clone") {
    await runCloneRepo(g, tty);
  } else if (cmd === "/agents") {
    await runSelectWorker(g, tty, model.initialised);
  } else if (cmd === "/model") {
    await runSelectModel(g, tty, model.initialised);
  } else if (cmd === "/mode") {
    pending.mode = args[0];
    await showOverlay("Mode", [`Next /implement's mode: ${pending.mode ?? "(default)"}`], tty);
  } else if (cmd === "/implement") {
    const objective = args.join(" ").trim();
    if (!objective) {
      await showOverlay("Implement", ["Usage: /implement <task>", "", "Example: /implement fix the login redirect bug"], tty);
      return;
    }
    if (tty) clearScreen();
    else process.stdout.write("\n");
    const runModel = { ...model };
    const drawRun = () => {
      if (tty) clearScreen();
      process.stdout.write(renderHome(runModel, { value: "" }));
      if (tty) placeCursorInComposer("");
    };
    const ensureStarted = () => {
      if (runModel.runLog === void 0) {
        runModel.runLog = [];
        runModel.runObjective = objective;
        runModel.runPending = true;
      }
    };
    const releaseInput = tty ? captureStdinDuringRun() : () => {
    };
    try {
      await execute(
        objective,
        { mode: pending.mode, skip: [], route: [], disableWorker: [], criteria: [] },
        g,
        tty ? {
          onLine: (line) => {
            ensureStarted();
            runModel.runLog.push(line);
            drawRun();
          },
          onStatus: (frame) => {
            ensureStarted();
            runModel.runStatus = frame;
            drawRun();
          }
        } : void 0
      );
    } catch {
    } finally {
      releaseInput();
      runModel.runPending = false;
      if (runModel.runLog !== void 0) drawRun();
    }
    pending.mode = void 0;
    await endOverlay(tty);
  }
}
async function runInkInteractive(g, model) {
  const chatHistory = [];
  let current = model;
  current.chatHistory = chatHistory;
  const tty = isRealTty();
  if (tty) clearScreen();
  let showWelcome = true;
  let carryInput;
  const greetingName = await resolveGreetingName();
  const home = os3.homedir();
  const cwdDisplay = current.workspaceRoot.startsWith(home) ? `~${current.workspaceRoot.slice(home.length)}` : current.workspaceRoot;
  for (; ; ) {
    let pendingCommand = null;
    const { runInkApp: runInkApp2 } = await Promise.resolve().then(() => (init_runInkApp(), runInkApp_exports));
    const inkResult = await runInkApp2({
      workspaceName: current.workspaceName,
      branch: current.branch,
      agent: current.agent,
      agentModel: current.agentModel,
      version: current.version,
      mode: current.mode,
      showWelcome,
      userName: greetingName,
      cwdDisplay,
      initialHistory: [...chatHistory],
      initialInput: carryInput,
      onSubmit: async (text3) => {
        if (text3 === "/quit" || text3 === "/exit") return null;
        if (text3.startsWith("/")) {
          const [cmd, ...rest] = text3.split(/\s+/);
          if (cmd && INK_RECOGNIZED_COMMANDS.has(cmd)) {
            pendingCommand = { cmd, args: rest };
            return null;
          }
          return {
            text: `${cmd} isn't available in the Ink shell yet \u2014 restart with --tui=legacy for the full command palette.`
          };
        }
        chatHistory.push({ role: "user", text: text3 });
        const reply = await resolveChatReply(text3, g, chatHistory);
        chatHistory.push({ role: "assistant", text: reply.text, agent: reply.agent });
        return reply;
      },
      onCycleAgent: () => cycleWorkerSelection(current, g)
    });
    const { agentCycled, input } = inkResult;
    reclaimStdinAfterInk();
    if (shouldRemountInkSession(inkResult)) {
      carryInput = input;
      if (agentCycled && tty) clearScreen();
      continue;
    }
    if (!pendingCommand) return;
    showWelcome = false;
    carryInput = void 0;
    await dispatchInkCommand(pendingCommand, g, tty, current);
    current = await buildHomeModel(g);
    current.chatHistory = chatHistory;
    if (tty) clearScreen();
  }
}
async function runInteractive(g) {
  const chatHistory = [];
  let model = await buildHomeModel(g);
  model.chatHistory = chatHistory;
  if (g.tui === "ink") {
    await runInkInteractive(g, model);
    return;
  }
  const refreshModel = async () => {
    const { runLog, runObjective, runPending, runStatus } = model;
    model = await buildHomeModel(g);
    model.chatHistory = chatHistory;
    model.runLog = runLog;
    model.runObjective = runObjective;
    model.runPending = runPending;
    model.runStatus = runStatus;
  };
  const tty = isRealTty();
  for (; ; ) {
    if (!tty) process.stdout.write(renderHome(model));
    const input = (await readHomeMessage(model, g))?.trim();
    if (input === void 0 || input === "" || input === "/quit" || input === "/exit") {
      outro2("Bye.");
      return;
    }
    if (input === RUN_INIT_ACTION) {
      await runSetupInit(g, tty, model.initialised);
      await refreshModel();
      continue;
    }
    if (input === RUN_CLONE_ACTION) {
      await runCloneRepo(g, tty);
      await refreshModel();
      continue;
    }
    if (input.startsWith("/")) {
      const [cmd, ...rest] = input.split(/\s+/);
      if (cmd === "/help") {
        await showOverlay("Commands", HELP_LINES, tty);
      } else if (cmd === "/plan" || cmd === "/spec") {
        await runGenerateDoc(cmd === "/plan" ? "plan" : "spec", rest, g, tty);
        await refreshModel();
      } else if (cmd === "/setup") {
        await runSetupInit(g, tty, model.initialised);
        await refreshModel();
      } else if (cmd === "/clone") {
        await runCloneRepo(g, tty);
        await refreshModel();
      } else if (cmd === "/agents") {
        await runSelectWorker(g, tty, model.initialised);
        await refreshModel();
      } else if (cmd === "/model") {
        await runSelectModel(g, tty, model.initialised);
        await refreshModel();
      } else if (cmd === "/mode") {
        pending.mode = rest[0];
        await showOverlay("Mode", [`Next /implement's mode: ${pending.mode ?? "(default)"}`], tty);
      } else if (cmd === "/implement") {
        const objective = rest.join(" ").trim();
        if (!objective) {
          await showOverlay("Implement", ["Usage: /implement <task>", "", "Example: /implement fix the login redirect bug"], tty);
        } else {
          if (tty) clearScreen();
          else process.stdout.write("\n");
          const drawRun = () => {
            if (tty) clearScreen();
            process.stdout.write(renderHome(model, { value: "" }));
            if (tty) placeCursorInComposer("");
          };
          const ensureStarted = () => {
            if (model.runLog === void 0) {
              model.runLog = [];
              model.runObjective = objective;
              model.runPending = true;
            }
          };
          const releaseInput = tty ? captureStdinDuringRun() : () => {
          };
          try {
            await execute(
              objective,
              { mode: pending.mode, skip: [], route: [], disableWorker: [], criteria: [] },
              g,
              tty ? {
                onLine: (line) => {
                  ensureStarted();
                  model.runLog.push(line);
                  drawRun();
                },
                onStatus: (frame) => {
                  ensureStarted();
                  model.runStatus = frame;
                  drawRun();
                }
              } : void 0
            );
          } catch {
          } finally {
            releaseInput();
            model.runPending = false;
            if (model.runLog !== void 0) drawRun();
          }
          pending.mode = void 0;
          await refreshModel();
        }
      } else {
        await showOverlay("Unknown command", [`${cmd}. Try /help.`], tty);
      }
      continue;
    }
    await runChat(input, model, chatHistory, g, tty);
  }
}
async function endOverlay(tty) {
  if (tty) {
    process.stdout.write(`
${pc4.dim("Press any key to continue\u2026")}`);
    await waitForKey();
  } else {
    process.stdout.write("\n");
  }
}
async function runSetupInit(g, tty, initialised) {
  if (tty) clearScreen();
  else process.stdout.write("\n");
  const defaultParent = path24.resolve(g.workspace ?? process.cwd());
  if (!interactive()) {
    if (!initialised) logScaffoldResult(await scaffoldWorkspace(defaultParent));
    await endOverlay(tty);
    return;
  }
  if (initialised) {
    log.info(pc4.bold("Workspace setup"));
    log.info(pc4.dim(`Already set up at ${defaultParent}.`));
    log.info("");
    const choice = await select2("What would you like to do?", [
      { value: "switch", label: "Create / switch to a different project folder" },
      { value: "remove", label: "Remove the current setup (.gr-agent/)" },
      { value: "cancel", label: "Cancel" }
    ]);
    if (choice === "remove") {
      const paths = new RiqsPaths(defaultParent);
      const removed = await confirm2(`Delete ${paths.dir}? This cannot be undone.`, false);
      if (removed) {
        await fs23.rm(paths.dir, { recursive: true, force: true });
        log.success(`Removed ${paths.dir}. This workspace is no longer initialised.`);
      } else {
        log.warn("Cancelled \u2014 nothing removed.");
      }
      await endOverlay(tty);
      return;
    }
    if (choice !== "switch") {
      log.warn("Cancelled.");
      await endOverlay(tty);
      return;
    }
  }
  log.info(pc4.bold(initialised ? "Switch project folder" : "New gR DEV AGENT workspace"));
  log.info(pc4.dim("Where should the project folder be created?"));
  log.info("");
  const parentInput = await text2("Parent directory", defaultParent);
  if (parentInput === null) {
    log.warn("Setup cancelled.");
    await endOverlay(tty);
    return;
  }
  const parent = path24.resolve(parentInput.trim() || defaultParent);
  const folderName = await text2("New folder name", "my-project");
  if (!folderName || !folderName.trim()) {
    log.warn("Setup cancelled \u2014 no folder name given.");
    await endOverlay(tty);
    return;
  }
  const targetDir = path24.resolve(parent, folderName.trim());
  const alreadyExists = await fs23.stat(targetDir).then((s) => s.isDirectory()).catch(() => false);
  if (alreadyExists) {
    log.info(`Using existing folder: ${targetDir}`);
  } else {
    await fs23.mkdir(targetDir, { recursive: true });
    log.success(`Created folder: ${targetDir}`);
  }
  logScaffoldResult(await scaffoldWorkspace(targetDir));
  g.workspace = targetDir;
  log.info(pc4.dim(`
Workspace switched to ${targetDir}`));
  await endOverlay(tty);
}
async function runCloneRepo(g, tty) {
  if (tty) clearScreen();
  else process.stdout.write("\n");
  const root = path24.resolve(g.workspace ?? process.cwd());
  if (!interactive()) {
    log.warn("Cannot ask for a repository URL in non-interactive mode \u2014 run `git clone <url>` yourself, then re-run.");
    await endOverlay(tty);
    return;
  }
  log.info(pc4.bold("Clone a repository"));
  log.info(pc4.dim(`Into a new folder under: ${root}`));
  log.info("");
  const url = await text2("Git URL (https:// or git@...)", "https://github.com/org/repo.git");
  if (!url || !url.trim()) {
    log.warn("Cancelled \u2014 no URL given.");
    await endOverlay(tty);
    return;
  }
  const gitExe = await Platform.findExecutable("git");
  if (!gitExe) {
    log.error("git was not found on PATH \u2014 install Git, then try /clone again.");
    await endOverlay(tty);
    return;
  }
  log.step(`git clone ${url.trim()}`);
  const res = await Platform.run(gitExe, ["clone", url.trim()], { cwd: root, inherit: true, timeoutMs: 15 * 6e4 });
  if (res.exitCode === 0) {
    log.success("Repository cloned.");
  } else {
    log.error(`git clone exited with code ${res.exitCode}.`);
  }
  await endOverlay(tty);
}
async function runSelectWorker(g, tty, initialised) {
  if (tty) clearScreen();
  else process.stdout.write("\n");
  if (!initialised) {
    log.warn("Run /setup first \u2014 worker choice is saved into .gr-agent/config.json.");
    await endOverlay(tty);
    return;
  }
  if (!interactive()) {
    log.warn("Cannot prompt for a worker in non-interactive mode. Use `gr-agent workers enable <id>` and `gr-agent run --worker <id>` instead.");
    await endOverlay(tty);
    return;
  }
  const root = path24.resolve(g.workspace ?? process.cwd());
  log.info(pc4.bold("Choose a worker"));
  log.info(pc4.dim("Checking installed agent CLIs and the native provider\u2026"));
  log.info("");
  const [statuses, nativeProvider] = await Promise.all([detectAll(), detectNativeProvider()]);
  const options = [
    { value: "native", label: `Native \u2014 ${nativeProvider === "no provider" ? "no provider configured" : `ready (${nativeProvider})`}` },
    ...statuses.map((s) => ({ value: s.id, label: `${s.displayName} \u2014 ${READINESS_LABEL[s.readiness] ?? s.readiness}` }))
  ];
  const choice = await select2("Use which worker for tasks in this workspace?", options);
  if (!choice) {
    log.warn("Cancelled.");
    await endOverlay(tty);
    return;
  }
  const chosenStatus = statuses.find((s) => s.id === choice);
  const chosenReady = choice === "native" ? nativeProvider !== "no provider" : chosenStatus?.readiness === "ready";
  if (!chosenReady) {
    const label = choice === "native" ? "Native" : chosenStatus?.displayName ?? choice;
    log.warn(`${label} is not fully ready yet.`);
    if (choice === "native") {
      log.info("Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY, or run a local Ollama.");
    } else if (chosenStatus?.readiness === "missing") {
      log.info(`Install it: gr-agent integrations install ${choice}   (or run \`gr-agent integrations setup\`)`);
    } else if (chosenStatus?.readiness === "login_required") {
      log.info(`Sign in: gr-agent auth login ${choice}`);
    } else {
      log.info(`Check it: gr-agent integrations verify ${choice}`);
    }
    const proceed = await confirm2("Select it anyway? Tasks will fall back to a manual handoff until it's ready.", false);
    if (!proceed) {
      await endOverlay(tty);
      return;
    }
  }
  const loaded = await loadConfig(root);
  const existing = loaded.workers.workers[choice] ?? { enabled: true, roles: [], capabilities: [] };
  loaded.workers.workers[choice] = { ...existing, enabled: true };
  loaded.config.primaryWorker = choice;
  await writeWorkers(loaded.paths, loaded.workers);
  await writeConfig(loaded.paths, loaded.config);
  log.success(`${choice} is now the primary worker for this workspace (saved to .gr-agent/config.json).`);
  log.info(pc4.dim("Change it any time with /agents. This doesn't disable other enabled workers for other roles."));
  await endOverlay(tty);
}
async function runSelectModel(g, tty, initialised) {
  if (tty) clearScreen();
  else process.stdout.write("\n");
  if (!initialised) {
    log.warn("Run /setup first \u2014 the model choice is saved into .gr-agent/agents.json.");
    await endOverlay(tty);
    return;
  }
  if (!interactive()) {
    log.warn("Cannot prompt for a model in non-interactive mode. Edit .gr-agent/agents.json directly instead.");
    await endOverlay(tty);
    return;
  }
  const root = path24.resolve(g.workspace ?? process.cwd());
  const loaded = await loadConfig(root);
  const workerId = loaded.config.primaryWorker ?? "native";
  if (workerId === "native") {
    log.warn("The native worker's model comes from .gr-agent/config.json (native.default / native.providers), not /model.");
    log.info(pc4.dim("Pick a CLI-based worker with /agents (or tab) first if you want to choose its model here."));
    await endOverlay(tty);
    return;
  }
  const manifest = await loadManifest().catch(() => null);
  const entry = manifest?.integrations[workerId];
  const displayName = entry?.displayName ?? workerId;
  const currentModel = loaded.agents.agents[workerId]?.model;
  const currentModelValue = currentModel && currentModel !== "default" ? currentModel : void 0;
  let choice = null;
  let pickerShown = false;
  const lister = MODEL_LISTERS[workerId];
  if (lister?.staticOptions) {
    pickerShown = true;
    choice = await autocomplete2(`Model for ${displayName}:`, lister.staticOptions, currentModelValue);
  } else if (lister?.args && lister.parse && entry) {
    let exe = null;
    for (const name of entry.executables) {
      exe = await Platform.findExecutable(name);
      if (exe) break;
    }
    if (exe) {
      log.info(pc4.dim(`Checking ${displayName}'s available models\u2026`));
      try {
        const run = await Platform.run(exe, lister.args, { cwd: root, timeoutMs: 2e4 });
        const options = lister.parse(stripAnsi(run.stdout));
        if (options.length > 0) {
          pickerShown = true;
          choice = await autocomplete2(`Model for ${displayName}:`, options, currentModelValue);
        } else log.warn(`${displayName} didn't return a model list \u2014 falling back to typing one in.`);
      } catch {
        log.warn(`Couldn't list ${displayName}'s models \u2014 falling back to typing one in.`);
      }
    }
  }
  if (choice === null && !pickerShown) {
    if (workerId === "claude") {
      const pick = await autocomplete2(
        `Model for ${displayName}:`,
        [...CLAUDE_MODEL_ALIASES, { value: "__other__", label: "Other \u2014 type a full model name" }],
        currentModelValue
      );
      choice = pick === "__other__" ? await text2("Model name (e.g. claude-sonnet-4-5-20250929):") : pick;
    } else {
      log.warn(`No verified way to list ${displayName}'s models \u2014 check its own docs, then type one in.`);
      choice = await text2(`Model for ${displayName}:`);
    }
  }
  if (!choice) {
    log.warn("Cancelled.");
    await endOverlay(tty);
    return;
  }
  const existing = loaded.agents.agents[workerId] ?? { worker: workerId, model: "default", enabled: true, roles: [], skills: [], capabilities: [] };
  loaded.agents.agents[workerId] = { ...existing, worker: workerId, model: choice };
  await writeAgents(loaded.paths, loaded.agents);
  log.success(`${displayName} will use "${choice}" from now on (saved to .gr-agent/agents.json).`);
  log.info(pc4.dim("Change it any time with /model. Switching workers with /agents or tab doesn't clear this."));
  await endOverlay(tty);
}
function recentHistory(chatHistory) {
  return chatHistory.slice(0, -1).slice(-CHAT_HISTORY_TURNS);
}
function historyTranscript(chatHistory) {
  const prior = recentHistory(chatHistory);
  if (prior.length === 0) return "";
  const lines2 = prior.map((t) => t.role === "user" ? `User: ${t.text}` : `${t.agent ?? "Assistant"}: ${t.text}`);
  return `Conversation so far (you may have been a different agent for earlier turns):
${lines2.join("\n")}

`;
}
async function resolveChatReply(input, g, chatHistory) {
  const root = path24.resolve(g.workspace ?? process.cwd());
  await Platform.loadDotEnv(root);
  const loaded = await loadConfig(root);
  const workerId = loaded.config.primaryWorker ?? "native";
  const configuredModel = loaded.agents.agents[workerId]?.model;
  const { text: expandedInput } = await expandAttachments(input, root);
  return (workerId !== "native" ? await chatViaAgentCli(workerId, expandedInput, root, configuredModel, chatHistory) : null) ?? await chatViaNativeProvider(expandedInput, loaded.config, chatHistory);
}
async function runChat(input, model, chatHistory, g, tty) {
  model.runLog = void 0;
  chatHistory.push({ role: "user", text: input });
  const draw = (pending2) => {
    if (tty) clearScreen();
    process.stdout.write(renderHome({ ...model, chatHistory, chatPending: pending2 }, { value: "" }));
    if (tty) placeCursorInComposer("");
  };
  draw(true);
  const releaseInput = tty ? captureStdinWhilePending() : () => {
  };
  let reply;
  try {
    reply = await resolveChatReply(input, g, chatHistory);
  } catch (e) {
    reply = { text: `Something went wrong: ${e.message}

To run this as a real task instead: /implement ${input}` };
  } finally {
    releaseInput();
  }
  chatHistory.push({ role: "assistant", text: reply.text, agent: reply.agent });
  draw(false);
}
function captureStdinWhilePending() {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {
  };
  const wasRaw = stdin.isRaw;
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  const onKeypress = (_str, key) => {
    if (key.ctrl && key.name === "c") {
      outro2("Bye.");
      process.exit(0);
    }
  };
  stdin.on("keypress", onKeypress);
  return () => {
    stdin.off("keypress", onKeypress);
    if (!wasRaw) stdin.setRawMode(false);
  };
}
function captureStdinDuringRun() {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {
  };
  const wasRaw = stdin.isRaw;
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  const onKeypress = (_str, key) => {
    if (key.ctrl && key.name === "c") process.kill(process.pid, "SIGINT");
  };
  stdin.on("keypress", onKeypress);
  return () => {
    stdin.off("keypress", onKeypress);
    if (!wasRaw) stdin.setRawMode(false);
  };
}
async function chatViaAgentCli(workerId, input, root, configuredModel, chatHistory) {
  const manifest = await loadManifest().catch(() => null);
  const entry = manifest?.integrations[workerId];
  if (!entry) return null;
  const modelForLabel = (configuredModel && configuredModel !== "default" ? configuredModel : void 0) ?? entry.defaultModelLabel;
  const label = modelForLabel ? `${entry.displayName} (${modelForLabel})` : entry.displayName;
  let exe = null;
  for (const name of entry.executables) {
    exe = await Platform.findExecutable(name);
    if (exe) break;
  }
  if (!exe) return null;
  const prompt = CHAT_CLI_PREFIX + historyTranscript(chatHistory) + `User: ${input}`;
  let promptFile;
  if (entry.worker.promptDelivery === "file") {
    promptFile = path24.join(Platform.tmpDir(), `gr-agent-chat-${Date.now()}.txt`);
    await fs23.writeFile(promptFile, prompt, "utf8");
  }
  const modelValue = configuredModel && configuredModel !== "default" ? configuredModel : void 0;
  const argv = [];
  for (const raw of entry.worker.argv) {
    const t = raw === "{prompt}" ? prompt : raw === "{promptFile}" ? promptFile ?? "" : raw;
    if (t === "{model}") {
      if (modelValue) argv.push(modelValue);
      else argv.pop();
      continue;
    }
    if (t === "" || t.startsWith("{") && t.endsWith("}")) continue;
    argv.push(t);
  }
  try {
    const run = await Platform.run(exe, argv, {
      cwd: root,
      input: entry.worker.promptDelivery === "stdin" ? prompt : void 0,
      timeoutMs: 12e4
    });
    const text3 = stripAnsi(run.stdout).trim();
    if (run.exitCode === 0 && text3) return { text: text3.slice(0, 4e3), agent: label };
    const errText = stripAnsi(run.stderr).trim().slice(0, 800);
    return {
      text: `${entry.displayName} exited ${run.exitCode} with no usable output.${errText ? `
${errText}` : ""}

To run this as a real task instead: /implement ${input}`,
      agent: label
    };
  } catch (e) {
    return { text: `${e.message}

To run this as a real task instead: /implement ${input}`, agent: label };
  } finally {
    if (promptFile) await fs23.rm(promptFile, { force: true }).catch(() => {
    });
  }
}
async function chatViaNativeProvider(input, config, chatHistory) {
  let resolved;
  try {
    resolved = resolveNativeProvider(config);
  } catch (e) {
    return {
      text: `${e.message}

Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY, or run a local Ollama.

To run this as a real task instead: /implement ${input}`
    };
  }
  const modelName = resolved.model && resolved.model !== "default" ? resolved.model : resolved.provider.defaultModel;
  const label = `Native (${modelName})`;
  const messages = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...recentHistory(chatHistory).map((t) => ({ role: t.role === "user" ? "user" : "assistant", content: t.text })),
    { role: "user", content: input }
  ];
  try {
    const res = await resolved.provider.chat(messages, { maxOutputTokens: 800 });
    return { text: res.text.trim() || "(empty response)", agent: label };
  } catch (e) {
    return { text: `${e.message}

To run this as a real task instead: /implement ${input}`, agent: label };
  }
}
function slugify(objective) {
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const words = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${stamp}-${words || "untitled"}`;
}
async function generateWorkerDocument(kind, objective, g) {
  const root = path24.resolve(g.workspace ?? process.cwd());
  await Platform.loadDotEnv(root);
  const loaded = await loadConfig(root);
  const workerId = loaded.config.primaryWorker ?? "native";
  const configuredModel = loaded.agents.agents[workerId]?.model;
  const systemPrompt = kind === "plan" ? PLAN_DOC_SYSTEM_PROMPT : SPEC_DOC_SYSTEM_PROMPT;
  const { text: expandedObjective } = await expandAttachments(objective, root);
  const viaCli = workerId !== "native" ? await docViaAgentCli(workerId, systemPrompt, expandedObjective, root, configuredModel) : null;
  return viaCli ?? await docViaNativeProvider(systemPrompt, expandedObjective, loaded.config);
}
async function docViaAgentCli(workerId, systemPrompt, objective, root, configuredModel) {
  const manifest = await loadManifest().catch(() => null);
  const entry = manifest?.integrations[workerId];
  if (!entry) return null;
  const modelForLabel = (configuredModel && configuredModel !== "default" ? configuredModel : void 0) ?? entry.defaultModelLabel;
  const label = modelForLabel ? `${entry.displayName} (${modelForLabel})` : entry.displayName;
  let exe = null;
  for (const name of entry.executables) {
    exe = await Platform.findExecutable(name);
    if (exe) break;
  }
  if (!exe) return null;
  const prompt = `${systemPrompt}

Task:
${objective}`;
  let promptFile;
  if (entry.worker.promptDelivery === "file") {
    promptFile = path24.join(Platform.tmpDir(), `gr-agent-doc-${Date.now()}.txt`);
    await fs23.writeFile(promptFile, prompt, "utf8");
  }
  const modelValue = configuredModel && configuredModel !== "default" ? configuredModel : void 0;
  const argv = [];
  for (const raw of entry.worker.argv) {
    const t = raw === "{prompt}" ? prompt : raw === "{promptFile}" ? promptFile ?? "" : raw;
    if (t === "{model}") {
      if (modelValue) argv.push(modelValue);
      else argv.pop();
      continue;
    }
    if (t === "" || t.startsWith("{") && t.endsWith("}")) continue;
    argv.push(t);
  }
  try {
    const run = await Platform.run(exe, argv, {
      cwd: root,
      input: entry.worker.promptDelivery === "stdin" ? prompt : void 0,
      timeoutMs: 18e4
    });
    const text3 = stripAnsi(run.stdout).trim();
    if (run.exitCode === 0 && text3) return { text: text3.slice(0, 12e3), agent: label };
    const errText = stripAnsi(run.stderr).trim().slice(0, 800);
    return {
      text: `${entry.displayName} exited ${run.exitCode} with no usable output.${errText ? `
${errText}` : ""}`,
      agent: label
    };
  } catch (e) {
    return { text: `${e.message}`, agent: label };
  } finally {
    if (promptFile) await fs23.rm(promptFile, { force: true }).catch(() => {
    });
  }
}
async function docViaNativeProvider(systemPrompt, objective, config) {
  let resolved;
  try {
    resolved = resolveNativeProvider(config);
  } catch (e) {
    return { text: `${e.message}

Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY, or run a local Ollama.` };
  }
  const modelName = resolved.model && resolved.model !== "default" ? resolved.model : resolved.provider.defaultModel;
  const label = `Native (${modelName})`;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: objective }
  ];
  try {
    const res = await resolved.provider.chat(messages, { maxOutputTokens: 3e3 });
    return { text: res.text.trim() || "(empty response)", agent: label };
  } catch (e) {
    return { text: `${e.message}`, agent: label };
  }
}
async function runGenerateDoc(kind, args, g, tty) {
  const objective = args.join(" ").trim();
  const label = kind === "plan" ? "Plan" : "Spec";
  if (!objective) {
    await showOverlay(label, [`Usage: /${kind} <description>`, "", `Example: /${kind} add rate limiting to the login endpoint`], tty);
    return;
  }
  if (tty) clearScreen();
  process.stdout.write(
    `
${pc4.bold(label)}

${pc4.dim(`Writing a ${kind} for: ${objective}`)}
${pc4.dim("Using your configured worker \u2014 this can take a little while\u2026")}
`
  );
  let reply;
  try {
    reply = await generateWorkerDocument(kind, objective, g);
  } catch (e) {
    reply = { text: `Something went wrong: ${e.message}` };
  }
  const root = path24.resolve(g.workspace ?? process.cwd());
  const paths = new RiqsPaths(root);
  const dir = kind === "plan" ? paths.plansDir() : paths.specsDir();
  await fs23.mkdir(dir, { recursive: true });
  const slug = slugify(objective);
  const filePath = kind === "plan" ? paths.planDoc(slug) : paths.specDoc(slug);
  const agentLine = reply.agent ? `*Written by ${reply.agent}*

` : "";
  await fs23.writeFile(filePath, `# ${label}: ${objective}

${agentLine}${reply.text}
`, "utf8");
  const relPath = path24.relative(root, filePath) || filePath;
  const bodyLines = reply.text.split("\n");
  const preview = bodyLines.slice(0, 24);
  await showOverlay(`${label} saved`, [`Saved to ${relPath}`, "", ...preview, ...bodyLines.length > preview.length ? ["\u2026"] : []], tty);
}
async function showOverlay(title, lines2, tty) {
  if (tty) clearScreen();
  process.stdout.write(`
${pc4.bold(title)}

${lines2.join("\n")}
`);
  await endOverlay(tty);
}
async function waitForKey() {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  const wasRaw = stdin.isRaw;
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  await new Promise((resolve) => {
    const onKey = () => {
      stdin.off("keypress", onKey);
      if (!wasRaw) stdin.setRawMode(false);
      resolve();
    };
    stdin.once("keypress", onKey);
  });
}
async function readHomeMessage(model, g) {
  if (!interactive()) return null;
  if (isRealTty()) return readHomeSlotMessage(model, g);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(renderHomePrompt());
    if (!process.stdout.isTTY) process.stdout.write("\n");
    return answer;
  } finally {
    rl.close();
  }
}
function nextInCycle(current) {
  const at = WORKER_CYCLE.indexOf(current);
  return WORKER_CYCLE[(at + 1 + WORKER_CYCLE.length) % WORKER_CYCLE.length];
}
function shouldRemountInkSession(result) {
  return result.resized || result.agentCycled;
}
async function cycleWorkerSelection(model, g) {
  if (!model.initialised) return { agent: model.agent, agentModel: model.agentModel };
  const next = nextInCycle(model.agent);
  model.agent = next;
  model.agentModel = void 0;
  try {
    const root = path24.resolve(g.workspace ?? process.cwd());
    const loaded = await loadConfig(root);
    const existing = loaded.workers.workers[next] ?? { enabled: true, roles: [], capabilities: [] };
    loaded.workers.workers[next] = { ...existing, enabled: true };
    loaded.config.primaryWorker = next;
    await writeWorkers(loaded.paths, loaded.workers);
    await writeConfig(loaded.paths, loaded.config);
    model.agentModel = await resolveAgentModelLabel(next, loaded.agents.agents[next]?.model, loaded.config);
  } catch {
  }
  return { agent: model.agent, agentModel: model.agentModel };
}
function cycleWorker(model, g, redraw) {
  if (!model.initialised) return;
  const persisted = cycleWorkerSelection(model, g);
  redraw();
  void persisted.finally(redraw);
}
async function readHomeSlotMessage(model, g) {
  const stdin = process.stdin;
  let value = "";
  let selectedIndex = 0;
  const wasRaw = stdin.isRaw;
  const redraw = () => {
    clearScreen();
    process.stdout.write(renderHome(model, { value, selectedIndex }));
    placeCursorInComposer(value);
  };
  redraw();
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return await new Promise((resolve) => {
    const onResize = () => {
      invalidateSizeCache();
      redraw();
    };
    process.stdout.on("resize", onResize);
    const done = (answer) => {
      stdin.off("keypress", onKeypress);
      process.stdout.off("resize", onResize);
      if (!wasRaw) stdin.setRawMode(false);
      resolve(answer);
    };
    const onKeypress = (str, key) => {
      const menuOpen = isCommandMenuOpen(value);
      const matches = menuOpen ? filterSlashCommands(value) : [];
      const chatting = (model.chatHistory?.length ?? 0) > 0;
      const suggestions = value === "" && !chatting ? getSuggestionList(model) : [];
      if (key.ctrl && key.name === "c") {
        done(null);
        return;
      }
      if (key.ctrl && key.name === "u") {
        value = "";
        selectedIndex = 0;
        redraw();
        return;
      }
      if ((key.name === "tab" || key.ctrl && key.name === "g") && !menuOpen) {
        cycleWorker(model, g, redraw);
        redraw();
        return;
      }
      if ((key.name === "up" || key.name === "down") && (matches.length > 0 || suggestions.length > 0)) {
        const count = menuOpen ? matches.length : suggestions.length;
        const delta = key.name === "up" ? -1 : 1;
        selectedIndex = (selectedIndex + delta + count) % count;
        redraw();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        if (menuOpen && matches.length > 0) {
          const chosen = matches[Math.min(selectedIndex, matches.length - 1)];
          if (value.toLowerCase() !== chosen.id.toLowerCase()) {
            value = `${chosen.id} `;
            selectedIndex = 0;
            redraw();
            return;
          }
          done(value);
          return;
        }
        if (suggestions.length > 0) {
          const chosen = suggestions[Math.min(selectedIndex, suggestions.length - 1)];
          done(resolveSuggestionSubmission(chosen));
          return;
        }
        done(value);
        return;
      }
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        selectedIndex = 0;
        redraw();
        return;
      }
      if (key.name === "escape") {
        if (value) {
          value = "";
          selectedIndex = 0;
          redraw();
        }
        return;
      }
      if (str && !key.ctrl && !key.sequence?.startsWith("\x1B")) {
        value += str;
        selectedIndex = 0;
        redraw();
      }
    };
    stdin.on("keypress", onKeypress);
  });
}
async function execute(objective, opts, g, inline) {
  const ctx = await resolveContext(g);
  let config = ctx.config;
  if (opts.profile) {
    const profile = await loadProfile(ctx.paths, opts.profile);
    config = {
      ...config,
      mode: profile.mode ?? config.mode,
      routingPolicy: profile.routingPolicy ?? config.routingPolicy,
      primaryWorker: profile.primaryWorker ?? config.primaryWorker,
      routing: { ...config.routing, ...profile.routing ?? {} },
      skip: [.../* @__PURE__ */ new Set([...config.skip ?? [], ...profile.skip ?? []])]
    };
  }
  const mode = opts.mode ?? (opts.worker ? "single-worker" : void 0);
  const taskRouting = parseRoutes(opts.route ?? []);
  if (opts.worker && mode === "single-worker") {
    for (const r of ALL_ROLES) taskRouting[r] = opts.worker;
  }
  const input = {
    objective,
    category: opts.category,
    workflow: opts.workflow,
    mode,
    parallelism: opts.parallel ? Number(opts.parallel) : void 0,
    skip: opts.skip ?? [],
    taskRouting,
    disabledWorkers: opts.disableWorker ?? [],
    acceptanceCriteria: opts.criteria ?? [],
    nativeProviderOverride: opts.nativeProvider,
    isolateWrites: opts.isolateWrites
  };
  if (!opts.yes && !ctx.nonInteractive) {
    log.info("\n" + table(["setting", "value"], [
      ["objective", objective],
      ["workflow", opts.workflow ?? "(auto plan)"],
      ["mode", mode ?? config.mode],
      ["routing policy", config.routingPolicy],
      ["per-task routes", Object.entries(taskRouting).map(([r, w]) => `${r}=${w}`).join(", ") || "-"],
      ["disabled workers", (opts.disableWorker ?? []).join(", ") || "-"],
      ["skip", (input.skip ?? []).join(", ") || "-"]
    ]));
    log.info(pc4.dim('This runs real AI worker calls (API/CLI usage) \u2014 even a short objective like "hello" gets a full investigate \u2192 implement \u2192 test \u2192 review plan unless you pass --workflow/--skip.'));
    const ok = await confirm2("Proceed with this workflow?", true);
    if (!ok) {
      log.warn("Cancelled.");
      return;
    }
  }
  const controller = new AbortController();
  const onSig = () => controller.abort();
  process.once("SIGINT", onSig);
  const orch = new Orchestrator({
    workspaceRoot: ctx.workspaceRoot,
    config,
    workers: ctx.workers,
    agents: ctx.agents,
    nonInteractive: ctx.nonInteractive,
    signal: controller.signal
  });
  if (inline) {
    setLogSink(inline.onLine);
    setSpinnerSink(inline.onStatus);
  }
  try {
    const { task, reportPath, model } = await orch.run(input);
    process.off("SIGINT", onSig);
    log.info("");
    log.success(`Task ${task.taskId}: ${task.state}`);
    log.info(`Confirmed root causes: ${model.confirmed.length} \xB7 supported: ${model.supported.length} \xB7 contradictions: ${model.contradictions.length}`);
    log.info(`Report: ${reportPath}`);
    if (g.json) process.stdout.write(JSON.stringify({ taskId: task.taskId, state: task.state, reportPath }) + "\n");
  } catch (e) {
    process.off("SIGINT", onSig);
    if (inline) inline.onLine(`\u2717 ${e.message}`);
    throw e;
  } finally {
    if (inline) {
      setLogSink(void 0);
      setSpinnerSink(void 0);
    }
  }
}
function parseRoutes(pairs) {
  const out = {};
  for (const p of pairs) {
    const [role, workers] = p.split("=");
    if (!role || !workers) continue;
    const list = workers.split(",").map((s) => s.trim()).filter(Boolean);
    out[role] = list.length > 1 ? list : list[0];
  }
  return out;
}
function collect(value, previous) {
  return [...previous, value];
}
var execFileAsync, pending, HELP_LINES, INK_RECOGNIZED_COMMANDS, READINESS_LABEL, MODEL_LISTERS, CLAUDE_MODEL_ALIASES, CHAT_SYSTEM_PROMPT, CHAT_CLI_PREFIX, CHAT_HISTORY_TURNS, PLAN_DOC_SYSTEM_PROMPT, SPEC_DOC_SYSTEM_PROMPT, WORKER_CYCLE, ALL_ROLES;
var init_run = __esm({
  "src/cli/run.ts"() {
    "use strict";
    init_context();
    init_orchestrator();
    init_loader();
    init_detector();
    init_integration();
    init_platform();
    init_git();
    init_store();
    init_paths2();
    init_init();
    init_attachments();
    init_stackDetect();
    init_logger();
    init_spinner();
    init_prompt();
    init_render();
    init_home();
    init_registry2();
    execFileAsync = promisify(execFile);
    pending = {};
    HELP_LINES = [
      "/plan <task>       write an implementation plan for a task, saved under .gr-agent/plans/",
      "/spec <task>       write a specification for a feature, saved under .gr-agent/specs/",
      "/implement <task>  run a real workflow: investigate -> implement -> test -> review",
      "/setup             create/switch a project folder, or remove the current setup",
      "/clone             clone a repository into this workspace",
      "/agents            pick which AI worker (native, Claude, Codex, Cursor, ...) runs your tasks",
      "tab (or ctrl+g)    same switch, one keystroke \u2014 cycles to the next worker",
      "/model             pick which model the current worker uses (lists real options where possible)",
      "/mode <m>          set workflow mode for the next /implement (auto|parallel|sequential|single-worker|manual)",
      "/quit",
      "",
      "@<path>            attach a file's real content to your message (text, or a PDF via pdf-parse)",
      "Anything else is a chat message. Nothing runs against your code unless you use /implement."
    ];
    INK_RECOGNIZED_COMMANDS = /* @__PURE__ */ new Set(["/help", "/plan", "/spec", "/implement", "/setup", "/clone", "/agents", "/model", "/mode"]);
    READINESS_LABEL = {
      ready: "ready",
      installed: "installed, auth unverified",
      login_required: "installed, needs login",
      missing: "not installed",
      broken: "broken",
      unsupported: "unsupported"
    };
    MODEL_LISTERS = {
      cursor: {
        args: ["models"],
        // "auto - Auto (current, default)" / "gpt-5.3-codex - Codex 5.3" / ...
        parse: (out) => out.split("\n").map((l) => l.trim()).filter((l) => l.includes(" - ")).map((l) => {
          const idx = l.indexOf(" - ");
          const value = l.slice(0, idx).trim();
          const label = l.slice(idx + 3).trim();
          return { value, label: label || value };
        })
      },
      opencode: {
        // one "provider/model" id per line, no separate label
        args: ["models"],
        parse: (out) => out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("[")).map((id) => ({ value: id, label: id }))
      },
      // Captured directly from `codex`'s own interactive "Select Model and Effort" picker (no
      // non-interactive listing command exists to query this live) — real ids, real current default.
      codex: {
        staticOptions: [
          { value: "gpt-5.6-sol", label: "gpt-5.6-sol (default) \u2014 reliable agentic workhorse for everyday tasks" },
          { value: "gpt-5.6-terra", label: "gpt-5.6-terra \u2014 balanced agentic coding model for everyday work" },
          { value: "gpt-5.6-luna", label: "gpt-5.6-luna \u2014 fast and affordable agentic coding model" },
          { value: "gpt-5.5", label: "gpt-5.5 \u2014 proven previous-generation model for coding and general work" },
          { value: "gpt-5.4", label: "gpt-5.4 \u2014 strong model for everyday coding" },
          { value: "gpt-5.4-mini", label: "gpt-5.4-mini \u2014 small, fast, cost-efficient for simpler coding tasks" }
        ]
      }
    };
    CLAUDE_MODEL_ALIASES = [
      { value: "sonnet", label: "Sonnet 5" },
      { value: "opus", label: "Opus 5" },
      { value: "fable", label: "Fable 5" },
      { value: "haiku", label: "Haiku 4.5" }
    ];
    CHAT_SYSTEM_PROMPT = "You are the chat assistant built into gR DEV AGENT, a vendor-neutral multi-agent engineering CLI. Answer the user's message directly and conversationally \u2014 you have no tools here and cannot read, search, or modify the user's codebase from this chat. If the user is describing (or asks you to do) an actual engineering task on their code \u2014 investigate a bug, implement something, review a change, run tests \u2014 do NOT attempt it yourself: tell them to run it with `/implement <task>`, which hands it to the real investigate -> implement -> test -> review workflow. Keep replies brief.";
    CHAT_CLI_PREFIX = "You are being asked a quick chat question inside gR DEV AGENT, not given a full engineering task \u2014 just answer briefly, don't explore the repository or make any changes. If this message actually describes a real engineering task, tell the user to run it with `/implement <task>` instead.\n\n";
    CHAT_HISTORY_TURNS = 10;
    PLAN_DOC_SYSTEM_PROMPT = "You are the planning assistant inside gR DEV AGENT, a vendor-neutral multi-agent engineering CLI. The user wants a written implementation PLAN for a task, not code changes \u2014 you have no repository access in this call, so plan conceptually from the description given. Write a clear, actionable Markdown document with these sections: Overview, Implementation steps (numbered), Files/areas likely affected, Risks & edge cases, Testing approach. Output only the Markdown body (no top-level title \u2014 the caller adds its own heading), no preamble, no code diffs, no questions back to the user.";
    SPEC_DOC_SYSTEM_PROMPT = "You are the specification assistant inside gR DEV AGENT, a vendor-neutral multi-agent engineering CLI. The user wants a written SPECIFICATION for a feature or task, not code changes \u2014 you have no repository access in this call, so write from the description given. Produce a clear Markdown document with these sections: Summary, Goals, Non-goals, Requirements / acceptance criteria, Open questions (if any). Output only the Markdown body (no top-level title \u2014 the caller adds its own heading), no preamble, no code diffs, no questions back to the user.";
    WORKER_CYCLE = ["native", "claude", "codex", "cursor", "opencode", "antigravity"];
    ALL_ROLES = [
      "planner",
      "investigator",
      "backend",
      "frontend",
      "database",
      "permission",
      "security",
      "performance",
      "coder",
      "tester",
      "reviewer",
      "regression",
      "documentation",
      "git",
      "release",
      "general"
    ];
  }
});

// src/index.ts
init_platform();
init_logger();
init_errors();
import { Command } from "commander";
import pc5 from "picocolors";

// src/cli/doctor.ts
init_platform();
init_paths2();
init_detector();
init_render();
init_logger();
import path6 from "path";
import { promises as fs5 } from "fs";
function registerDoctor(program) {
  program.command("doctor").description("check platform, tools and worker readiness (never prints secrets)").action(async () => {
    const g = program.opts();
    const root = path6.resolve(g.workspace ?? process.cwd());
    log.info(heading("gR DEV AGENT Doctor"));
    log.info("");
    log.info(`Platform      ${Platform.platform} ${process.arch}`);
    log.info(`Node          ${process.version}`);
    const tools = ["git", "npm", "node", "dotnet", "rg", "pwsh"];
    const toolRows = [];
    for (const t of tools) {
      const found = await Platform.findExecutable(t);
      let version = "";
      if (found) {
        const res = await Platform.run(found, ["--version"], { timeoutMs: 8e3 }).catch(() => null);
        version = res ? (res.stdout || res.stderr).split(/\r?\n/)[0].trim() : "";
      }
      toolRows.push([t, found ? "found" : "-", version]);
    }
    log.info("\n" + table(["tool", "status", "version"], toolRows));
    const git = await Platform.findExecutable("git");
    if (!git) log.warn("git not found \u2014 worktree isolation and diff features are disabled.");
    log.info("\n" + heading("AI workers"));
    const statuses = await detectAll();
    const rows = statuses.map((s) => [
      s.displayName,
      s.installed ? "installed" : "missing",
      s.installed ? s.auth : "-",
      s.readiness.toUpperCase(),
      s.version ?? ""
    ]);
    log.info(table(["worker", "install", "auth", "readiness", "version"], rows));
    log.info("\n" + heading("Workspace"));
    const dirName = resolveAgentDirName(root);
    const agentDir = path6.join(root, dirName);
    const initialised = await fs5.stat(agentDir).then((s) => s.isDirectory()).catch(() => false);
    log.info(`Path          ${root}`);
    log.info(`Agent dir     ${initialised ? `${dirName}/ (present)` : "missing (run `gr-agent init`)"}`);
    const ollamaUrl = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
    const ollamaUp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2e3) }).then((r) => r.ok).catch(() => false);
    const provider = process.env.ANTHROPIC_API_KEY ? "anthropic (ANTHROPIC_API_KEY)" : process.env.OPENAI_API_KEY ? "openai (OPENAI_API_KEY)" : process.env.OPENROUTER_API_KEY ? "openrouter (OPENROUTER_API_KEY)" : ollamaUp ? `ollama (${ollamaUrl})` : "none \u2014 set a provider key or run Ollama";
    log.info(`Native LLM    ${provider}`);
    const ready = statuses.filter((s) => s.readiness === "ready").length;
    const nativeOk = provider.startsWith("none") ? "needs a provider" : "available";
    log.info(`
${ready} external worker(s) auto-routable. Native worker ${nativeOk}. Installed CLIs can still be routed to explicitly.`);
  });
}

// src/index.ts
init_init();
init_run();

// src/cli/workers.ts
init_context();
init_loader();
init_registry3();
init_contracts();
init_render();
init_logger();
init_errors();
function registerWorkers(program) {
  const cmd = program.command("workers").description("inspect and configure workers (master plan \xA7126-\xA7138)");
  cmd.command("list", { isDefault: true }).description("show workers, their roles and readiness").action(async () => {
    const g = program.opts();
    const ctx = await resolveContext(g);
    const registry = await buildWorkerRegistry({ config: ctx.config, workers: ctx.workers, agents: ctx.agents });
    log.info(
      table(
        ["worker", "enabled", "ready", "roles", "backing"],
        registry.list().map((e) => [e.id, String(e.enabled), String(e.ready), e.roles.join(",") || "-", e.backing])
      )
    );
  });
  cmd.command("enable <id>").description("enable a worker").action((id) => setEnabled(program, id, true));
  cmd.command("disable <id>").description("disable a worker").action((id) => setEnabled(program, id, false));
  cmd.command("assign <id> <role>").description("give a worker a role").action((id, role) => mutateRole(program, id, role, true));
  cmd.command("unassign <id> <role>").description("remove a role from a worker").action((id, role) => mutateRole(program, id, role, false));
}
async function setEnabled(program, id, enabled) {
  const ctx = await resolveContext(program.opts());
  const w = ctx.workers.workers[id] ?? { enabled, roles: [], capabilities: [] };
  ctx.workers.workers[id] = { ...w, enabled };
  await writeWorkers(ctx.paths, ctx.workers);
  log.success(`worker ${id} ${enabled ? "enabled" : "disabled"}`);
}
async function mutateRole(program, id, role, add) {
  const parsed = RoleSchema.safeParse(role);
  if (!parsed.success) throw new RiqsError("CONFIG", `Unknown role: ${role}`, { hint: `Valid: ${RoleSchema.options.join(", ")}` });
  const ctx = await resolveContext(program.opts());
  const w = ctx.workers.workers[id] ?? { enabled: true, roles: [], capabilities: [] };
  const roles = new Set(w.roles);
  if (add) roles.add(parsed.data);
  else roles.delete(parsed.data);
  ctx.workers.workers[id] = { ...w, roles: [...roles] };
  await writeWorkers(ctx.paths, ctx.workers);
  log.success(`worker ${id}: roles = ${[...roles].join(", ") || "(none)"}`);
}

// src/cli/agents.ts
init_context();
init_loader();
init_contracts();
init_render();
init_logger();
init_errors();
init_prompt();
function registerAgents(program) {
  const cmd = program.command("agents").description("named worker+model personas (master plan \xA7164-\xA7192)");
  cmd.command("list", { isDefault: true }).action(async () => {
    const ctx = await resolveContext(program.opts());
    const rows = Object.entries(ctx.agents.agents).map(([id, a]) => [id, a.worker, a.model, String(a.enabled), a.roles.join(",")]);
    log.info(rows.length ? table(["agent", "worker", "model", "enabled", "roles"], rows) : "No agents defined.");
  });
  cmd.command("create").description("interactively create an agent").action(async () => {
    const ctx = await resolveContext(program.opts());
    const name = await text2("Agent id", "claude-opus-architect");
    if (!name) return;
    const worker = await text2("Backing worker", "native");
    if (!worker) return;
    const model = await text2("Model (blank = default)", "opus") || "default";
    const roles = await multiselect2(
      "Roles",
      RoleSchema.options.map((r) => ({ value: r, label: r }))
    );
    ctx.agents.agents[name] = { worker, model, enabled: true, roles, skills: [], capabilities: [] };
    await writeAgents(ctx.paths, ctx.agents);
    log.success(`agent ${name} created`);
  });
  cmd.command("set <id> <field> <value>").description("set worker|model|enabled on an agent").action(async (id, field, value) => {
    const ctx = await resolveContext(program.opts());
    const a = ctx.agents.agents[id];
    if (!a) throw new RiqsError("CONFIG", `Unknown agent: ${id}`);
    if (field === "worker") a.worker = value;
    else if (field === "model") a.model = value;
    else if (field === "enabled") a.enabled = value === "true";
    else throw new RiqsError("CONFIG", `Unknown field: ${field}`);
    await writeAgents(ctx.paths, ctx.agents);
    log.success(`agent ${id}.${field} = ${value}`);
  });
  cmd.command("delete <id>").action(async (id) => {
    const ctx = await resolveContext(program.opts());
    if (!ctx.agents.agents[id]) throw new RiqsError("CONFIG", `Unknown agent: ${id}`);
    delete ctx.agents.agents[id];
    await writeAgents(ctx.paths, ctx.agents);
    log.success(`agent ${id} deleted`);
  });
}

// src/cli/assignments.ts
init_context();
init_render();
init_logger();
function registerAssignments(program) {
  const cmd = program.command("assignments").description("list assignments for the active task");
  cmd.command("list", { isDefault: true }).action(async () => {
    const ctx = await resolveContext(program.opts());
    const list = await ctx.store.listAssignments();
    const cp = (await ctx.store.readTask())?.taskId ? await ctx.store.readCheckpoint((await ctx.store.readTask()).taskId) : null;
    if (list.length === 0) {
      log.info("No assignments. Run a workflow first.");
      return;
    }
    log.info(
      table(
        ["id", "role", "state", "readOnly", "deps", "output"],
        list.map((a) => [
          a.id,
          a.role,
          cp?.assignmentStates[a.id] ?? "PENDING",
          String(a.readOnly),
          a.dependencies.join(",") || "-",
          a.outputFile.replace(ctx.workspaceRoot + "/", "")
        ])
      )
    );
  });
  cmd.command("show <id>").action(async (id) => {
    const ctx = await resolveContext(program.opts());
    const a = await ctx.store.readAssignment(id);
    if (!a) {
      log.error(`No assignment ${id}`);
      return;
    }
    log.info(JSON.stringify(a, null, 2));
  });
}

// src/cli/results.ts
init_context();
init_contracts();
init_resultMerger();
init_render();
init_logger();
init_errors();
import { promises as fs24 } from "fs";
function registerResults(program) {
  const cmd = program.command("results").description("view and import structured worker results");
  cmd.command("list", { isDefault: true }).action(async () => {
    const ctx = await resolveContext(program.opts());
    const list = await ctx.store.listResults();
    if (!list.length) {
      log.info("No results yet.");
      return;
    }
    log.info(
      table(
        ["id", "role", "worker", "status", "confidence", "findings"],
        list.map((r) => [r.id, r.role, r.worker, r.status, String(r.confidence), String(r.findings.length)])
      )
    );
  });
  cmd.command("merge").description("show the merged root-cause model").action(async () => {
    const ctx = await resolveContext(program.opts());
    const model = mergeResults(await ctx.store.listResults());
    log.info(JSON.stringify(model, null, 2));
  });
  cmd.command("import <file>").description("import a worker result JSON (manual handoff, master plan \xA7152)").option("--id <id>", "assignment id to file it under").action(async (file, opts) => {
    const ctx = await resolveContext(program.opts());
    const raw = JSON.parse(await fs24.readFile(file, "utf8"));
    const parsed = AgentResultSchema.safeParse(raw);
    if (!parsed.success) throw new RiqsError("CONTRACT", `Invalid result: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const result = { ...parsed.data, id: opts.id ?? parsed.data.id };
    await ctx.store.writeResult(result);
    log.success(`imported result ${result.id}`);
  });
}

// src/cli/checkpoints.ts
init_context();
init_git();
init_render();
init_logger();
init_prompt();
function registerCheckpoints(program) {
  const cmd = program.command("checkpoints").description("list persisted checkpoints (master plan \xA729)");
  cmd.command("list", { isDefault: true }).action(async () => {
    const ctx = await resolveContext(program.opts());
    const list = await ctx.store.listCheckpoints();
    if (!list.length) {
      log.info("No checkpoints.");
      return;
    }
    log.info(
      table(
        ["taskId", "phase", "savedAt", "state", "results", "worktrees"],
        list.map((c) => [c.taskId, c.phase, c.savedAt, c.task.state, String(c.completedResults.length), String(c.worktrees.length)])
      )
    );
  });
  program.command("cleanup").description("remove RIQS worktrees (refuses those with unmerged work, master plan \xA731)").option("--force", "remove even worktrees with uncommitted/unmerged changes").option("-y, --yes", "skip the per-worktree confirmation").action(async (opts) => {
    const g = program.opts();
    const ctx = await resolveContext(g);
    const git = await Git.open(ctx.workspaceRoot);
    if (!git) {
      log.error("git unavailable");
      return;
    }
    const worktrees = (await git.worktreeList()).filter((w) => w.branch.startsWith("riqs/"));
    if (!worktrees.length) {
      log.info("No RIQS worktrees.");
      return;
    }
    for (const w of worktrees) {
      const sub = await Git.open(w.path);
      const dirty = sub ? !await sub.isClean() : false;
      if (dirty && !opts.force) {
        log.warn(`skip ${w.path} \u2014 has uncommitted changes (use --force)`);
        continue;
      }
      if (!opts.yes && !await confirm2(`Remove worktree ${w.path} (${w.branch})?`, false)) {
        log.warn(`skip ${w.path} \u2014 not confirmed (pass -y to confirm non-interactively)`);
        continue;
      }
      await git.worktreeRemove(w.path, opts.force);
      log.success(`removed ${w.path}`);
    }
  });
}

// src/cli/resume.ts
init_context();
init_orchestrator();
init_logger();
init_errors();
function registerResume(program) {
  program.command("resume [taskId]").description("resume a task from its last checkpoint (master plan \xA729, \xA7375)").option("-y, --yes", "skip confirmation").action(async (taskId, _opts) => {
    const g = program.opts();
    const ctx = await resolveContext(g);
    const checkpoints = await ctx.store.listCheckpoints();
    const target = taskId ? checkpoints.find((c) => c.taskId === taskId) : checkpoints.find((c) => c.task.state !== "COMPLETED") ?? checkpoints[0];
    if (!target) throw new RiqsError("CONFIG", taskId ? `No checkpoint for ${taskId}` : "No checkpoints to resume");
    log.step(`Resuming ${target.taskId} (phase: ${target.phase}, state: ${target.task.state})`);
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    const orch = new Orchestrator({
      workspaceRoot: ctx.workspaceRoot,
      config: ctx.config,
      workers: ctx.workers,
      agents: ctx.agents,
      nonInteractive: ctx.nonInteractive,
      signal: controller.signal
    });
    const { task, reportPath } = await orch.run({
      objective: target.task.objective,
      category: target.task.category,
      workflow: target.task.workflow,
      skip: target.task.skipped,
      acceptanceCriteria: target.task.acceptanceCriteria,
      resumeTaskId: target.taskId
    });
    log.success(`Task ${task.taskId}: ${task.state}`);
    log.info(`Report: ${reportPath}`);
  });
}

// src/cli/integrations.ts
init_context();
init_detector();

// src/integrations/installer.ts
init_platform();
init_logger();
init_errors();
init_integration();
init_detector();
function buildInstallPlan(integrationId, installer) {
  const platform2 = Platform.platform;
  if (!installer.supportedPlatforms.includes(platform2)) return null;
  const preview = installer.method === "manual" || installer.command === null ? installer.manualInstructions ?? `Manual install \u2014 see ${installer.sourceUrl ?? "vendor documentation"}` : `${installer.command} ${installer.args.join(" ")}`;
  return { integrationId, displayName: integrationId, installer, preview };
}
async function planInstalls(ids, config) {
  const manifest = await loadManifest();
  const policy = config.integrations.installation;
  const plans = [];
  const blocked = [];
  for (const id of ids) {
    const entry = manifest.integrations[id];
    if (!entry) {
      blocked.push({ integrationId: id, result: "blocked", message: "unknown integration" });
      continue;
    }
    if (!policy.enabled) {
      blocked.push({ integrationId: id, result: "blocked", message: "installation disabled by policy (\xA796)" });
      continue;
    }
    if (!policy.allowedIntegrations.includes(id)) {
      blocked.push({ integrationId: id, result: "blocked", message: "integration not in allowedIntegrations" });
      continue;
    }
    const status = await detectIntegration(id);
    if (status.installed) {
      blocked.push({ integrationId: id, result: "skipped", message: `already installed (${status.version ?? "unknown version"})` });
      continue;
    }
    const usable = entry.installers.find(
      (i) => policy.allowedMethods.includes(i.method) && i.supportedPlatforms.includes(Platform.platform) && i.command !== null
    );
    const installer = usable ?? entry.installers[0];
    if (!installer) {
      blocked.push({ integrationId: id, result: "blocked", message: "no installer for this platform" });
      continue;
    }
    const plan = buildInstallPlan(id, installer);
    if (!plan) {
      blocked.push({ integrationId: id, result: "blocked", message: "installer not supported on this platform" });
      continue;
    }
    plan.displayName = entry.displayName;
    plans.push(plan);
  }
  return { plans, blocked };
}
async function runInstalls(approved, opts) {
  const outcomes = [];
  for (const plan of approved) {
    const { installer } = plan;
    if (opts.nonInteractive) {
      outcomes.push({ integrationId: plan.integrationId, result: "blocked", message: "non-interactive mode never installs (\xA7118)" });
      continue;
    }
    if (installer.requiresElevation) {
      outcomes.push({
        integrationId: plan.integrationId,
        result: "blocked",
        message: "requires administrator privileges \u2014 run the official elevated installer yourself (\xA784)"
      });
      await audit(opts.store, plan, false, "blocked-elevation");
      continue;
    }
    if (installer.method === "manual" || installer.command === null) {
      log.info(`${plan.displayName}: ${plan.preview}`);
      outcomes.push({ integrationId: plan.integrationId, result: "skipped", message: "manual installation required" });
      await audit(opts.store, plan, false, "manual");
      continue;
    }
    log.step(`Installing ${plan.displayName}: ${plan.preview}`);
    let ok = false;
    try {
      const cmd = await Platform.findExecutable(installer.command);
      if (!cmd) throw new RiqsError("INTEGRATION", `${installer.command} not found on PATH`);
      const res = await Platform.run(cmd, installer.args, { inherit: true, timeoutMs: 10 * 6e4, signal: opts.signal });
      ok = res.exitCode === 0;
    } catch (e) {
      outcomes.push({ integrationId: plan.integrationId, result: "failed", message: e.message });
      await audit(opts.store, plan, true, "failed");
      continue;
    }
    const verify = await detectIntegration(plan.integrationId);
    if (ok && verify.installed) {
      outcomes.push({ integrationId: plan.integrationId, result: "success", version: verify.version });
      await audit(opts.store, plan, true, "success", verify.version);
    } else {
      outcomes.push({ integrationId: plan.integrationId, result: "failed", message: "command completed but executable not detected" });
      await audit(opts.store, plan, true, "verify-failed");
    }
  }
  return outcomes;
}
async function audit(store, plan, approved, result, version) {
  await store.appendAudit({
    kind: "integration.install",
    tool: plan.integrationId,
    method: plan.installer.method,
    command: plan.preview,
    approved,
    result,
    version: version ?? null
  });
}

// src/integrations/verifier.ts
init_platform();
init_integration();
init_detector();
async function verifyIntegration(id) {
  const manifest = await loadManifest();
  const entry = manifest.integrations[id];
  const details = [];
  if (!entry) return { id, ok: false, details: ["unknown integration"] };
  const status = await detectIntegration(id);
  details.push(status.installed ? `executable: ${status.executablePath}` : "executable: not found");
  if (status.version) details.push(`version: ${status.version}`);
  details.push(`auth: ${status.auth}`);
  details.push(`readiness: ${status.readiness}`);
  if (status.installed) {
    const exe = status.executablePath;
    const res = await Platform.run(exe, entry.healthArgs, { timeoutMs: 15e3 }).catch(() => null);
    details.push(`health command exit: ${res ? res.exitCode : "error"}`);
  }
  return { id, ok: status.readiness === "ready", details };
}

// src/cli/integrations.ts
init_integration();
init_render();
init_logger();
init_prompt();
function registerIntegrations(program) {
  const cmd = program.command("integrations").description("detect / install / verify external agent CLIs (master plan \xA774-\xA799)");
  cmd.command("list", { isDefault: true }).alias("detect").action(async () => {
    const g = program.opts();
    await resolveContext(g, false);
    const statuses = await detectAll();
    log.info(
      table(
        ["integration", "installed", "auth", "readiness", "version"],
        statuses.map((s) => [s.displayName, s.installed ? "yes" : "no", s.installed ? s.auth : "-", s.readiness.toUpperCase(), s.version ?? ""])
      )
    );
  });
  cmd.command("verify <id>").action(async (id) => {
    await resolveContext(program.opts(), false);
    const res = await verifyIntegration(id);
    log.info(`${id}: ${res.ok ? "READY" : "not ready"}`);
    for (const d of res.details) log.info(`  ${d}`);
  });
  cmd.command("install [ids...]").description("install missing integrations (consent required for each)").action(async (ids) => {
    const g = program.opts();
    const ctx = await resolveContext(g, false);
    const targets = ids.length ? ids : [...KNOWN_INTEGRATIONS];
    const { plans, blocked } = await planInstalls(targets, ctx.config);
    for (const b of blocked) log.info(`  ${b.integrationId}: ${b.result} \u2014 ${b.message ?? ""}`);
    if (!plans.length) {
      log.info("Nothing to install.");
      return;
    }
    const approved = await approvePlans(plans, ctx.nonInteractive);
    if (!approved.length) {
      log.warn("No installs approved.");
      return;
    }
    const outcomes = await runInstalls(approved, { store: ctx.store, nonInteractive: ctx.nonInteractive });
    log.info("\n" + table(["integration", "result", "detail"], outcomes.map((o) => [o.integrationId, o.result, o.message ?? o.version ?? ""])));
  });
  cmd.command("setup").description("guided detect \u2192 install \u2192 verify for all integrations").action(async () => {
    const g = program.opts();
    const ctx = await resolveContext(g, false);
    log.info(heading("Scanning integrations\u2026"));
    const statuses = await detectAll();
    log.info(
      table(["integration", "readiness"], statuses.map((s) => [s.displayName, s.readiness.toUpperCase()]))
    );
    const missing = statuses.filter((s) => s.readiness === "missing").map((s) => s.id);
    if (!missing.length) {
      log.success("All known integrations are installed.");
      return;
    }
    const chosen = ctx.nonInteractive ? [] : await multiselect2(
      "Install which missing integrations?",
      missing.map((id) => ({ value: id, label: statuses.find((s) => s.id === id).displayName }))
    );
    if (!chosen.length) {
      log.info("Skipped. gR DEV AGENT works with the native worker alone.");
      return;
    }
    const { plans, blocked } = await planInstalls(chosen, ctx.config);
    for (const b of blocked) log.info(`  ${b.integrationId}: ${b.result} \u2014 ${b.message ?? ""}`);
    const approved = await approvePlans(plans, ctx.nonInteractive);
    if (!approved.length) return;
    const outcomes = await runInstalls(approved, { store: ctx.store, nonInteractive: ctx.nonInteractive });
    log.info("\n" + table(["integration", "result"], outcomes.map((o) => [o.integrationId, o.result])));
    for (const o of outcomes.filter((x) => x.result === "success")) {
      const v = await detectIntegration(o.integrationId);
      if (v.readiness === "login_required") log.warn(`${o.integrationId}: installed but login required \u2014 run \`gr-agent auth login ${o.integrationId}\``);
    }
  });
}
async function approvePlans(plans, nonInteractive) {
  if (nonInteractive) {
    log.warn("non-interactive: no installs performed (\xA7118)");
    return [];
  }
  log.info("\n" + heading("Planned installations"));
  for (const p of plans) {
    log.info(`
${p.displayName}`);
    log.info(`  method: ${p.installer.method}`);
    log.info(`  command: ${p.preview}`);
    if (p.installer.sourceUrl) log.info(`  source: ${p.installer.sourceUrl}`);
    if (!p.installer.verified) log.warn("  metadata not marked verified \u2014 confirm the command matches the vendor's current docs");
  }
  const selected = [];
  for (const p of plans) {
    if (await confirm2(`Install ${p.displayName} with: ${p.preview} ?`, false)) selected.push(p);
  }
  if (!selected.length) return [];
  const ok = await confirm2(`Proceed with ${selected.length} installation(s)?`, false);
  return ok ? selected : [];
}

// src/cli/auth.ts
init_context();
init_detector();

// src/integrations/authManager.ts
init_platform();
init_logger();
init_errors();
init_integration();
init_detector();
async function loginIntegration(id, opts) {
  if (opts.nonInteractive) {
    return { integrationId: id, result: "skipped", message: "non-interactive mode never launches login (\xA7118)" };
  }
  const manifest = await loadManifest();
  const entry = manifest.integrations[id];
  if (!entry) throw new RiqsError("INTEGRATION", `Unknown integration: ${id}`);
  if (entry.authentication.methods.length === 0) {
    return { integrationId: id, result: "authenticated", message: "no authentication required" };
  }
  const status = await detectIntegration(id);
  if (!status.installed) return { integrationId: id, result: "failed", message: "not installed" };
  const method = entry.authentication.methods[0];
  if (!method.command) {
    return { integrationId: id, result: "skipped", message: `login method "${method.type}" has no automatable command \u2014 sign in with ${entry.displayName} directly` };
  }
  const exe = await Platform.findExecutable(method.command);
  if (!exe) return { integrationId: id, result: "failed", message: `${method.command} not found` };
  const approved = await opts.approve(method, exe);
  if (!approved) {
    await opts.store.appendAudit({ kind: "integration.login", integration: id, userApproved: false, result: "declined" });
    return { integrationId: id, result: "skipped", message: "login declined" };
  }
  log.step(`Launching ${entry.displayName} official login (${method.command} ${method.args.join(" ")}) \u2026`);
  log.info("gR DEV AGENT will not see or store your password.");
  const res = await Platform.run(exe, method.args, { inherit: true, timeoutMs: 15 * 6e4, signal: opts.signal });
  const after = await detectIntegration(id);
  const result = after.auth === "authenticated" ? "authenticated" : res.exitCode === 0 ? "unknown" : "failed";
  await opts.store.appendAudit({ kind: "integration.login", integration: id, userApproved: true, result });
  return {
    integrationId: id,
    result,
    message: result === "unknown" ? "login process completed; gR DEV AGENT cannot verify the session automatically for this tool" : void 0
  };
}
async function logoutIntegration(id, store) {
  const manifest = await loadManifest();
  const entry = manifest.integrations[id];
  if (!entry) throw new RiqsError("INTEGRATION", `Unknown integration: ${id}`);
  await store.appendAudit({ kind: "integration.logout", integration: id, userApproved: true, result: "requested" });
  return { integrationId: id, result: "skipped", message: `Run the ${entry.displayName} logout command directly.` };
}

// src/cli/auth.ts
init_integration();
init_render();
init_logger();
init_prompt();
function registerAuth(program) {
  const cmd = program.command("auth").description("external integration authentication (master plan \xA7101-\xA7124)");
  cmd.command("status", { isDefault: true }).action(async () => {
    await resolveContext(program.opts(), false);
    const statuses = await detectAll();
    log.info(
      table(
        ["integration", "installed", "authenticated", "ready"],
        statuses.map((s) => [
          s.displayName,
          s.installed ? "yes" : "no",
          s.auth === "authenticated" ? "yes" : s.auth === "not_required" ? "n/a" : s.auth,
          s.readiness === "ready" ? "yes" : "no"
        ])
      )
    );
  });
  cmd.command("login [id]").description("launch a vendor's official login flow (with your consent)").action(async (id) => {
    const g = program.opts();
    const ctx = await resolveContext(g, false);
    const targets = id ? [id] : [...KNOWN_INTEGRATIONS];
    for (const t of targets) {
      const outcome = await loginIntegration(t, {
        store: ctx.store,
        nonInteractive: ctx.nonInteractive,
        approve: async (method, exe) => {
          log.info(`
${t}: will run \`${method.command} ${method.args.join(" ")}\` (${exe})`);
          log.info("gR DEV AGENT will not see or store your credentials.");
          return confirm2(`Launch ${t} login now?`, false);
        }
      });
      log.info(`  ${t}: ${outcome.result}${outcome.message ? ` \u2014 ${outcome.message}` : ""}`);
    }
  });
  cmd.command("logout <id>").action(async (id) => {
    const ctx = await resolveContext(program.opts(), false);
    const outcome = await logoutIntegration(id, ctx.store);
    log.info(`${id}: ${outcome.message ?? outcome.result}`);
  });
}

// src/cli/workflowCmd.ts
init_context();
init_workflows();
init_skills();
init_render();
init_logger();
function registerWorkflowCmd(program) {
  const cmd = program.command("workflow").description("inspect workflow presets and skills");
  cmd.command("list", { isDefault: true }).action(async () => {
    const ctx = await resolveContext(program.opts());
    const presets = await listPresets(ctx.paths);
    log.info(presets.length ? presets.map((p) => `- ${p}`).join("\n") : "No presets. Run `gr-agent init`.");
  });
  cmd.command("show <name>").action(async (name) => {
    const ctx = await resolveContext(program.opts());
    const preset = await loadPreset(ctx.paths, name);
    const steps = normalizePreset(preset);
    log.info(`${preset.name} \u2014 ${preset.description ?? ""}`);
    log.info(
      table(
        ["id", "role", "readOnly", "dependsOn"],
        steps.map((s) => [s.id, s.role, String(s.readOnly), s.dependsOn.join(",") || "-"])
      )
    );
  });
  cmd.command("skills").description("list discovered skills").action(async () => {
    const ctx = await resolveContext(program.opts());
    const skills = await discoverSkills(ctx.paths);
    log.info(
      skills.length ? table(["name", "title", "generated"], skills.map((s) => [s.name, s.title, String(s.generated)])) : "No skills found."
    );
  });
}

// src/cli/setup.ts
init_context();
init_detector();
init_render();
init_logger();
init_prompt();
function registerSetup(program) {
  program.command("setup").description("guided: detect tools, (optionally) install + sign in to workers, then run doctor").action(async () => {
    const g = program.opts();
    const ctx = await resolveContext(g, false);
    intro2("gR DEV AGENT Setup");
    log.info(heading("Platform & workspace"));
    const initialised = ctx.initialised;
    if (!initialised) log.warn("No agent directory here yet \u2014 run `gr-agent init` first (then re-run setup).");
    log.info("\n" + heading("AI workers"));
    let statuses = await detectAll();
    log.info(table(["worker", "readiness"], statuses.map((s) => [s.displayName, s.readiness.toUpperCase()])));
    if (!ctx.nonInteractive) {
      const missing = statuses.filter((s) => s.readiness === "missing").map((s) => s.id);
      if (missing.length && await confirm2("Install missing AI workers?", false)) {
        const chosen = await multiselect2(
          "Select workers to install",
          missing.map((id) => ({ value: id, label: statuses.find((s) => s.id === id).displayName }))
        );
        if (chosen.length) {
          const { plans, blocked } = await planInstalls(chosen, ctx.config);
          for (const b of blocked) log.info(`  ${b.integrationId}: ${b.result} \u2014 ${b.message ?? ""}`);
          for (const p of plans) log.info(`  ${p.displayName}: ${p.preview}${p.installer.verified ? "" : "  (verify against vendor docs)"}`);
          if (plans.length && await confirm2(`Proceed with ${plans.length} installation(s)?`, false)) {
            const outcomes = await runInstalls(plans, { store: ctx.store, nonInteractive: ctx.nonInteractive });
            log.info(table(["worker", "result"], outcomes.map((o) => [o.integrationId, o.result])));
          }
        }
      }
      statuses = await detectAll();
      const loginNeeded = statuses.filter((s) => s.readiness === "login_required").map((s) => s.id);
      if (loginNeeded.length && await confirm2(`Sign in to ${loginNeeded.join(", ")} now?`, false)) {
        for (const id of loginNeeded) {
          const outcome = await loginIntegration(id, {
            store: ctx.store,
            nonInteractive: ctx.nonInteractive,
            approve: async (m) => confirm2(`Launch ${id} login (${m.command} ${m.args.join(" ")})?`, false)
          });
          log.info(`  ${id}: ${outcome.result}`);
        }
      }
    }
    statuses = await detectAll();
    const ready = statuses.filter((s) => s.readiness === "ready").map((s) => s.displayName);
    log.success(`Ready external workers: ${ready.join(", ") || "none (native worker only)"}`);
    outro2('Setup complete. Try: gr-agent run --workflow bug-fix "<task>"');
  });
}

// src/index.ts
var VERSION = "0.1.0";
async function main() {
  const program = new Command();
  program.name("gr-agent").description("gR DEV AGENT \u2014 AI engineering, orchestrated (vendor-neutral parallel multi-agent orchestrator)").version(VERSION, "-v, --version").option("--no-color", "disable ANSI colour").option("--non-interactive", "never prompt; fail closed on decisions that need input").option("--workspace <path>", "target repository (default: current directory)", process.cwd()).option("--json", "machine-readable log output").option("--debug", "verbose logging").option("--tui <kind>", "interactive shell: ink (default) or legacy", "ink").hook("preAction", (thisCommand) => {
    const o = thisCommand.opts();
    configureLogger({
      color: o.color !== false && isColor(),
      json: Boolean(o.json),
      level: o.debug ? "debug" : "info"
    });
  });
  registerInit(program);
  registerSetup(program);
  registerDoctor(program);
  registerRun(program);
  registerWorkflowCmd(program);
  registerWorkers(program);
  registerAgents(program);
  registerAssignments(program);
  registerResults(program);
  registerCheckpoints(program);
  registerResume(program);
  registerIntegrations(program);
  registerAuth(program);
  program.argument("[target]", "shorthand: `.` opens an interactive session on the workspace").action(async (target) => {
    if (target === "." || target === void 0) {
      const { runInteractive: runInteractive2 } = await Promise.resolve().then(() => (init_run(), run_exports));
      await runInteractive2(program.opts());
      return;
    }
    program.help();
  });
  await program.parseAsync(process.argv);
}
process.on("SIGINT", () => {
  log.warn("Interrupted \u2014 persisting state and terminating child processes\u2026");
  Platform.killAllChildren();
  process.exitCode = 130;
  setTimeout(() => process.exit(130), 500).unref();
});
main().catch((err) => {
  if (isRiqsError(err)) {
    log.error(err.message);
    if (err.hint) log.info(pc5.dim(err.hint));
    process.exit(exitCodeFor(err.code));
  }
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
//# sourceMappingURL=index.js.map