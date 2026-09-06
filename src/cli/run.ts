import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import type { Command } from "commander";
import { resolveContext, type GlobalOpts } from "./context";
import { Orchestrator, type OrchestratorRunInput } from "../orchestrator/orchestrator";
import { loadConfig, loadProfile, writeAgents, writeConfig, writeWorkers } from "../config/loader";
import { detectAll } from "../integrations/detector";
import { loadManifest } from "../integrations/integration";
import type { Role } from "../riqs/contracts";
import type { Config, WorkflowMode } from "../config/schema";
import { Platform } from "../platform/platform";
import { Git } from "../tools/git";
import { RiqsStore } from "../riqs/store";
import { RiqsPaths } from "../riqs/paths";
import { scaffoldWorkspace, logScaffoldResult } from "./init";
import { expandAttachments } from "./attachments";
import { detectWorkspaceState } from "./stackDetect";
import { log, setLogSink } from "../util/logger";
import { setSpinnerSink } from "../util/spinner";
import { autocomplete, confirm, interactive, outro, select, text } from "../ui/prompt";
import { table } from "../ui/render";
import {
  checkpointToRecentTask,
  filterSlashCommands,
  getSuggestionList,
  invalidateSizeCache,
  isCommandMenuOpen,
  renderHome,
  renderHomePrompt,
  resolveSuggestionSubmission,
  stripAnsi,
  visibleLength,
  deriveWorkspaceName,
  RUN_INIT_ACTION,
  RUN_CLONE_ACTION,
  type ChatTurn,
  type HomeModel,
} from "../ui/home";
import { resolveNativeProvider } from "../llm/registry";
import type { ChatMessage } from "../llm/provider";
import type { InputState } from "../ui/ink/inputBuffer";

interface RunOpts {
  workflow?: string;
  mode?: WorkflowMode;
  worker?: string;
  parallel?: string;
  skip?: string[];
  route?: string[];
  disableWorker?: string[];
  category?: string;
  profile?: string;
  isolateWrites?: boolean;
  yes?: boolean;
  nativeProvider?: string;
  criteria?: string[];
}

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("run a workflow on the workspace")
    .argument("[objective...]", "what to investigate / fix")
    .option("--workflow <name>", "workflow preset (e.g. permission-bug, bug-fix)")
    .option("--mode <mode>", "auto | parallel | sequential | single-worker | manual")
    .option("--worker <id>", "with --mode single-worker: the worker/agent to use")
    .option("--parallel <n>", "max concurrent assignments")
    .option("--skip <phase>", "skip a phase / node / role (repeatable)", collect, [])
    .option("--route <role=worker>", "per-task route override (repeatable)", collect, [])
    .option("--disable-worker <id>", "exclude a worker for this task (repeatable)", collect, [])
    .option("--category <name>", "task category for task-type defaults", "general")
    .option("--profile <name>", "apply a saved routing profile")
    .option("--native-provider <key>", "override the native worker provider config key")
    .option("--criteria <text>", "an acceptance criterion (repeatable)", collect, [])
    .option("--no-isolate-writes", "let writers modify the main tree instead of a worktree")
    .option("-y, --yes", "skip the routing confirmation prompt")
    .action(async (objectiveParts: string[], opts: RunOpts) => {
      const g = program.opts<GlobalOpts>();
      const objective = objectiveParts.join(" ").trim();
      if (!objective) throw Object.assign(new Error("Provide an objective: gr-agent run \"<task>\""), {});
      await execute(objective, opts, g);
    });
}

const execFileAsync = promisify(execFile);

/**
 * A name for the welcome banner's "Welcome back {name}!" line (see `WelcomeBanner`). Prefers git's
 * globally-configured `user.name` — the same name most CLI tools already greet a developer by, and
 * generally a real display name ("Golam Rabbani") rather than a shell username — falling back to the
 * OS account's username, then to a generic greeting if neither is available (no git installed, or
 * nothing configured). Best-effort only: this is cosmetic, so any failure here should never surface
 * as an error or block startup.
 */
async function resolveGreetingName(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--global", "user.name"], { timeout: 1500 });
    const name = stdout.trim();
    if (name) return name;
  } catch {
    // no global git user.name configured, git not installed, or the lookup timed out — fall through
  }
  try {
    const name = os.userInfo().username?.trim();
    if (name) return name;
  } catch {
    // os.userInfo() can throw in some sandboxed/containerized environments
  }
  return "there";
}

/** Which native LLM provider (if any) is reachable right now — same rule doctor/home use. */
async function detectNativeProvider(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  const ollamaUrl = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
  const ollamaUp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  return ollamaUp ? "ollama" : "no provider";
}

/**
 * The model behind the header/footer's "Agent" pill, when it's actually known — same rule the chat
 * labels already follow: a real resolved value for native, an explicitly /model-configured value or
 * a directly-observed manifest defaultModelLabel for a CLI agent, never a fabricated guess.
 */
async function resolveAgentModelLabel(agent: string, configuredModel: string | undefined, config: Config): Promise<string | undefined> {
  if (agent === "native") {
    try {
      const resolved = resolveNativeProvider(config);
      return resolved.model && resolved.model !== "default" ? resolved.model : resolved.provider.defaultModel;
    } catch {
      return undefined;
    }
  }
  if (configuredModel && configuredModel !== "default") return configuredModel;
  const manifest = await loadManifest().catch(() => null);
  return manifest?.integrations[agent]?.defaultModelLabel;
}

async function buildHomeModel(g: GlobalOpts): Promise<HomeModel> {
  const workspaceRoot = path.resolve(g.workspace ?? process.cwd());
  await Platform.loadDotEnv(workspaceRoot);
  const loaded = await loadConfig(workspaceRoot);
  const state = await detectWorkspaceState(workspaceRoot);
  const git = state.repoRoot ? await Git.open(state.repoRoot) : null;
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
    repositories: state.hasRepo ? 1 : 0,
    mode: loaded.config.mode,
    agent,
    agentModel,
    provider,
    ready: loaded.initialised && provider !== "no provider",
    initialised: loaded.initialised,
    hasRepo: state.hasRepo,
    stack: state.stack,
    recentTasks,
  };
}

const pending: { mode?: WorkflowMode } = {};

const HELP_LINES = [
  "/plan <task>       write an implementation plan for a task, saved under .gr-agent/plans/",
  "/spec <task>       write a specification for a feature, saved under .gr-agent/specs/",
  "/implement <task>  run a real workflow: investigate -> implement -> test -> review",
  "/setup             create/switch a project folder, or remove the current setup",
  "/clone             clone a repository into this workspace",
  "/agents            pick which AI worker (native, Claude, Codex, Cursor, ...) runs your tasks",
  "tab (or ctrl+g)    same switch, one keystroke — cycles to the next worker",
  "/model             pick which model the current worker uses (lists real options where possible)",
  "/mode <m>          set workflow mode for the next /implement (auto|parallel|sequential|single-worker|manual)",
  "/quit",
  "",
  "@<path>            attach a file's real content to your message (text, or a PDF via pdf-parse)",
  "Anything else is a chat message. Nothing runs against your code unless you use /implement.",
];

/** True only when both ends of the terminal are real — the styled slot editor needs both. */
function isRealTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Full clear: visible screen + scrollback + home. An earlier version of this dropped "\x1b[3J"
 * (erase-scrollback) to stop it from destroying Ink's `<Static>`-printed chat history on every
 * command — but on at least one real terminal (macOS Terminal.app), a bare "\x1b[2J\x1b[H" turned
 * out not to reliably repaint from a clean top-of-screen: the previous frame stayed visible with a
 * large blank gap before the new content, rather than being replaced. "\x1b[2J\x1b[3J\x1b[H" is the
 * combination every terminal actually gets right (it's what a plain `clear` emits), so it's back —
 * the chat-history side of this is now handled properly instead, by having each fresh Ink mount
 * re-seed its `<Static>` transcript with everything said so far (see `InkApp`'s `initialHistory`
 * prop and the comment on `Transcript`) rather than depending on the terminal's own scrollback to
 * carry it across a mount boundary.
 */
function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

/**
 * The composer row sits 3 lines above the very end of renderHome's output (row, divider, footer,
 * blank) — after printing a fresh frame, move the *real* terminal cursor there instead of leaving it
 * wherever the last line of output happened to end. Every caller that writes a renderHome() frame to
 * a real TTY must call this right after — skipping it (as runChat's draw() used to) leaves the
 * terminal's actual cursor sitting below the footer instead of in the input box, which looks exactly
 * like the composer not accepting input even though the frame itself renders correctly.
 */
function placeCursorInComposer(composerValue: string): void {
  const col = visibleLength(renderHomePrompt()) + composerValue.length;
  process.stdout.write(`\x1b[3A\r` + (col > 0 ? `\x1b[${col}C` : ""));
}

/**
 * Ink's `unmount()` leaves `process.stdin`'s underlying TTY handle stalled: `isRaw`, `isPaused()`,
 * and `readableFlowing` all still report as if everything is normal, but the stream never delivers
 * another 'data'/'keypress' event no matter what gets typed, until something calls `.read(0)` to
 * force it to actually pull from the handle again. Confirmed against a minimal Ink
 * mount-then-unmount-then-useInput repro — this is a real Ink/Node stdin-handoff quirk, not
 * anything specific to this codebase. `.read(0)` is a public, documented Readable API (a
 * zero-length read used purely to nudge internal stream state), not a private workaround.
 */
function reclaimStdinAfterInk(): void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  // Ink's own App component (componentWillUnmount -> handleSetRawMode(false)) calls
  // `stdin.unref()` once the last raw-mode consumer unmounts — confirmed by reading Ink's source
  // (node_modules/ink/build/components/App.js). An unref'd stdin handle stops reliably delivering
  // further input even after `.setRawMode(true)`/`.resume()` are called again: `isRaw`, `isPaused()`
  // and `readableFlowing` all report as if everything is normal, but no 'data'/'keypress' event
  // ever fires. `.ref()` undoes exactly that; `.read(0)` (a public, documented zero-length read,
  // not a private workaround) additionally nudges the stream to pull from the handle right away
  // instead of waiting for the next natural tick. Every legacy prompt below (clack's
  // select/confirm/text/autocomplete, and this file's own waitForKey/captureStdinDuringRun) needs
  // stdin actually working, so this runs once here, immediately after unmounting Ink and before any
  // of them touch stdin.
  stdin.ref();
  stdin.resume();
  stdin.read(0);
}

