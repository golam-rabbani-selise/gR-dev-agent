import path from "node:path";
import { execFileSync } from "node:child_process";
import pc from "picocolors";
import { isColor } from "../util/logger";
import { Platform } from "../platform/platform";
import { CREDIT, MARK_ASCII, TAGLINE, WORDMARK } from "./logo";

export interface RecentTask {
  title: string;
  meta: string;
  /** what gets shown as a live preview / submitted when this row is chosen; defaults to `title`. */
  value?: string;
  /** a run.ts-side action to take instead of treating `value` as a plain task/command. */
  action?: "init" | "clone";
}

/** run.ts checks for these exact strings to run a real action instead of dispatching input. */
export const RUN_INIT_ACTION = "::gr-agent:run-init::";
export const RUN_CLONE_ACTION = "::gr-agent:run-clone::";

export type WorkspaceStack = "backend" | "frontend" | "unknown";

export interface HomeModel {
  version: string;
  workspaceRoot: string;
  workspaceName: string;
  branch: string | null;
  repositories: number;
  mode: string;
  agent: string;
  /** the model behind `agent`, when it's actually known (never a guessed vendor default) — shown as
   * "agent (agentModel)" in the header/footer, same rule the chat labels already follow. */
  agentModel?: string;
  provider: string;
  ready: boolean;
  initialised: boolean;
  /** true once an actual project (not just the .gr-agent/ scaffold) is present. */
  hasRepo: boolean;
  /** best-effort guess once hasRepo is true; "unknown" falls back to the generic starters. */
  stack: WorkspaceStack;
  recentTasks?: RecentTask[];
  /** In-memory chat transcript for this session (not persisted) — replaces the suggestion list once non-empty. */
  chatHistory?: ChatTurn[];
  /** A chat reply is in flight — shows a "Thinking…" line at the end of the transcript. */
  chatPending?: boolean;
  /** Set (even to []) for the duration of an /implement run — replaces chat/suggestions with an inline
   * "Running: <objective>" view instead of clearing to a separate screen. Undefined once no
   * /implement run has happened yet this session (or after the user moves on to something else). */
  runLog?: string[];
  /** The current in-flight status line (a worker's spinner frame) — separate from runLog's permanent
   * lines since it replaces itself every animation tick instead of appending. */
  runStatus?: string;
  runObjective?: string;
  /** The /implement task is still executing — kept distinct from "runLog is defined" so a finished run's
   * output stays visible (not auto-cleared) until the user does something else. */
  runPending?: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** which agent/provider answered (assistant turns only) — shown as a small label above the reply. */
  agent?: string;
}

const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
const vlen = (s: string): number => s.replace(ANSI, "").length;
/** Strip ANSI and measure — exported so callers (the raw-mode composer) can place the real cursor. */
export function visibleLength(s: string): number {
  return vlen(s);
}
/** Strip ANSI colour codes — exported so callers displaying raw external-CLI output (e.g. a chat
 * reply from an agent CLI) can show plain text instead of leaking escape sequences. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

function composerPlaceholder(unicode: boolean): string {
  return unicode ? "Ask anything, or /implement <task> for a workflow…" : "Ask anything, or /implement <task> for a workflow...";
}

/** Generic fallback once a repo exists but the stack couldn't be guessed. */
const STARTERS: RecentTask[] = [
  { title: "Investigate a bug", meta: "" },
  { title: "Trace a request end-to-end", meta: "" },
  { title: "Audit permissions", meta: "" },
  { title: "Review current Git changes", meta: "" },
  { title: "Create a new feature", meta: "" },
];

const BACKEND_STARTERS: RecentTask[] = [
  { title: "Trace an API endpoint end-to-end", meta: "" },
  { title: "Audit endpoint permissions", meta: "" },
  { title: "Investigate a backend bug", meta: "" },
  { title: "Review current Git changes", meta: "" },
  { title: "Add a new endpoint", meta: "" },
];

