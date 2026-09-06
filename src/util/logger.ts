import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

interface LoggerState {
  level: LogLevel;
  color: boolean;
  json: boolean;
}

const state: LoggerState = {
  level: (process.env.RIQS_LOG_LEVEL as LogLevel) || "info",
  color: shouldColor(),
  json: false,
};

function shouldColor(): boolean {
  if (process.env.NO_COLOR || process.argv.includes("--no-color")) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

export function configureLogger(opts: Partial<LoggerState>): void {
  Object.assign(state, opts);
}

export function isColor(): boolean {
  return state.color;
}

function paint(fn: (s: string) => string, s: string): string {
  return state.color ? fn(s) : s;
}

/**
 * Lets an interactive UI (the home screen's inline "Running: <task>" view) capture log lines instead
 * of them going straight to the raw terminal — /run used to clear the screen and let the orchestrator
 * print directly, which is exactly the "jumps to a whole new page" behaviour the user didn't want.
 * A plain `gr-agent run` from a normal shell (or --json/non-interactive use) never sets this, so
 * nothing changes there — lines still go straight to stdout/stderr as always.
 */
let sink: ((line: string) => void) | undefined;

export function setLogSink(fn: ((line: string) => void) | undefined): void {
  sink = fn;
}

function emit(level: LogLevel, prefix: string, args: unknown[]): void {
  if (LEVELS[level] < LEVELS[state.level]) return;
  if (state.json) {
    // Machine-readable output is for external consumption, not this session's own UI — always goes
    // straight to the real stream regardless of any sink.
    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream.write(JSON.stringify({ ts: new Date().toISOString(), level, msg: args.map(String).join(" ") }) + "\n");
    return;
  }
  const line = (prefix ? prefix + " " : "") + args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  if (sink) {
    sink(line);
    return;
  }
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(line + "\n");
}

export const log = {
  debug: (...a: unknown[]) => emit("debug", paint(pc.dim, "  ·"), a),
  info: (...a: unknown[]) => emit("info", "", a),
  step: (...a: unknown[]) => emit("info", paint(pc.cyan, "›"), a),
  success: (...a: unknown[]) => emit("info", paint(pc.green, "✓"), a),
  warn: (...a: unknown[]) => emit("warn", paint(pc.yellow, "!"), a),
  error: (...a: unknown[]) => emit("error", paint(pc.red, "✗"), a),
};

/** Redact anything that looks like a secret from a string before it is logged or persisted. */
export function redact(input: string): string {
  return input
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "sk-***")
    .replace(/(ghp_[A-Za-z0-9]{8,})/g, "ghp_***")
    .replace(/(x-api-key:\s*)\S+/gi, "$1***")
    .replace(/(authorization:\s*bearer\s+)\S+/gi, "$1***")
    .replace(/([?&](?:api_?key|token|access_token|password)=)[^&\s]+/gi, "$1***");
}