/** The slash commands the Ink shell can actually run — the same subset the legacy loop's own
 * dispatch handles (see the `if (input.startsWith("/"))` block in `runInteractive` below); anything
 * else is "Unknown command" in the legacy shell too, so the Ink shell's stub reply for it is genuine
 * parity, not a placeholder. */
const INK_RECOGNIZED_COMMANDS = new Set(["/help", "/plan", "/spec", "/implement", "/setup", "/clone", "/agents", "/model", "/mode"]);

/**
 * Runs one of `INK_RECOGNIZED_COMMANDS` using the exact same handler the legacy loop calls —
 * `runSelectWorker`, `runSelectModel`, `execute()`, etc. — none of which know or care that they were
 * invoked from Ink instead of the hand-rolled loop; they just read/write `process.stdin`/`stdout`
 * directly, which is safe here because the Ink instance that requested this has already been
 * unmounted (see `runInkInteractive`) and so isn't holding stdin in raw mode.
 */
async function dispatchInkCommand(command: { cmd: string; args: string[] }, g: GlobalOpts, tty: boolean, model: HomeModel): Promise<void> {
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
    pending.mode = args[0] as WorkflowMode | undefined;
    await showOverlay("Mode", [`Next /implement's mode: ${pending.mode ?? "(default)"}`], tty);
  } else if (cmd === "/implement") {
    const objective = args.join(" ").trim();
    if (!objective) {
      await showOverlay("Implement", ["Usage: /implement <task>", "", "Example: /implement fix the login redirect bug"], tty);
      return;
    }
    if (tty) clearScreen();
    else process.stdout.write("\n");
    // A local, mutable copy for drawRun's renderHome() — separate from the outer `model` so a
    // failed/short run's runLog doesn't leak into the fresh model the next Ink mount is built from.
    const runModel: HomeModel = { ...model };
    const drawRun = () => {
      if (tty) clearScreen();
      process.stdout.write(renderHome(runModel, { value: "" }));
      if (tty) placeCursorInComposer("");
    };
    const ensureStarted = () => {
      if (runModel.runLog === undefined) {
        runModel.runLog = [];
        runModel.runObjective = objective;
        runModel.runPending = true;
      }
    };
    const releaseInput = tty ? captureStdinDuringRun() : () => {};
    try {
      await execute(
        objective,
        { mode: pending.mode, skip: [], route: [], disableWorker: [], criteria: [] },
        g,
        tty
          ? {
              onLine: (line) => {
                ensureStarted();
                runModel.runLog!.push(line);
                drawRun();
              },
              onStatus: (frame) => {
                ensureStarted();
                runModel.runStatus = frame;
                drawRun();
              },
            }
          : undefined,
      );
    } catch {
      // execute() already appended the error as a run line via onLine before rethrowing.
    } finally {
      releaseInput();
      runModel.runPending = false;
      if (runModel.runLog !== undefined) drawRun();
    }
    pending.mode = undefined;
    // Unlike /help etc. (which already pause via showOverlay), the run screen above was drawn with
    // clearScreen() directly — without this pause, remounting Ink would immediately clear it again
    // before the user has a chance to read the final output.
    await endOverlay(tty);
  }
}

/**
 * `--tui=ink` entry point. Plain chat and the recognized commands in `INK_RECOGNIZED_COMMANDS` work
 * exactly as they do in the legacy shell — this mounts/unmounts Ink around each one, since none of
 * `dispatchInkCommand`'s handlers (all shared with the legacy loop) compose with Ink owning stdin in
 * raw mode. `chatHistory` lives outside the mount loop (like the legacy loop's own) so conversation
 * context survives a command in between two chat messages; each fresh Ink mount is handed the full
 * `chatHistory` so far as `initialHistory`, so it reappears immediately instead of that mount's
 * `<Static>` transcript starting blank (see the comment on `Transcript`/`InkApp`'s `initialHistory`
 * prop for why this replaced relying on the terminal's own scrollback across a mount boundary).
 */
async function runInkInteractive(g: GlobalOpts, model: HomeModel): Promise<void> {
  const chatHistory: ChatTurn[] = [];
  let current = model;
  current.chatHistory = chatHistory;
  const tty = isRealTty();
  // Claude Code starts from a genuinely blank terminal — no trace of the shell commands (or their
  // output, e.g. a preceding `npm run build`) that were on screen a moment before `claude` was
  // launched. `gr-agent --tui=ink` didn't do this: the welcome banner was simply appended after
  // whatever was already in the terminal's scrollback, so the previous shell session stayed visible
  // above it (confirmed on the device: a real login banner + `cd`/`npm run build` output sitting
  // above the welcome box). `clearScreen()` here — the same "\x1b[2J\x1b[3J\x1b[H" full clear used
  // elsewhere in this file — erases that scrollback too (see its own doc comment for why "\x1b[3J" is
  // required, not just "\x1b[2J"), so the very first frame the user sees is the welcome banner alone,
  // matching that fresh-start feel. This runs once, before the loop below, regardless of how many
  // `/command`-triggered remounts happen afterward — those already clear on their own terms via
  // `showWelcome`/`dispatchInkCommand`.
  if (tty) clearScreen();
  // The welcome banner (product name/version, workspace, quick tips — see `WelcomeBanner`) is only
  // for the session's actual start, not for every remount this loop does after a `/command`
  // round-trip — otherwise it would reappear mid-conversation every time the user ran `/agents` or
  // `/model`. Deliberately *not* named `firstMount`: `clearScreen()` below writes `\x1b[3J` ("erase
  // saved lines"), which on real terminals (xterm and effectively everything derived from it) wipes
  // the actual scrollback buffer, not just the visible screen — so once a remount's `<Static>` items
  // stop including the banner, it is gone for good, not merely scrolled out of view. That's the
  // right behavior after a `/command` dispatch (the user just took a deliberate action; the banner
  // has served its purpose), so this flips to `false` there — but a *resize* is not the user asking
  // to dismiss the banner, so the resize branch below leaves this exactly as it found it instead of
  // treating every remount the same way a naive "is this still the first mount" flag would.
  let showWelcome = true;
  // Carries the composer's in-progress text across a resize-triggered remount (see `runInkApp`'s
  // `RunInkAppResult.input`) — so resizing the terminal mid-draft doesn't wipe out what the user
  // was typing. Reset to blank once a real `/command` dispatch happens, since that's a genuine
  // fresh start.
  let carryInput: InputState | undefined;
  // Both only ever shown inside the welcome banner (first mount only) — resolved once up front
  // rather than inside the loop, since `showWelcome` only stays true for that one mount anyway.
  const greetingName = await resolveGreetingName();
  const home = os.homedir();
  const cwdDisplay = current.workspaceRoot.startsWith(home) ? `~${current.workspaceRoot.slice(home.length)}` : current.workspaceRoot;

  for (;;) {
    let pendingCommand: { cmd: string; args: string[] } | null = null;

    const { runInkApp } = await import("../ui/ink/runInkApp");
    const inkResult = await runInkApp({
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
      onSubmit: async (text) => {
        if (text === "/quit" || text === "/exit") return null;
        if (text.startsWith("/")) {
          const [cmd, ...rest] = text.split(/\s+/);
          if (cmd && INK_RECOGNIZED_COMMANDS.has(cmd)) {
            pendingCommand = { cmd, args: rest };
            return null; // unmount this Ink instance so dispatchInkCommand can use the real terminal
          }
          return {
            text: `${cmd} isn't available in the Ink shell yet — restart with --tui=legacy for the full command palette.`,
          };
        }
        chatHistory.push({ role: "user", text });
        const reply = await resolveChatReply(text, g, chatHistory);
        chatHistory.push({ role: "assistant", text: reply.text, agent: reply.agent });
        return reply;
      },
      onCycleAgent: () => cycleWorkerSelection(current, g),
    });
    const { agentCycled, input } = inkResult;

    // Ink's unmount leaves stdin's underlying TTY handle in a state where `isRaw`/`isPaused`/
    // `readableFlowing` all report normally but no further 'data' ever arrives — every subsequent
    // consumer (a fresh Ink mount below, or the legacy prompts inside `dispatchInkCommand`) needs
    // stdin actually delivering input, so this runs once here, right after any unmount, before
    // anything else touches it.
    reclaimStdinAfterInk();

    if (shouldRemountInkSession(inkResult)) {
      // `runInkApp` already unmounted the old instance and cleared the screen for us (see its own,
      // much longer comment for why a full unmount+remount — not an in-place fix — is the only
      // reliable way to clear Ink's terminal-width line-count corruption,
      // https://github.com/vadimdemedes/ink/issues/907, and why it also has to suppress the
      // instance's own writes for the duration of the resize rather than just cleaning up
      // afterward). Agent-cycle remounts follow the same shape so the welcome banner's static
      // worker label can be replayed with the new selection instead of ending the session. Just
      // carry the draft forward and loop back to mount fresh.
      carryInput = input;
      if (agentCycled && tty) clearScreen();
      continue;
    }

    if (!pendingCommand) return; // a real /quit, /exit, or Ctrl+C — end the session

    showWelcome = false;
    carryInput = undefined;
    await dispatchInkCommand(pendingCommand, g, tty, current);
    current = await buildHomeModel(g);
    current.chatHistory = chatHistory;
    // Every `dispatchInkCommand` handler ends by writing its own overlay text directly to the
    // terminal (via `log.info`/`endOverlay`'s "Press any key to continue…") and leaves it on screen.
    // Without a clear here, the Ink shell's fresh mount (transcript + composer + footer, re-seeded
    // via `initialHistory` — see `Transcript`) would just get appended right after that leftover
    // overlay text instead of starting on a clean screen. This is safe to do with `<Static>` still
    // in the tree (unlike clearing *during* a mount, e.g. the old approach to resize this replaced —
    // see the comment on `InkApp`'s resize-settle effect): clearing happens *between* one Ink
    // instance unmounting and the next one mounting, and the new instance immediately reprints
    // everything via `initialHistory`, so nothing is actually lost.
    if (tty) clearScreen();
  }
}