const FRONTEND_STARTERS: RecentTask[] = [
  { title: "Investigate a UI bug", meta: "" },
  { title: "Trace an API call from the UI", meta: "" },
  { title: "Review component structure", meta: "" },
  { title: "Review current Git changes", meta: "" },
  { title: "Create a new component", meta: "" },
];

/** Shown instead of STARTERS before `gr-agent init` — nothing here assumes a scaffolded workspace. */
const SETUP_STARTERS: RecentTask[] = [
  { title: "/setup", meta: "", value: "gr-agent init", action: "init" },
  { title: "/help", meta: "" },
];

/** Shown once initialised but before any project code exists — nothing to investigate yet. */
const CLONE_STARTERS: RecentTask[] = [
  { title: "/clone", meta: "", value: "clone a repository", action: "clone" },
  { title: "/help", meta: "" },
];

export interface SlashCommand {
  id: string;
  desc: string;
  comingSoon?: boolean;
}

/** Single source of truth for the "/" command palette (src/cli/run.ts dispatches these). Trimmed
 * down to the commands actually in active use — "/workflow", "/workers" (a duplicate of "/agents"),
 * "/integrations", "/resume", and the never-implemented "/sessions"/"/attach"/"/mcp"/"/skills" stubs
 * are gone; "/plan", "/spec" and "/implement" (renamed from "/run") replace the old single "/run"
 * command with an explicit plan -> spec -> implement flow. */
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "/help", desc: "Show help" },
  { id: "/plan", desc: "Write an implementation plan for a task, saved under .gr-agent/plans/" },
  { id: "/spec", desc: "Write a specification for a feature, saved under .gr-agent/specs/" },
  { id: "/implement", desc: "Run a real task: investigate -> implement -> test -> review" },
  { id: "/setup", desc: "Create/switch project folder, or remove the current setup" },
  { id: "/clone", desc: "Clone a repository into this workspace" },
  { id: "/mode", desc: "Set the workflow mode for the next task" },
  { id: "/agents", desc: "Choose which AI worker runs your tasks (native, Claude, Codex, Cursor, ...)" },
  { id: "/model", desc: "Pick which model the current worker uses" },
  { id: "/quit", desc: "Exit gR DEV AGENT" },
];