export async function runInteractive(g: GlobalOpts): Promise<void> {
  const chatHistory: ChatTurn[] = [];
  let model = await buildHomeModel(g);
  model.chatHistory = chatHistory;
  if (g.tui === "ink") {
    await runInkInteractive(g, model);
    return;
  }
  const refreshModel = async () => {
    // A completed /implement's output stays visible across a rebuild — same rule as chatHistory —
    // until the user actually moves on (another /implement replaces it, a chat message clears it).
    const { runLog, runObjective, runPending, runStatus } = model;
    model = await buildHomeModel(g);
    model.chatHistory = chatHistory;
    model.runLog = runLog;
    model.runObjective = runObjective;
    model.runPending = runPending;
    model.runStatus = runStatus;
  };
  const tty = isRealTty();

  for (;;) {
    if (!tty) process.stdout.write(renderHome(model));
    const input = (await readHomeMessage(model, g))?.trim();
    if (input === undefined || input === "" || input === "/quit" || input === "/exit") {
      outro("Bye.");
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
        pending.mode = rest[0] as WorkflowMode | undefined;
        await showOverlay("Mode", [`Next /implement's mode: ${pending.mode ?? "(default)"}`], tty);
      } else if (cmd === "/implement") {
        const objective = rest.join(" ").trim();
        if (!objective) {
          await showOverlay("Implement", ["Usage: /implement <task>", "", "Example: /implement fix the login redirect bug"], tty);
        } else {
          // The routing confirmation preview (table + Yes/No, inside execute()) still prints
          // straight to the terminal on this cleared screen — same gate as /setup, /clone, etc. Only
          // what happens AFTER confirming (the actual run) moves inline into the home screen below,
          // instead of the whole thing feeling like it jumped to a separate raw-log page.
          if (tty) clearScreen();
          else process.stdout.write("\n");
          const drawRun = () => {
            if (tty) clearScreen();
            process.stdout.write(renderHome(model, { value: "" }));
            if (tty) placeCursorInComposer("");
          };
          // Lazy: only actually enter "running" view once the confirmation is accepted and the
          // orchestrator emits its first line — declining the confirmation should leave the home
          // screen exactly as it was, not flash an empty "Running:" view.
          const ensureStarted = () => {
            if (model.runLog === undefined) {
              model.runLog = [];
              model.runObjective = objective;
              model.runPending = true;
            }
          };
          const releaseInput = tty ? captureStdinDuringRun() : () => {};
          try {
            await execute(
              objective,
              { mode: pending.mode, skip: [], route: [], disableWorker: [], criteria: [] },
              g,
              tty
                ? {
                    onLine: (line) => {
                      ensureStarted();
                      model.runLog!.push(line);
                      drawRun();
                    },
                    onStatus: (frame) => {
                      ensureStarted();
                      model.runStatus = frame;
                      drawRun();
                    },
                  }
                : undefined,
            );
          } catch {
            // execute() already appended the error as a run line via onLine before rethrowing —
            // just stop it from crashing the interactive loop.
          } finally {
            releaseInput();
            model.runPending = false;
            if (model.runLog !== undefined) drawRun();
          }
          pending.mode = undefined;
          await refreshModel();
        }
      } else {
        await showOverlay("Unknown command", [`${cmd}. Try /help.`], tty);
      }
      // The next loop turn redraws home fresh (via readHomeSlotMessage on a TTY, or the
      // top-of-loop write otherwise) — no separate redraw needed here.
      continue;
    }

    // Plain text is a chat message, not a task — nothing runs against the workspace unless the
    // user explicitly says so with /implement (or picks a task suggestion, which routes through
    // /implement itself; see resolveSuggestionSubmission in ui/home.ts). Stays inline in the
    // scrolling transcript (like a real chat CLI) rather than a full-screen "press any key" overlay.
    await runChat(input, model, chatHistory, g, tty);
  }
}

/** Full-screen command output — clears, shows the message, waits for a key, then the caller redraws home. */
/** The "/setup" suggestion's actual effect: scaffold .gr-agent/ in place, same as `gr-agent init`. */
/** After scaffolding, /setup switches the rest of this session into the new folder. */
async function endOverlay(tty: boolean): Promise<void> {
  if (tty) {
    process.stdout.write(`\n${pc.dim("Press any key to continue…")}`);
    await waitForKey();
  } else {
    process.stdout.write("\n");
  }
}

async function runSetupInit(g: GlobalOpts, tty: boolean, initialised: boolean): Promise<void> {
  if (tty) clearScreen();
  else process.stdout.write("\n");

  const defaultParent = path.resolve(g.workspace ?? process.cwd());

  if (!interactive()) {
    // No prompting possible — scaffold the current workspace in place, same as `gr-agent init`.
    if (!initialised) logScaffoldResult(await scaffoldWorkspace(defaultParent));
    await endOverlay(tty);
    return;
  }

  if (initialised) {
    log.info(pc.bold("Workspace setup"));
    log.info(pc.dim(`Already set up at ${defaultParent}.`));
    log.info("");
    const choice = await select("What would you like to do?", [
      { value: "switch", label: "Create / switch to a different project folder" },
      { value: "remove", label: "Remove the current setup (.gr-agent/)" },
      { value: "cancel", label: "Cancel" },
    ]);
    if (choice === "remove") {
      const paths = new RiqsPaths(defaultParent);
      const removed = await confirm(`Delete ${paths.dir}? This cannot be undone.`, false);
      if (removed) {
        await fs.rm(paths.dir, { recursive: true, force: true });
        log.success(`Removed ${paths.dir}. This workspace is no longer initialised.`);
      } else {
        log.warn("Cancelled — nothing removed.");
      }
      await endOverlay(tty);
      return;
    }
    if (choice !== "switch") {
      log.warn("Cancelled.");
      await endOverlay(tty);
      return;
    }
    // "switch" falls through to the same create-a-folder flow used before init.
  }

  log.info(pc.bold(initialised ? "Switch project folder" : "New gR DEV AGENT workspace"));
  log.info(pc.dim("Where should the project folder be created?"));
  log.info("");

  const parentInput = await text("Parent directory", defaultParent);
  if (parentInput === null) {
    log.warn("Setup cancelled.");
    await endOverlay(tty);
    return;
  }
  const parent = path.resolve(parentInput.trim() || defaultParent);

  const folderName = await text("New folder name", "my-project");
  if (!folderName || !folderName.trim()) {
    log.warn("Setup cancelled — no folder name given.");
    await endOverlay(tty);
    return;
  }

  const targetDir = path.resolve(parent, folderName.trim());
  const alreadyExists = await fs.stat(targetDir).then((s) => s.isDirectory()).catch(() => false);
  if (alreadyExists) {
    log.info(`Using existing folder: ${targetDir}`);
  } else {
    await fs.mkdir(targetDir, { recursive: true });
    log.success(`Created folder: ${targetDir}`);
  }

  logScaffoldResult(await scaffoldWorkspace(targetDir));

  // The rest of this interactive session now operates on the new workspace.
  g.workspace = targetDir;
  log.info(pc.dim(`\nWorkspace switched to ${targetDir}`));

  await endOverlay(tty);
}

/**
 * The "/clone" suggestion's real action — offered once the workspace is initialised but has no
 * project code yet. Clones into a fresh sub-folder (git refuses to clone into a non-empty directory,
 * and the workspace root already holds .gr-agent/ + the adapter files) rather than the root itself.
 */
async function runCloneRepo(g: GlobalOpts, tty: boolean): Promise<void> {
  if (tty) clearScreen();
  else process.stdout.write("\n");

  const root = path.resolve(g.workspace ?? process.cwd());

  if (!interactive()) {
    log.warn("Cannot ask for a repository URL in non-interactive mode — run `git clone <url>` yourself, then re-run.");
    await endOverlay(tty);
    return;
  }

  log.info(pc.bold("Clone a repository"));
  log.info(pc.dim(`Into a new folder under: ${root}`));
  log.info("");

  const url = await text("Git URL (https:// or git@...)", "https://github.com/org/repo.git");
  if (!url || !url.trim()) {
    log.warn("Cancelled — no URL given.");
    await endOverlay(tty);
    return;
  }

  const gitExe = await Platform.findExecutable("git");
  if (!gitExe) {
    log.error("git was not found on PATH — install Git, then try /clone again.");
    await endOverlay(tty);
    return;
  }

  log.step(`git clone ${url.trim()}`);
  const res = await Platform.run(gitExe, ["clone", url.trim()], { cwd: root, inherit: true, timeoutMs: 15 * 60_000 });
  if (res.exitCode === 0) {
    log.success("Repository cloned.");
  } else {
    log.error(`git clone exited with code ${res.exitCode}.`);
  }

  await endOverlay(tty);
}

const READINESS_LABEL: Record<string, string> = {
  ready: "ready",
  installed: "installed, auth unverified",
  login_required: "installed, needs login",
  missing: "not installed",
  broken: "broken",
  unsupported: "unsupported",
};

/**
 * "/agents" and "/workers" both land here — the actual answer to "how do I use Claude/Codex/Cursor":
 * detect what's really installed and authenticated, let the user pick one, and persist it as the
 * workspace's primaryWorker so the router prefers it. Never silently claims a worker is ready.
 */
async function runSelectWorker(g: GlobalOpts, tty: boolean, initialised: boolean): Promise<void> {
  if (tty) clearScreen();
  else process.stdout.write("\n");

  if (!initialised) {
    log.warn("Run /setup first — worker choice is saved into .gr-agent/config.json.");
    await endOverlay(tty);
    return;
  }
  if (!interactive()) {
    log.warn("Cannot prompt for a worker in non-interactive mode. Use `gr-agent workers enable <id>` and `gr-agent run --worker <id>` instead.");
    await endOverlay(tty);
    return;
  }

  const root = path.resolve(g.workspace ?? process.cwd());
  log.info(pc.bold("Choose a worker"));
  log.info(pc.dim("Checking installed agent CLIs and the native provider…"));
  log.info("");

  const [statuses, nativeProvider] = await Promise.all([detectAll(), detectNativeProvider()]);
  const options = [
    { value: "native", label: `Native — ${nativeProvider === "no provider" ? "no provider configured" : `ready (${nativeProvider})`}` },
    ...statuses.map((s) => ({ value: s.id, label: `${s.displayName} — ${READINESS_LABEL[s.readiness] ?? s.readiness}` })),
  ];

  const choice = await select("Use which worker for tasks in this workspace?", options);
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
    const proceed = await confirm("Select it anyway? Tasks will fall back to a manual handoff until it's ready.", false);
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
  log.info(pc.dim("Change it any time with /agents. This doesn't disable other enabled workers for other roles."));

  await endOverlay(tty);
}

/** CLIs with a genuine, safe, non-interactive "list models" command whose output we can parse —
 * never a fabricated list. Verified live against each tool's real output format. */
interface ModelOption {
  value: string;
  label: string;
}

interface ModelLister {
  /** Run this command and parse its stdout live (cursor/opencode both have a genuine listing command). */
  args?: string[];
  parse?: (stdout: string) => ModelOption[];
  /** A fixed list, for a CLI with no listing command of its own — only ever populated from something
   * directly observed straight from that tool's own UI (e.g. its interactive /model picker), never
   * guessed. Codex's own picker doesn't expose a shell command for this, so this is that list as
   * captured live; it can drift as the vendor changes their lineup. */
  staticOptions?: ModelOption[];
}

export const MODEL_LISTERS: Record<string, ModelLister> = {
  cursor: {
    args: ["models"],
    // "auto - Auto (current, default)" / "gpt-5.3-codex - Codex 5.3" / ...
    parse: (out) =>
      out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.includes(" - "))
        .map((l) => {
          const idx = l.indexOf(" - ");
          const value = l.slice(0, idx).trim();
          const label = l.slice(idx + 3).trim();
          return { value, label: label || value };
        }),
  },
  opencode: {
    // one "provider/model" id per line, no separate label
    args: ["models"],
    parse: (out) =>
      out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("["))
        .map((id) => ({ value: id, label: id })),
  },
  // Captured directly from `codex`'s own interactive "Select Model and Effort" picker (no
  // non-interactive listing command exists to query this live) — real ids, real current default.
  codex: {
    staticOptions: [
      { value: "gpt-5.6-sol", label: "gpt-5.6-sol (default) — reliable agentic workhorse for everyday tasks" },
      { value: "gpt-5.6-terra", label: "gpt-5.6-terra — balanced agentic coding model for everyday work" },
      { value: "gpt-5.6-luna", label: "gpt-5.6-luna — fast and affordable agentic coding model" },
      { value: "gpt-5.5", label: "gpt-5.5 — proven previous-generation model for coding and general work" },
      { value: "gpt-5.4", label: "gpt-5.4 — strong model for everyday coding" },
      { value: "gpt-5.4-mini", label: "gpt-5.4-mini — small, fast, cost-efficient for simpler coding tasks" },
    ],
  },
};

/** Alias -> display label, straight from claude's own "Select model" picker (its --help lists
 * sonnet/opus/fable as aliases; the picker itself additionally shows haiku, and labels each with
 * its current version number). The alias (not the label) is what's actually passed to --model. */
export const CLAUDE_MODEL_ALIASES: ModelOption[] = [
  { value: "sonnet", label: "Sonnet 5" },
  { value: "opus", label: "Opus 5" },
  { value: "fable", label: "Fable 5" },
  { value: "haiku", label: "Haiku 4.5" },
];

/**
 * /model: pick which model the current worker's CLI should use for chat/tasks, saved into
 * agents.json (which chatViaAgentCli and CliWorker already read). For a CLI that can safely list
 * its own real models (cursor, opencode) that list drives the picker; for one that can't (claude,
 * codex, antigravity) we never invent a list — claude gets its own documented aliases plus a
 * type-it-yourself option, everything else is just a free-text prompt with a clear caveat.
 */