export function filterSlashCommands(value: string): SlashCommand[] {
  const query = value.replace(/^\//, "").toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.id.slice(1).toLowerCase().startsWith(query));
}

/** The palette is open while the user is still choosing a command — before the first space. */
export function isCommandMenuOpen(value: string): boolean {
  return value.startsWith("/") && !value.includes(" ");
}

export interface ComposerState {
  value: string;
  selectedIndex?: number;
}

const paint = {
  brand: (s: string) => (isColor() ? rgb(s, 76, 184, 126) : s),
  brandBold: (s: string) => (isColor() ? pc.bold(rgb(s, 86, 188, 133)) : s),
  cyan: (s: string) => (isColor() ? rgb(s, 0, 170, 242) : s),
  cyanBold: (s: string) => (isColor() ? pc.bold(rgb(s, 0, 170, 242)) : s),
  dim: (s: string) => (isColor() ? rgb(s, 105, 111, 120) : s),
  muted: (s: string) => (isColor() ? rgb(s, 168, 181, 204) : s),
  text: (s: string) => (isColor() ? rgb(s, 230, 232, 236) : s),
  line: (s: string) => (isColor() ? rgb(s, 43, 88, 125) : s),
  selected: (s: string) => (isColor() ? `\x1b[48;2;10;30;52m${s}\x1b[0m` : s),
  pill: (s: string) => (isColor() ? `\x1b[48;2;86;188;133m\x1b[38;2;12;18;15m${s}\x1b[0m` : s),
  /** subtle dark background for a fenced code-block line inside a chat reply. */
  codeBg: (s: string) => (isColor() ? `\x1b[48;2;22;27;34m${s}\x1b[0m` : s),
};

function rgb(s: string, r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
}

// termWidth()/termHeight() cross-check process.stdout against `stty size`/`tput cols`/`tput lines` —
// each of those spawns a real subprocess (execFileSync). That's fine for a redraw per keystroke, but
// a spinner ticking every 100ms during /implement called renderHome() (and so these) that often
// too, spawning ~40 subprocesses a second and starving the terminal — this is what made the inline /implement
// view look frozen instead of animating. Cache each for a short window, invalidated immediately on a
// real resize (see invalidateSizeCache()), so rapid re-renders reuse one measurement instead of
// re-shelling-out every time.
const SIZE_CACHE_MS = 250;
let cachedWidth: { value: number; at: number } | null = null;
let cachedHeight: { value: number; at: number } | null = null;

/** Call when a genuine terminal resize is detected, so the very next render re-measures instead of
 * serving a stale cached size for up to SIZE_CACHE_MS. */
export function invalidateSizeCache(): void {
  cachedWidth = null;
  cachedHeight = null;
}

function termWidth(): number {
  const override = validWidth(Number(process.env.GR_AGENT_WIDTH));
  if (override) return clampWidth(override);

  const now = Date.now();
  if (cachedWidth && now - cachedWidth.at < SIZE_CACHE_MS) return cachedWidth.value;

  const ttyWidth = Math.max(
    validWidth(process.stdout.columns),
    validWidth(typeof process.stdout.getWindowSize === "function" ? process.stdout.getWindowSize()[0] : 0),
  );
  const shellWidth = Math.max(validWidth(sttyColumns()), validWidth(tputColumns()));
  const envWidth = validWidth(Number(process.env.COLUMNS));
  const visibleWidth = Math.max(shellWidth, envWidth);

  let result: number;
  if (ttyWidth >= 140 && visibleWidth <= 100) result = clampWidth(ttyWidth);
  else if (ttyWidth >= 140 && visibleWidth > 100 && visibleWidth < 140) result = clampWidth(visibleWidth);
  else if (visibleWidth) result = clampWidth(visibleWidth);
  else result = clampWidth(ttyWidth || 100);

  cachedWidth = { value: result, at: now };
  return result;
}

function termHeight(): number {
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

function clampWidth(cols: number): number {
  // Only a floor (a usable minimum) and a generous ceiling against a bogus/runaway detected value —
  // not an artificial cap on real terminals. A hard 120-column cap here used to silently truncate
  // everything (including the chat's code blocks) on any wider terminal; it just wasn't visible until
  // the code block's shaded background made the true render width obvious.
  return Math.max(64, Math.min(cols, 320));
}

function clampHeight(rows: number): number {
  return Math.max(24, Math.min(rows, 150));
}

function validWidth(cols: number | undefined): number {
  return typeof cols === "number" && Number.isFinite(cols) && cols >= 44 ? cols : 0;
}

function validSize(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function sttyColumns(): number {
  try {
    const out = execFileSync("stty", ["size"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] }).trim();
    const cols = out.split(/\s+/).map(Number)[1] ?? 0;
    return Number.isFinite(cols) ? cols : 0;
  } catch {
    return 0;
  }
}

function sttyRows(): number {
  try {
    const out = execFileSync("stty", ["size"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] }).trim();
    const rows = out.split(/\s+/).map(Number)[0] ?? 0;
    return Number.isFinite(rows) ? rows : 0;
  } catch {
    return 0;
  }
}

function tputColumns(): number {
  try {
    const out = execFileSync("tput", ["cols"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] }).trim();
    const cols = Number(out);
    return Number.isFinite(cols) ? cols : 0;
  } catch {
    return 0;
  }
}

function tputRows(): number {
  try {
    const out = execFileSync("tput", ["lines"], { encoding: "utf8", stdio: ["inherit", "pipe", "ignore"] }).trim();
    const rows = Number(out);
    return Number.isFinite(rows) ? rows : 0;
  } catch {
    return 0;
  }
}