async function runSelectModel(g: GlobalOpts, tty: boolean, initialised: boolean): Promise<void> {
  if (tty) clearScreen();
  else process.stdout.write("\n");

  if (!initialised) {
    log.warn("Run /setup first — the model choice is saved into .gr-agent/agents.json.");
    await endOverlay(tty);
    return;
  }
  if (!interactive()) {
    log.warn("Cannot prompt for a model in non-interactive mode. Edit .gr-agent/agents.json directly instead.");
    await endOverlay(tty);
    return;
  }

  const root = path.resolve(g.workspace ?? process.cwd());
  const loaded = await loadConfig(root);
  const workerId = loaded.config.primaryWorker ?? "native";

  if (workerId === "native") {
    log.warn("The native worker's model comes from .gr-agent/config.json (native.default / native.providers), not /model.");
    log.info(pc.dim("Pick a CLI-based worker with /agents (or tab) first if you want to choose its model here."));
    await endOverlay(tty);
    return;
  }

  const manifest = await loadManifest().catch(() => null);
  const entry = manifest?.integrations[workerId];
  const displayName = entry?.displayName ?? workerId;
  // Pre-select whatever is already configured, so reopening /model doesn't silently jump back to
  // the first option — it should show (and default back to) the choice you already made.
  const currentModel = loaded.agents.agents[workerId]?.model;
  const currentModelValue = currentModel && currentModel !== "default" ? currentModel : undefined;

  let choice: string | null = null;
  // Tracks whether the user actually saw a picker (and so could have pressed Escape to back out of
  // it on purpose) — without this, cancelling the searchable list fell through to "no list
  // available, type one in" instead of just cancelling, because both cases return null from choice.
  let pickerShown = false;
  const lister = MODEL_LISTERS[workerId];
  if (lister?.staticOptions) {
    pickerShown = true;
    choice = await autocomplete(`Model for ${displayName}:`, lister.staticOptions, currentModelValue);
  } else if (lister?.args && lister.parse && entry) {
    let exe: string | null = null;
    for (const name of entry.executables) {
      exe = await Platform.findExecutable(name);
      if (exe) break;
    }
    if (exe) {
      log.info(pc.dim(`Checking ${displayName}'s available models…`));
      try {
        const run = await Platform.run(exe, lister.args, { cwd: root, timeoutMs: 20_000 });
        const options = lister.parse(stripAnsi(run.stdout));
        // A CLI can list a LOT of real models (Cursor: ~200+, Open Code: ~90) — a plain arrow-key
        // select() over that many rows is unusable, so this uses the searchable autocomplete prompt
        // instead (type-to-filter), same as the shorter lists just for consistency.
        if (options.length > 0) {
          pickerShown = true;
          choice = await autocomplete(`Model for ${displayName}:`, options, currentModelValue);
        } else log.warn(`${displayName} didn't return a model list — falling back to typing one in.`);
      } catch {
        log.warn(`Couldn't list ${displayName}'s models — falling back to typing one in.`);
      }
    }
  }

  if (choice === null && !pickerShown) {
    if (workerId === "claude") {
      const pick = await autocomplete(
        `Model for ${displayName}:`,
        [...CLAUDE_MODEL_ALIASES, { value: "__other__", label: "Other — type a full model name" }],
        currentModelValue,
      );
      choice = pick === "__other__" ? await text("Model name (e.g. claude-sonnet-4-5-20250929):") : pick;
    } else {
      log.warn(`No verified way to list ${displayName}'s models — check its own docs, then type one in.`);
      choice = await text(`Model for ${displayName}:`);
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
  log.info(pc.dim("Change it any time with /model. Switching workers with /agents or tab doesn't clear this."));
  await endOverlay(tty);
}

const CHAT_SYSTEM_PROMPT =
  "You are the chat assistant built into gR DEV AGENT, a vendor-neutral multi-agent engineering CLI. " +
  "Answer the user's message directly and conversationally — you have no tools here and cannot read, " +
  "search, or modify the user's codebase from this chat. If the user is describing (or asks you to do) " +
  "an actual engineering task on their code — investigate a bug, implement something, review a change, " +
  "run tests — do NOT attempt it yourself: tell them to run it with `/implement <task>`, which hands it to the " +
  "real investigate -> implement -> test -> review workflow. Keep replies brief.";

/** Same framing, phrased for an external agent CLI invoked directly (no repo/tool access granted here). */
const CHAT_CLI_PREFIX =
  "You are being asked a quick chat question inside gR DEV AGENT, not given a full engineering task — " +
  "just answer briefly, don't explore the repository or make any changes. If this message actually " +
  "describes a real engineering task, tell the user to run it with `/implement <task>` instead.\n\n";

/** How much prior conversation to feed back in on every turn — switching workers (Tab/agents) mid-
 * chat, or just continuing, shouldn't lose context. Each external CLI call is a fresh one-shot
 * process with no session memory of its own, so this is re-sent every time; capped so a long-running
 * chat doesn't make every single turn slower and pricier as it grows. */
const CHAT_HISTORY_TURNS = 10;

/** chatHistory's last entry is always the turn just pushed by the caller (the current input) —
 * everything before that is genuine prior context. */
export function recentHistory(chatHistory: ChatTurn[]): ChatTurn[] {
  return chatHistory.slice(0, -1).slice(-CHAT_HISTORY_TURNS);
}

/** Prior turns rendered as plain text, for an external CLI that has no concept of a message array —
 * empty string for the first turn of a conversation. */
export function historyTranscript(chatHistory: ChatTurn[]): string {
  const prior = recentHistory(chatHistory);
  if (prior.length === 0) return "";
  const lines = prior.map((t) => (t.role === "user" ? `User: ${t.text}` : `${t.agent ?? "Assistant"}: ${t.text}`));
  return `Conversation so far (you may have been a different agent for earlier turns):\n${lines.join("\n")}\n\n`;
}

export interface ChatReply {
  text: string;
  agent?: string;
}

/**
 * The actual chat-dispatch logic behind plain (non-"/") input — resolves the workspace's primary
 * worker, expands "@<path>" attachments, and falls back to the native provider when the primary
 * worker is "native" or its CLI isn't available. Pulled out of `runChat` so a different front end
 * (e.g. the Ink TUI in `src/ui/ink/`) can reuse the exact same dispatch instead of re-implementing
 * it — the only difference between callers should be how the reply gets drawn, never how it's
 * fetched.
 */
export async function resolveChatReply(input: string, g: GlobalOpts, chatHistory: ChatTurn[]): Promise<ChatReply> {
  const root = path.resolve(g.workspace ?? process.cwd());
  await Platform.loadDotEnv(root);
  const loaded = await loadConfig(root);
  const workerId = loaded.config.primaryWorker ?? "native";
  const configuredModel = loaded.agents.agents[workerId]?.model;
  // Expand any "@<path>" reference into the file's real content for this call only — the short
  // "@path" form stays in chatHistory so the visible transcript doesn't fill up with an entire
  // attached document every time it's mentioned.
  const { text: expandedInput } = await expandAttachments(input, root);
  return (
    (workerId !== "native" ? await chatViaAgentCli(workerId, expandedInput, root, configuredModel, chatHistory) : null) ??
    (await chatViaNativeProvider(expandedInput, loaded.config, chatHistory))
  );
}

/**
 * Default handler for plain (non-"/") input: a lightweight, single-turn chat reply — no orchestrator,
 * no plan, no worktree, no structured-result handling. Running an actual task against the workspace
 * always requires the explicit /implement command.
 *
 * Stays inline in the scrolling transcript (chatHistory), like a real chat CLI, instead of a
 * full-screen "press any key" overlay — the turn appears immediately with a "Thinking…" placeholder,
 * then updates in place once the reply comes back.
 *
 * Chat uses whatever the workspace's primary worker actually is (set via /agents), not a separate,
 * possibly-unconfigured provider — showing "Agent claude" in the header and then quietly answering
 * via Ollama instead would be confusing and wrong. Only when the primary worker is "native" (or its
 * CLI isn't available) does this fall back to the configured native LLM provider.
 */
async function runChat(input: string, model: HomeModel, chatHistory: ChatTurn[], g: GlobalOpts, tty: boolean): Promise<void> {
  model.runLog = undefined; // a chat message means the user has moved on from a finished /implement's output
  chatHistory.push({ role: "user", text: input });
  const draw = (pending: boolean) => {
    if (tty) clearScreen();
    // Pass an (empty, non-interactive) composer state so the input row still renders as a prompt +
    // placeholder while waiting — renderHome() draws a blank line instead of the composer when no
    // composer state is given at all, which is what made the input box vanish during "Thinking…".
    process.stdout.write(renderHome({ ...model, chatHistory, chatPending: pending }, { value: "" }));
    // Without this the real terminal cursor is left sitting below the footer (wherever the last
    // written line ended) instead of in the composer — looked exactly like the input box was dead.
    if (tty) placeCursorInComposer("");
  };
  draw(true);

  // readHomeSlotMessage() already released stdin back to normal (cooked) mode before returning —
  // between here and the next composer prompt nothing is reading stdin, so without this, anything
  // typed while "Thinking…" was just echoed straight onto the terminal by the OS, corrupting the
  // frame. Capture it (raw + no listener consuming real input) until the reply is ready.
  const releaseInput = tty ? captureStdinWhilePending() : () => {};

  // Everything below must go through finally: if any of this throws (a bad config.json, an
  // unexpected non-Error rejection, anything) without releasing stdin first, the composer stays
  // captured forever — the input box would look permanently dead instead of just showing an error.
  let reply: ChatReply;
  try {
    reply = await resolveChatReply(input, g, chatHistory);
  } catch (e) {
    reply = { text: `Something went wrong: ${(e as Error).message}\n\nTo run this as a real task instead: /implement ${input}` };
  } finally {
    releaseInput();
  }

  chatHistory.push({ role: "assistant", text: reply.text, agent: reply.agent });
  draw(false);
}

/** Hold stdin in raw mode with keystrokes swallowed (Ctrl+C still quits) while a chat/CLI call is in
 * flight, so typing during "Thinking…" doesn't fall through to the terminal's own line-buffered echo.
 * Returns a release function that restores stdin to how it was before. */
function captureStdinWhilePending(): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};
  const wasRaw = stdin.isRaw;
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }) => {
    if (key.ctrl && key.name === "c") {
      outro("Bye.");
      process.exit(0);
    }
    // Anything else: swallowed on purpose — there's no composer to type into until the reply lands.
  };
  stdin.on("keypress", onKeypress);
  return () => {
    stdin.off("keypress", onKeypress);
    if (!wasRaw) stdin.setRawMode(false);
  };
}

/** Same idea as captureStdinWhilePending, but for an inline /implement: Ctrl+C sends a real SIGINT to this
 * process instead of hard-exiting it — raw mode otherwise stops Ctrl+C from generating one on its
 * own, and /implement's own SIGINT handler (in execute()) does a graceful abort + checkpoint, which a hard
 * exit here would just skip entirely. */
function captureStdinDuringRun(): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};
  const wasRaw = stdin.isRaw;
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  const onKeypress = (_str: string, key: { name?: string; ctrl?: boolean }) => {
    if (key.ctrl && key.name === "c") process.kill(process.pid, "SIGINT");
    // Anything else: swallowed on purpose — the composer isn't available until the run finishes.
  };
  stdin.on("keypress", onKeypress);
  return () => {
    stdin.off("keypress", onKeypress);
    if (!wasRaw) stdin.setRawMode(false);
  };
}

/**
 * Try the workspace's actual chosen agent CLI for a quick chat reply, using the same verified argv
 * template as a real task invocation (integrations.manifest.json) but a short chat-framed prompt
 * instead of the full investigate/memory envelope. Returns null (nothing shown) only when the worker
 * is unknown or its CLI isn't installed, so the caller falls back to the native provider; any other
 * failure (bad exit, timeout) is returned as the reply text rather than silently substituting a
 * different, unrelated provider.
 */
/**
 * `configuredModel` is whatever /agents (or `gr-agent agents create/edit`) has explicitly recorded
 * for this worker in agents.json. We only show it in parentheses when it's a real, user-set value —
 * never a guessed default, since we don't actually control (or know) which model the CLI's own
 * account/settings pick when we don't pass --model ourselves.
 */
async function chatViaAgentCli(workerId: string, input: string, root: string, configuredModel: string | undefined, chatHistory: ChatTurn[]): Promise<ChatReply | null> {
  const manifest = await loadManifest().catch(() => null);
  const entry = manifest?.integrations[workerId];
  if (!entry) return null;
  const modelForLabel = (configuredModel && configuredModel !== "default" ? configuredModel : undefined) ?? entry.defaultModelLabel;
  const label = modelForLabel ? `${entry.displayName} (${modelForLabel})` : entry.displayName;

  let exe: string | null = null;
  for (const name of entry.executables) {
    exe = await Platform.findExecutable(name);
    if (exe) break;
  }
  if (!exe) return null;

  const prompt = CHAT_CLI_PREFIX + historyTranscript(chatHistory) + `User: ${input}`;
  let promptFile: string | undefined;
  if (entry.worker.promptDelivery === "file") {
    promptFile = path.join(Platform.tmpDir(), `gr-agent-chat-${Date.now()}.txt`);
    await fs.writeFile(promptFile, prompt, "utf8");
  }
  // Only ever pass --model when the user explicitly chose one via /model, from a real verified list
  // (or typed it in themselves) — never the merely-observed defaultModelLabel, which is for display
  // only. If unset, {model} and the flag naming it (e.g. "--model") are dropped together so the CLI
  // falls back to its own default instead of getting a lone dangling flag.
  const modelValue = configuredModel && configuredModel !== "default" ? configuredModel : undefined;
  const argv: string[] = [];
  for (const raw of entry.worker.argv) {
    const t = raw === "{prompt}" ? prompt : raw === "{promptFile}" ? (promptFile ?? "") : raw;
    if (t === "{model}") {
      if (modelValue) argv.push(modelValue);
      else argv.pop(); // remove the flag token just pushed (e.g. "--model") along with it
      continue;
    }
    if (t === "" || (t.startsWith("{") && t.endsWith("}"))) continue; // other unresolved placeholders ({cwd}/{objective}/{resultFile})
    argv.push(t);
  }

  try {
    const run = await Platform.run(exe, argv, {
      cwd: root,
      input: entry.worker.promptDelivery === "stdin" ? prompt : undefined,
      timeoutMs: 120_000,
    });
    const text = stripAnsi(run.stdout).trim();
    if (run.exitCode === 0 && text) return { text: text.slice(0, 4000), agent: label };
    const errText = stripAnsi(run.stderr).trim().slice(0, 800);
    return {
      text: `${entry.displayName} exited ${run.exitCode} with no usable output.${errText ? `\n${errText}` : ""}\n\nTo run this as a real task instead: /implement ${input}`,
      agent: label,
    };
  } catch (e) {
    return { text: `${(e as Error).message}\n\nTo run this as a real task instead: /implement ${input}`, agent: label };
  } finally {
    if (promptFile) await fs.rm(promptFile, { force: true }).catch(() => {});
  }
}

async function chatViaNativeProvider(input: string, config: Config, chatHistory: ChatTurn[]): Promise<ChatReply> {
  let resolved: ReturnType<typeof resolveNativeProvider>;
  try {
    resolved = resolveNativeProvider(config);
  } catch (e) {
    return {
      text: `${(e as Error).message}\n\nSet ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY, or run a local Ollama.\n\nTo run this as a real task instead: /implement ${input}`,
    };
  }

  // Native is the one case we genuinely know the model for — it's whatever we just resolved and are
  // about to call, not a guess.
  const modelName = resolved.model && resolved.model !== "default" ? resolved.model : resolved.provider.defaultModel;
  const label = `Native (${modelName})`;

  // Native's own chat() takes a real message array, so prior turns (even ones another agent
  // answered — the label is lost here, but the content carries over) become proper history instead
  // of flattened text.
  const messages: ChatMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...recentHistory(chatHistory).map((t): ChatMessage => ({ role: t.role === "user" ? "user" : "assistant", content: t.text })),
    { role: "user", content: input },
  ];

  try {
    const res = await resolved.provider.chat(messages, { maxOutputTokens: 800 });
    return { text: res.text.trim() || "(empty response)", agent: label };
  } catch (e) {
    return { text: `${(e as Error).message}\n\nTo run this as a real task instead: /implement ${input}`, agent: label };
  }
}

/** "2026-09-05T14-30-00-a-short-slug" — timestamp first so files sort chronologically in the
 * plans/specs folder, then a lowercased, hyphenated slice of the objective so the filename still
 * says something on its own. Never empty: an objective that's all punctuation/whitespace (or a
 * @-attachment reference with nothing else) falls back to "untitled" rather than an empty slug. */