function unicodeOk(): boolean {
  if (process.env.GR_ASCII || process.argv.includes("--ascii")) return false;
  // Modern terminals are UTF-8 by default; only fall back on a bare Windows console
  // with no known modern host and an explicitly non-UTF locale.
  if (Platform.isWindows && !process.env.WT_SESSION && !process.env.TERM_PROGRAM) {
    const enc = `${process.env.LC_ALL ?? ""}${process.env.LC_CTYPE ?? ""}${process.env.LANG ?? ""}`.toLowerCase();
    if (!enc.includes("utf") && !process.stdout.isTTY) return false;
  }
  return true;
}

function padEndV(s: string, width: number): string {
  return vlen(s) < width ? s + " ".repeat(width - vlen(s)) : s;
}

function truncV(s: string, width: number): string {
  if (width <= 0) return "";
  if (vlen(s) <= width) return s;
  const plain = s.replace(ANSI, "");
  return plain.slice(0, Math.max(0, width - 1)) + "~";
}

function fitLine(s: string, width: number): string {
  return padEndV(truncV(s, width), width);
}

function divider(width: number, unicode: boolean): string {
  return paint.dim((unicode ? "─" : "-").repeat(width));
}

function footer(m: HomeModel, width: number, unicode: boolean): string {
  const sep = paint.dim(unicode ? "  •  " : "  |  ");
  const left = [paint.pill(` ${m.mode} `), paint.muted("enter send"), paint.muted("@ files"), paint.muted("/ commands"), paint.muted("tab agent")].join(sep);
  // What chat/tasks actually run against — the chosen agent CLI, or (only when that's "native") the
  // configured LLM provider. Showing the provider while a real agent (e.g. claude) is selected was
  // misleading: the header said "Agent claude" but this pill said "ollama".
  const active = m.agent !== "native" ? m.agent : m.provider === "no provider" ? "no provider" : m.provider;
  const activeLabel = m.agentModel ? `${active} (${m.agentModel})` : active;
  const right = `${paint.muted("~/" + m.workspaceName)}   ${paint.muted(activeLabel)}`;
  if (vlen(left) + vlen(right) + 2 > width) return fitLine(left, width);
  return left + " ".repeat(width - vlen(left) - vlen(right)) + right;
}

function iconLines(unicode: boolean): string[] {
  return unicode
    ? ["┌─────┐", "│ ↗ ↗ │", "│  ◡  │", "└──┬──┘", "   ┴   "]
    : MARK_ASCII;
}

function sideBySide(left: string[], right: string[], gap = 3): string[] {
  const h = Math.max(left.length, right.length);
  const lw = Math.max(...left.map(vlen), 0);
  const out: string[] = [];
  for (let i = 0; i < h; i++) out.push(padEndV(left[i] ?? "", lw) + " ".repeat(gap) + (right[i] ?? ""));
  return out;
}

function header(m: HomeModel, unicode: boolean): string[] {
  const icon = iconLines(unicode).map((line) => paint.cyan(line));
  const branch = m.branch ?? "-";
  const details = [
    `${paint.text(WORDMARK)} ${paint.dim("v" + m.version)}`,
    paint.muted(TAGLINE),
    paint.dim(CREDIT),
    "",
    `${paint.muted("Current directory:")} ${paint.text("~/" + m.workspaceName)}`,
    `${paint.text("Tip:")} ${paint.muted("Use")} ${paint.text("/help")} ${paint.muted("for commands.")}`,
    `${paint.dim("Branch")} ${paint.text(branch)}   ${paint.dim("Mode")} ${paint.text(m.mode)}   ${paint.dim("Agent")} ${paint.text(m.agent)}`,
  ];
  return sideBySide(icon, details, 3);
}