function slugify(objective: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const words = objective
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${stamp}-${words || "untitled"}`;
}

/** System framing for "/plan" — deliberately the opposite instruction from `CHAT_SYSTEM_PROMPT`
 * (which tells the model to *decline* engineering tasks and point at `/implement`): here the model
 * has no repo access either, but the whole point of the command is to think through an approach in
 * writing, not to defer it. */
const PLAN_DOC_SYSTEM_PROMPT =
  "You are the planning assistant inside gR DEV AGENT, a vendor-neutral multi-agent engineering CLI. " +
  "The user wants a written implementation PLAN for a task, not code changes — you have no repository " +
  "access in this call, so plan conceptually from the description given. Write a clear, actionable " +
  "Markdown document with these sections: Overview, Implementation steps (numbered), Files/areas " +
  "likely affected, Risks & edge cases, Testing approach. Output only the Markdown body (no top-level " +
  "title — the caller adds its own heading), no preamble, no code diffs, no questions back to the user.";

/** Same idea as `PLAN_DOC_SYSTEM_PROMPT`, for "/spec". */
const SPEC_DOC_SYSTEM_PROMPT =
  "You are the specification assistant inside gR DEV AGENT, a vendor-neutral multi-agent engineering " +
  "CLI. The user wants a written SPECIFICATION for a feature or task, not code changes — you have no " +
  "repository access in this call, so write from the description given. Produce a clear Markdown " +
  "document with these sections: Summary, Goals, Non-goals, Requirements / acceptance criteria, Open " +
  "questions (if any). Output only the Markdown body (no top-level title — the caller adds its own " +
  "heading), no preamble, no code diffs, no questions back to the user.";

/**
 * "/plan" and "/spec" both need the same thing chat does — a single-shot call to whatever the
 * workspace's primary worker is, agent CLI first, native provider as the fallback — but with their
 * own system framing (see `PLAN_DOC_SYSTEM_PROMPT`/`SPEC_DOC_SYSTEM_PROMPT` above) instead of
 * `CHAT_SYSTEM_PROMPT`'s "defer to /implement" framing, and no chat history to carry (each document
 * is generated fresh from just the objective given). Mirrors `resolveChatReply`'s own dispatch
 * rather than reusing it directly, via the sibling `docViaAgentCli`/`docViaNativeProvider` below.
 */
async function generateWorkerDocument(kind: "plan" | "spec", objective: string, g: GlobalOpts): Promise<ChatReply> {
  const root = path.resolve(g.workspace ?? process.cwd());
  await Platform.loadDotEnv(root);
  const loaded = await loadConfig(root);
  const workerId = loaded.config.primaryWorker ?? "native";
  const configuredModel = loaded.agents.agents[workerId]?.model;
  const systemPrompt = kind === "plan" ? PLAN_DOC_SYSTEM_PROMPT : SPEC_DOC_SYSTEM_PROMPT;
  // Same "@<path>" expansion chat gets — so "/plan fix the bug in @src/foo.ts" hands the model the
  // file's real content instead of the literal "@src/foo.ts" text.
  const { text: expandedObjective } = await expandAttachments(objective, root);

  const viaCli = workerId !== "native" ? await docViaAgentCli(workerId, systemPrompt, expandedObjective, root, configuredModel) : null;
  return viaCli ?? (await docViaNativeProvider(systemPrompt, expandedObjective, loaded.config));
}

/** Same CLI-invocation mechanics as `chatViaAgentCli` (find the executable, build argv from the
 * integration manifest, run it) but for a one-shot document prompt instead of a chat turn: no prior
 * history to flatten, a much longer timeout (a plan/spec is worth waiting longer for than a chat
 * reply), and a bigger output cap. Kept as its own function rather than parameterizing
 * `chatViaAgentCli` — the two have different enough shapes (system prompt vs. chat-prefix framing,
 * no history) that sharing one function would need more branching than it'd save. */
async function docViaAgentCli(
  workerId: string,
  systemPrompt: string,
  objective: string,
  root: string,
  configuredModel: string | undefined,
): Promise<ChatReply | null> {
  const manifest = await loadManifest().catch(() => null);
  const entry = manifest?.integrations[workerId];
  if (!entry) return null;
  const modelForLabel = (configuredModel && configuredModel !== "default" ? configuredModel : undefined) ?? entry.defaultModelLabel;
  const label = modelForLabel ? `${entry.displayName} (${modelForLabel})` : entry.displayName;

  let exe: string | null = null;
  for (const name of entry.executables) {
    exe = await Platform.findExecutable(name);
    if (exe) break;
  }
  if (!exe) return null;

  const prompt = `${systemPrompt}\n\nTask:\n${objective}`;
  let promptFile: string | undefined;
  if (entry.worker.promptDelivery === "file") {
    promptFile = path.join(Platform.tmpDir(), `gr-agent-doc-${Date.now()}.txt`);
    await fs.writeFile(promptFile, prompt, "utf8");
  }
  const modelValue = configuredModel && configuredModel !== "default" ? configuredModel : undefined;
  const argv: string[] = [];
  for (const raw of entry.worker.argv) {
    const t = raw === "{prompt}" ? prompt : raw === "{promptFile}" ? (promptFile ?? "") : raw;
    if (t === "{model}") {
      if (modelValue) argv.push(modelValue);
      else argv.pop(); // remove the flag token just pushed (e.g. "--model") along with it
      continue;
    }
    if (t === "" || (t.startsWith("{") && t.endsWith("}"))) continue;
    argv.push(t);
  }

  try {
    const run = await Platform.run(exe, argv, {
      cwd: root,
      input: entry.worker.promptDelivery === "stdin" ? prompt : undefined,
      timeoutMs: 180_000,
    });
    const text = stripAnsi(run.stdout).trim();
    if (run.exitCode === 0 && text) return { text: text.slice(0, 12_000), agent: label };
    const errText = stripAnsi(run.stderr).trim().slice(0, 800);
    return {
      text: `${entry.displayName} exited ${run.exitCode} with no usable output.${errText ? `\n${errText}` : ""}`,
      agent: label,
    };
  } catch (e) {
    return { text: `${(e as Error).message}`, agent: label };
  } finally {
    if (promptFile) await fs.rm(promptFile, { force: true }).catch(() => {});
  }
}

/** Native-provider counterpart to `docViaAgentCli` — see its comment for why this isn't just
 * `chatViaNativeProvider` with a different prompt (different system framing, no chat history, a
 * bigger token budget since a plan/spec is meant to be a real document, not a chat-sized reply). */
async function docViaNativeProvider(systemPrompt: string, objective: string, config: Config): Promise<ChatReply> {
  let resolved: ReturnType<typeof resolveNativeProvider>;
  try {
    resolved = resolveNativeProvider(config);
  } catch (e) {
    return { text: `${(e as Error).message}\n\nSet ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY, or run a local Ollama.` };
  }
  const modelName = resolved.model && resolved.model !== "default" ? resolved.model : resolved.provider.defaultModel;
  const label = `Native (${modelName})`;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: objective },
  ];
  try {
    const res = await resolved.provider.chat(messages, { maxOutputTokens: 3000 });
    return { text: res.text.trim() || "(empty response)", agent: label };
  } catch (e) {
    return { text: `${(e as Error).message}`, agent: label };
  }
}

/**
 * "/plan <description>" and "/spec <description>" — both write a Markdown document via
 * `generateWorkerDocument` and save it under the workspace's `.gr-agent/plans/` or
 * `.gr-agent/specs/` folder (see `RiqsPaths.planDoc`/`specDoc`), then show where it landed with a
 * short preview — shared by both the Ink dispatch (`dispatchInkCommand`) and the legacy loop below
 * so the two front ends can't drift.
 */
async function runGenerateDoc(kind: "plan" | "spec", args: string[], g: GlobalOpts, tty: boolean): Promise<void> {
  const objective = args.join(" ").trim();
  const label = kind === "plan" ? "Plan" : "Spec";
  if (!objective) {
    await showOverlay(label, [`Usage: /${kind} <description>`, "", `Example: /${kind} add rate limiting to the login endpoint`], tty);
    return;
  }

  if (tty) clearScreen();
  process.stdout.write(
    `\n${pc.bold(label)}\n\n${pc.dim(`Writing a ${kind} for: ${objective}`)}\n${pc.dim("Using your configured worker — this can take a little while…")}\n`,
  );

  let reply: ChatReply;
  try {
    reply = await generateWorkerDocument(kind, objective, g);
  } catch (e) {
    reply = { text: `Something went wrong: ${(e as Error).message}` };
  }

  const root = path.resolve(g.workspace ?? process.cwd());
  const paths = new RiqsPaths(root);
  const dir = kind === "plan" ? paths.plansDir() : paths.specsDir();
  await fs.mkdir(dir, { recursive: true });
  const slug = slugify(objective);
  const filePath = kind === "plan" ? paths.planDoc(slug) : paths.specDoc(slug);
  const agentLine = reply.agent ? `*Written by ${reply.agent}*\n\n` : "";
  await fs.writeFile(filePath, `# ${label}: ${objective}\n\n${agentLine}${reply.text}\n`, "utf8");

  const relPath = path.relative(root, filePath) || filePath;
  const bodyLines = reply.text.split("\n");
  const preview = bodyLines.slice(0, 24);
  await showOverlay(`${label} saved`, [`Saved to ${relPath}`, "", ...preview, ...(bodyLines.length > preview.length ? ["…"] : [])], tty);
}

async function showOverlay(title: string, lines: string[], tty: boolean): Promise<void> {
  if (tty) clearScreen();
  process.stdout.write(`\n${pc.bold(title)}\n\n${lines.join("\n")}\n`);
  await endOverlay(tty);
}

async function waitForKey(): Promise<void> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  const wasRaw = stdin.isRaw;
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  await new Promise<void>((resolve) => {
    const onKey = () => {
      stdin.off("keypress", onKey);
      if (!wasRaw) stdin.setRawMode(false);
      resolve();
    };
    stdin.once("keypress", onKey);
  });
}