function ageLabel(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diff = Math.max(0, Date.now() - time);
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function checkpointToRecentTask(cp: { task: { objective: string }; completedResults: string[]; savedAt: string }): RecentTask {
  const count = cp.completedResults.length;
  const message = `${count || 1} message${count === 1 ? "" : "s"}`;
  const age = ageLabel(cp.savedAt);
  return { title: cp.task.objective, meta: age ? `${message} · ${age}` : message };
}

function commandMenuSection(value: string, selectedIndex: number, width: number): string[] {
  const matches = filterSlashCommands(value);
  const head = `${paint.dim("Commands")} ${paint.dim("·")} ${paint.muted("↑↓ select · enter choose · esc cancel")}`;
  if (matches.length === 0) return [head, "", `  ${paint.muted("No matching commands")}`];

  const out = [head, ""];
  const clamped = Math.min(Math.max(selectedIndex, 0), matches.length - 1);
  matches.slice(0, 6).forEach((c, i) => {
    const selected = i === clamped;
    const marker = selected ? paint.cyan(">") : " ";
    const label = selected ? paint.cyanBold(padEndV(c.id, 16)) : paint.text(padEndV(c.id, 16));
    const desc = paint.muted(c.desc + (c.comingSoon ? "  (soon)" : ""));
    const line = `  ${marker} ${label}  ${desc}`;
    out.push(selected ? paint.selected(fitLine(line, width)) : fitLine(line, width));
  });
  return out;
}

/** The rows shown by recentSection — shared with run.ts so Enter can resolve the highlighted one. */
export function getSuggestionList(m: HomeModel): RecentTask[] {
  if (m.recentTasks?.length) return m.recentTasks.slice(0, 5);
  // Nothing project-specific until the workspace is actually scaffolded — offer setup, not tasks
  // that would just fail against a missing .gr-agent/ directory.
  if (!m.initialised) return SETUP_STARTERS;
  // Scaffolded but no project code yet — the next real step is cloning one, not investigating.
  if (!m.hasRepo) return CLONE_STARTERS;
  if (m.stack === "backend") return BACKEND_STARTERS;
  if (m.stack === "frontend") return FRONTEND_STARTERS;
  return STARTERS.slice(0, 5);
}

/**
 * What actually gets submitted when a suggestion row is chosen (run.ts dispatches on this string).
 * Plain-typed text is chat by default (§ the "hello" fix) — a *task* suggestion needs to route
 * through /implement so picking it still runs the real workflow instead of just being chatted about.
 * Commands (already "/"-prefixed, e.g. the "/setup"/"/help" rows) and the init/clone sentinels
 * pass through untouched.
 */
export function resolveSuggestionSubmission(chosen: RecentTask): string {
  if (chosen.action === "init") return RUN_INIT_ACTION;
  if (chosen.action === "clone") return RUN_CLONE_ACTION;
  const raw = chosen.value ?? chosen.title;
  return raw.startsWith("/") ? raw : `/implement ${raw}`;
}

function recentSectionTitle(m: HomeModel): string {
  if (m.recentTasks?.length) return "Recent tasks";
  if (!m.initialised) return "Get started";
  if (!m.hasRepo) return "Next: clone a repository";
  if (m.stack === "backend") return "Suggested starts (backend)";
  if (m.stack === "frontend") return "Suggested starts (frontend)";
  return "Suggested starts";
}

function recentSection(m: HomeModel, width: number, selectedIndex = 0): string[] {
  const recents = getSuggestionList(m);
  const title = recentSectionTitle(m);
  const hint = m.recentTasks?.length ? "/resume" : "/help";
  const out = [`${paint.dim(title)} ${paint.dim("·")} ${paint.muted("↑↓ select · enter run · " + hint)}`, ""];
  const inner = Math.max(30, width - 4);
  const clamped = Math.min(Math.max(selectedIndex, 0), Math.max(recents.length - 1, 0));
  recents.forEach((item, i) => {
    const selected = i === clamped;
    const marker = selected ? paint.cyan(">") : " ";
    const meta = paint.muted(item.meta);
    const titleWidth = Math.max(12, inner - vlen(item.meta) - 4);
    const titleText = selected ? paint.cyanBold(truncV(item.title, titleWidth)) : paint.text(truncV(item.title, titleWidth));
    const line = `  ${marker} ${padEndV(titleText, titleWidth)}  ${meta}`;
    out.push(selected ? paint.selected(fitLine(line, width)) : fitLine(line, width));
  });
  return out;
}

function wrapText(text: string, width: number): string[] {
  const w = Math.max(10, width);
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
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

/** The scrolling chat transcript — replaces the suggestion list once the user has said something.
 * Capped to the most recent lines so a long conversation never pushes the composer off-screen. */
/**
 * Render an assistant reply, giving fenced ```lang code blocks (which most agent CLIs return in
 * markdown) their own distinct styling — a dim bordered header/footer and a shaded background per
 * line — instead of dumping the raw ``` fences and prose-wrapping code (which breaks indentation).
 * Plain prose around/between blocks still gets the normal word-wrap treatment.
 */
function renderAssistantBody(text: string, width: number): string[] {
  const fence = /```([\w+-]*)[ \t]*\n?([\s\S]*?)```/g;
  const out: string[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const prose = (segment: string) => {
    const trimmed = segment.trim();
    if (!trimmed) return;
    for (const l of wrapText(trimmed, width)) out.push(l ? paint.muted(l) : "");
  };
  while ((match = fence.exec(text))) {
    prose(text.slice(last, match.index));
    const lang = (match[1] ?? "").trim();
    const code = (match[2] ?? "").replace(/\n$/, "");
    const codeLines = code.split("\n");
    // Closed corners on the header/footer rule ("┌─ lang ─...─┐" / "└─...─┘"), stretched to the full
    // available (responsive — follows the terminal's own width) width, with a shaded background
    // behind the code so the block reads as one distinct panel.
    const ruleWidth = Math.max(20, width);
    const headerCore = `─${lang ? ` ${lang} ` : " "}`;
    out.push(paint.dim(`┌${headerCore}${"─".repeat(Math.max(0, ruleWidth - headerCore.length - 2))}┐`));
    // The header/footer border lines are exactly ruleWidth characters ("┌"+core+dashes+"┐" and
    // "└"+dashes+"┘"); the shaded content lines have no border characters of their own, so they need
    // to be padded to that same ruleWidth to actually reach the right edge — padding to ruleWidth-2
    // left the background visibly short of the box's own right border.
    const innerWidth = ruleWidth;
    for (const codeLine of codeLines) {
      const fitted = padEndV(truncV(`  ${codeLine}`, innerWidth), innerWidth);
      out.push(paint.codeBg(paint.text(fitted)));
    }
    out.push(paint.dim(`└${"─".repeat(Math.max(0, ruleWidth - 2))}┘`));
    last = fence.lastIndex;
  }
  const tail = text.slice(last);
  if (tail.trim() || out.length === 0) prose(tail);
  return out;
}

function chatSection(m: HomeModel, width: number, maxLines: number): string[] {
  const history = m.chatHistory ?? [];
  const inner = Math.max(30, width - 2);
  const lines: string[] = [];
  for (const turn of history) {
    if (turn.role === "user") {
      const wrapped = wrapText(turn.text, inner - 2);
      wrapped.forEach((l, i) => lines.push(i === 0 ? `${paint.cyanBold(">")} ${paint.text(l)}` : `  ${l}`));
    } else {
      lines.push(paint.dim(`${turn.agent ?? "gR DEV AGENT"}:`));
      lines.push(...renderAssistantBody(turn.text, inner));
    }
    lines.push("");
  }
  if (m.chatPending) lines.push(paint.dim("Thinking…"));
  if (lines.length === 0) return [paint.muted("Ask anything — nothing runs against your code unless you use /implement.")];
  if (lines.length <= maxLines) return lines;
  const tail = lines.slice(lines.length - maxLines);
  return [paint.dim(`… earlier messages hidden — ${history.length} message${history.length === 1 ? "" : "s"} total`), "", ...tail];
}

/**
 * The inline "Running: <objective>" view for an active/just-finished /implement run — replaces chat/suggestions
 * so the whole thing stays on the same home screen (header, composer, footer always visible) instead
 * of clearing to a separate raw-log page the way /implement used to. Log lines already carry their own
 * ANSI colour (the same log.step/success/warn/error formatting used everywhere else); this just
 * fits them to width and caps how many show at once, plus the current spinner frame (if any) at the
 * bottom, distinct from the permanent lines since it replaces itself every tick instead of appending.
 */
function runSection(m: HomeModel, width: number, maxLines: number): string[] {
  const lines = m.runLog ?? [];
  const header = `${paint.dim("Running:")} ${paint.text(m.runObjective ?? "")}`;
  const body = lines.length > 0 ? lines.map((l) => truncV(l, width)) : [paint.muted("Starting…")];
  const withStatus = m.runStatus ? [...body, paint.cyan(m.runStatus)] : body;
  if (withStatus.length <= maxLines) return [header, "", ...withStatus];
  const tail = withStatus.slice(withStatus.length - maxLines);
  const hidden = lines.length - (tail.length - (m.runStatus ? 1 : 0));
  return [header, "", paint.dim(`… ${Math.max(hidden, 0)} earlier line${hidden === 1 ? "" : "s"} hidden`), "", ...tail];
}

export function renderHome(m: HomeModel, composer?: ComposerState): string {
  const width = termWidth();
  const height = termHeight();
  const unicode = unicodeOk();
  const L: string[] = [];
  const menuOpen = composer !== undefined && isCommandMenuOpen(composer.value);
  // Arrow-key browsing of the suggested/recent list only applies while the composer is empty —
  // once the user starts typing (a command or a custom task) the list stops moving.
  const listIndex = composer && composer.value === "" ? (composer.selectedIndex ?? 0) : 0;

  const running = m.runLog !== undefined;
  const chatting = !running && ((m.chatHistory?.length ?? 0) > 0 || m.chatPending === true);

  L.push("");
  L.push(...header(m, unicode));
  L.push("");
  if (menuOpen) {
    L.push(...commandMenuSection(composer!.value, composer!.selectedIndex ?? 0, width));
  } else if (running) {
    L.push(...runSection(m, width, Math.max(6, height - 16)));
  } else if (chatting) {
    L.push(...chatSection(m, width, Math.max(6, height - 16)));
  } else {
    L.push(...recentSection(m, width, listIndex));
  }
  L.push("");
  // The workspace-readiness line belongs to the static home screen (icon + suggestions) — once a
  // conversation (or an /implement run) is going it's redundant clutter between the content and the composer.
  if (!chatting && !running) {
    L.push(
      m.initialised
        ? paint.muted(m.ready ? "Ready." : "Provider setup needed.")
        : paint.muted("Workspace not initialised. Run ") + paint.brand("gr-agent init") + paint.muted(" when you want workspace files."),
    );
  }

  // The composer always sits at a fixed spot at the very bottom of the terminal — like a real chat
  // app's input bar — however much (or little) is above it, and it re-anchors on every redraw since
  // termHeight() is read live each time, so resizing the terminal and typing a key snaps it back to
  // the bottom at the new size.
  const bottomLines = 4;
  const fill = Math.max(1, height - L.length - bottomLines);
  for (let i = 0; i < fill; i++) L.push("");

  // While the composer is empty and the list (not the "/" menu, not the chat transcript) is showing,
  // a row whose real action differs from its label (e.g. "/setup" actually runs "gr-agent init")
  // previews that real value.
  const highlighted = !menuOpen && !chatting && !running && composer?.value === "" ? getSuggestionList(m)[listIndex] : undefined;
  const composerText = composer
    ? composer.value || paint.dim(highlighted?.value ?? composerPlaceholder(unicode))
    : "";
  L.push(composer ? `${renderHomePrompt()}${composerText}` : "");
  L.push(divider(width, unicode));
  L.push(footer(m, width, unicode));
  L.push("");

  return L.map((line) => truncV(line, width)).join("\n");
}

export function deriveWorkspaceName(root: string): string {
  return path.basename(root) || "workspace";
}

export function renderHomePrompt(): string {
  return unicodeOk() ? `${paint.cyan("▌")} ${paint.cyan(">")} ` : "> ";
}