async function readHomeMessage(model: HomeModel, g: GlobalOpts): Promise<string | null> {
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

/** Fixed cycle order for Tab-switching the active worker — native first, then each known integration. */
export const WORKER_CYCLE = ["native", "claude", "codex", "cursor", "opencode", "antigravity"];

/** Pure step function for the Tab cycle — exported so it's testable without the raw-mode composer. */
export function nextInCycle(current: string): string {
  const at = WORKER_CYCLE.indexOf(current);
  return WORKER_CYCLE[(at + 1 + WORKER_CYCLE.length) % WORKER_CYCLE.length]!;
}

export interface CycleWorkerSelection {
  agent: string;
  agentModel?: string;
}

export function shouldRemountInkSession(result: { resized: boolean; agentCycled: boolean }): boolean {
  return result.resized || result.agentCycled;
}

/** Shared worker-cycle action for both interactive shells. Mutates `model` immediately so callers can
 * redraw with the new worker right away, then best-effort persists the selection and resolves its
 * model label. */
export async function cycleWorkerSelection(model: HomeModel, g: GlobalOpts): Promise<CycleWorkerSelection> {
  if (!model.initialised) return { agent: model.agent, agentModel: model.agentModel }; // /agents itself refuses this until setup is done; match it
  const next = nextInCycle(model.agent);
  model.agent = next; // instant visual feedback — the redraw right after this call picks it up
  model.agentModel = undefined; // stale until resolved below — showing the old agent's model would be wrong
  try {
    const root = path.resolve(g.workspace ?? process.cwd());
    const loaded = await loadConfig(root);
    const existing = loaded.workers.workers[next] ?? { enabled: true, roles: [], capabilities: [] };
    loaded.workers.workers[next] = { ...existing, enabled: true };
    loaded.config.primaryWorker = next;
    await writeWorkers(loaded.paths, loaded.workers);
    await writeConfig(loaded.paths, loaded.config);
    model.agentModel = await resolveAgentModelLabel(next, loaded.agents.agents[next]?.model, loaded.config);
  } catch {
    // Best-effort — a failed background save just means the switch doesn't survive a restart;
    // it already took effect for the rest of this session via model.agent above.
  }
  return { agent: model.agent, agentModel: model.agentModel };
}

/** Tab in the composer: switch to the next worker in WORKER_CYCLE, update the header/footer
 * immediately, and persist it in the background — same effect as /agents, just one keystroke. */
function cycleWorker(model: HomeModel, g: GlobalOpts, redraw: () => void): void {
  if (!model.initialised) return;
  const persisted = cycleWorkerSelection(model, g);
  redraw();
  void persisted.finally(redraw);
}

/**
 * Inline composer with a "/" command palette. Every keystroke redraws the whole home screen (icon,
 * suggested/recent list or the filtered command menu, and the live composer text) so the palette can
 * grow and shrink freely without fragile relative cursor math.
 */
async function readHomeSlotMessage(model: HomeModel, g: GlobalOpts): Promise<string | null> {
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

  return await new Promise<string | null>((resolve) => {
    // Re-anchor immediately on a live window resize (e.g. dragging the terminal bigger/smaller)
    // instead of waiting for the next keystroke — termWidth()/termHeight() are read fresh on every
    // redraw, so this just needs to be triggered. Also drop the short-TTL size cache so this redraw
    // re-measures instead of serving a stale size from just before the resize.
    const onResize = () => {
      invalidateSizeCache();
      redraw();
    };
    process.stdout.on("resize", onResize);
    const done = (answer: string | null) => {
      stdin.off("keypress", onKeypress);
      process.stdout.off("resize", onResize);
      if (!wasRaw) stdin.setRawMode(false);
      resolve(answer);
    };

    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      const menuOpen = isCommandMenuOpen(value);
      const matches = menuOpen ? filterSlashCommands(value) : [];
      // Arrow-key browsing of the suggested/recent list, only while the composer is empty —
      // once something is typed, up/down go back to being plain (unhandled) keys.
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
      // Ctrl+G is a fallback for terminals/setups where a bare Tab never reaches the app (e.g.
      // intercepted for focus-navigation before it reaches the pty) — same effect either way.
      if ((key.name === "tab" || (key.ctrl && key.name === "g")) && !menuOpen) {
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
          const chosen = matches[Math.min(selectedIndex, matches.length - 1)]!;
          if (value.toLowerCase() !== chosen.id.toLowerCase()) {
            // First Enter completes the highlighted command; press Enter again to run it.
            value = `${chosen.id} `;
            selectedIndex = 0;
            redraw();
            return;
          }
          done(value);
          return;
        }
        if (suggestions.length > 0) {
          const chosen = suggestions[Math.min(selectedIndex, suggestions.length - 1)]!;
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
      if (str && !key.ctrl && !key.sequence?.startsWith("\x1b")) {
        value += str;
        selectedIndex = 0;
        redraw();
      }
    };

    stdin.on("keypress", onKeypress);
  });
}

interface InlineRunSink {
  onLine: (line: string) => void;
  onStatus: (frame: string | undefined) => void;
}

/**
 * `inline`, when given, routes every log line and spinner frame from the actual run through the
 * caller instead of straight to the raw terminal — used only by the interactive /implement command so the
 * whole thing renders inside the home screen (header/composer/footer always visible) instead of
 * clearing to what felt like "a whole new page". A plain `gr-agent run` from a shell passes nothing,
 * so nothing changes there. The pre-run confirmation preview (table + Yes/No) still prints straight
 * to the terminal either way — same gate this app uses before /setup, /clone, etc.
 */
async function execute(objective: string, opts: RunOpts, g: GlobalOpts, inline?: InlineRunSink): Promise<void> {
  const ctx = await resolveContext(g);

  let config = ctx.config;
  if (opts.profile) {
    const profile = await loadProfile(ctx.paths, opts.profile);
    config = {
      ...config,
      mode: profile.mode ?? config.mode,
      routingPolicy: profile.routingPolicy ?? config.routingPolicy,
      primaryWorker: profile.primaryWorker ?? config.primaryWorker,
      routing: { ...config.routing, ...(profile.routing ?? {}) },
      skip: [...new Set([...(config.skip ?? []), ...(profile.skip ?? [])])],
    };
  }

  const mode: WorkflowMode | undefined = opts.mode ?? (opts.worker ? "single-worker" : undefined);
  const taskRouting = parseRoutes(opts.route ?? []);
  if (opts.worker && (mode === "single-worker")) {
    for (const r of ALL_ROLES) taskRouting[r] = opts.worker;
  }

  const input: OrchestratorRunInput = {
    objective,
    category: opts.category,
    workflow: opts.workflow,
    mode,
    parallelism: opts.parallel ? Number(opts.parallel) : undefined,
    skip: opts.skip ?? [],
    taskRouting,
    disabledWorkers: opts.disableWorker ?? [],
    acceptanceCriteria: opts.criteria ?? [],
    nativeProviderOverride: opts.nativeProvider,
    isolateWrites: opts.isolateWrites,
  };

  // Routing confirmation preview (master plan §140).
  if (!opts.yes && !ctx.nonInteractive) {
    log.info("\n" + table(["setting", "value"], [
      ["objective", objective],
      ["workflow", opts.workflow ?? "(auto plan)"],
      ["mode", mode ?? config.mode],
      ["routing policy", config.routingPolicy],
      ["per-task routes", Object.entries(taskRouting).map(([r, w]) => `${r}=${w}`).join(", ") || "-"],
      ["disabled workers", (opts.disableWorker ?? []).join(", ") || "-"],
      ["skip", (input.skip ?? []).join(", ") || "-"],
    ]));
    log.info(pc.dim("This runs real AI worker calls (API/CLI usage) — even a short objective like \"hello\" gets a full investigate → implement → test → review plan unless you pass --workflow/--skip."));
    const ok = await confirm("Proceed with this workflow?", true);
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
    signal: controller.signal,
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
    log.info(`Confirmed root causes: ${model.confirmed.length} · supported: ${model.supported.length} · contradictions: ${model.contradictions.length}`);
    log.info(`Report: ${reportPath}`);
    if (g.json) process.stdout.write(JSON.stringify({ taskId: task.taskId, state: task.state, reportPath }) + "\n");
  } catch (e) {
    process.off("SIGINT", onSig);
    if (inline) inline.onLine(`✗ ${(e as Error).message}`);
    throw e;
  } finally {
    if (inline) {
      setLogSink(undefined);
      setSpinnerSink(undefined);
    }
  }
}

const ALL_ROLES: Role[] = [
  "planner", "investigator", "backend", "frontend", "database", "permission", "security",
  "performance", "coder", "tester", "reviewer", "regression", "documentation", "git", "release", "general",
];

function parseRoutes(pairs: string[]): Partial<Record<Role, string | string[]>> {
  const out: Partial<Record<Role, string | string[]>> = {};
  for (const p of pairs) {
    const [role, workers] = p.split("=");
    if (!role || !workers) continue;
    const list = workers.split(",").map((s) => s.trim()).filter(Boolean);
    out[role as Role] = list.length > 1 ? list : list[0];
  }
  return out;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
