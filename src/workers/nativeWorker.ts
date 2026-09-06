import type { AgentWorker, WorkerContext } from "./worker";
import { baseResult } from "./worker";
import {
  AgentResultSchema,
  type AgentAssignment,
  type AgentResult,
} from "../riqs/contracts";
import type { LlmProvider, ChatMessage } from "../llm/provider";
import { resultContractHint } from "../llm/promptEnvelope";
import { RepoFs } from "../tools/fs";
import { RepoSearch } from "../tools/search";
import { Git } from "../tools/git";
import { log } from "../util/logger";
import { withSpinner } from "../util/spinner";
import { roleVerb } from "../util/roleVerb";
import { CancelledError } from "../util/errors";

const MAX_STEPS = 24;

interface ToolCall {
  tool?: string;
  args?: Record<string, unknown>;
  final?: unknown;
  thought?: string;
}

/**
 * Native worker: a bounded JSON-action loop over the read-only repo tools (master plan §11, §151).
 * Provider-agnostic — works with Anthropic, OpenAI, OpenRouter and local Ollama alike.
 */
export class NativeWorker implements AgentWorker {
  readonly kind = "native" as const;

  constructor(
    readonly name: string,
    private readonly provider: LlmProvider,
    private readonly model: string | undefined,
  ) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(a: AgentAssignment, ctx: WorkerContext): Promise<AgentResult> {
    const result = baseResult(a, this.name);
    const fs = new RepoFs(ctx.guard);
    const search = new RepoSearch(ctx.guard);
    const git = await Git.open(ctx.cwd);

    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt(a, ctx) },
      { role: "user", content: `${ctx.prompt}\n\n${resultContractHint()}\n\nBegin. Respond with one JSON action.` },
    ];

    for (let step = 0; step < MAX_STEPS; step++) {
      if (ctx.signal?.aborted) throw new CancelledError();
      const reply = await withSpinner(`${roleVerb(a.role)}… (${this.name}, step ${step + 1}/${MAX_STEPS})`, () =>
        this.provider.chat(messages, {
          model: this.model ?? ctx.model,
          signal: ctx.signal,
          json: true,
          maxOutputTokens: 4096,
        }),
      );
      messages.push({ role: "assistant", content: reply.text });
      const call = extractJson<ToolCall>(reply.text);

      if (!call) {
        messages.push({ role: "user", content: 'Could not parse JSON. Reply with exactly one JSON object: {"tool":...} or {"final":...}.' });
        continue;
      }
      if (call.final !== undefined) {
        return finalize(a, result, call.final);
      }

      const obs = await this.runTool(call, { fs, search, git, a });
      messages.push({ role: "user", content: `Observation (${call.tool}):\n${truncate(obs, 6000)}\n\nNext JSON action.` });
    }

    log.warn(`native worker ${a.id}: step budget exhausted`);
    result.status = "partial";
    result.error = "step budget exhausted before a final result";
    result.finishedAt = new Date().toISOString();
    return result;
  }

  private systemPrompt(a: AgentAssignment, ctx: WorkerContext): string {
    const tools = [
      'read_file { "path": string }  — read a file (relative to workspace root)',
      'list_dir { "path": string }   — list a directory',
      'search_code { "pattern": string, "glob"?: string[], "ignoreCase"?: boolean } — regex search',
      'find_files { "glob": string } — glob for files',
      'git_status {}                 — porcelain working-tree status',
      'git_diff { "args"?: string[] }— unified diff',
    ];
    if (!a.readOnly) tools.push('write_file { "path": string, "content": string } — write within allowedPaths only');
    return [
      `You are the gR DEV AGENT native worker operating on workspace: ${ctx.workspaceRoot}`,
      "You act by emitting ONE JSON object per turn. No prose outside JSON.",
      'To use a tool: {"thought": "...", "tool": "<name>", "args": { ... }}',
      'To finish:     {"final": { ...result object... }}',
      "",
      "Available tools:",
      ...tools.map((t) => `- ${t}`),
      "",
      "Stay strictly within the assignment objective and allowed paths. Prefer targeted searches over reading large files.",
    ].join("\n");
  }

  private async runTool(
    call: ToolCall,
    dep: { fs: RepoFs; search: RepoSearch; git: Git | null; a: AgentAssignment },
  ): Promise<string> {
    const args = call.args ?? {};
    try {
      switch (call.tool) {
        case "read_file": {
          const r = await dep.fs.readFile(String(args.path));
          return `${r.path} (${r.bytes} bytes${r.truncated ? ", truncated" : ""}):\n${r.content}`;
        }
        case "list_dir": {
          const r = await dep.fs.listDir(String(args.path ?? "."));
          return `${r.path}:\n${r.entries.map((e) => `${e.type === "dir" ? "d" : "-"} ${e.name}`).join("\n")}`;
        }
        case "search_code": {
          const hits = await dep.search.grep(String(args.pattern), {
            glob: (args.glob as string[]) ?? undefined,
            ignoreCase: Boolean(args.ignoreCase),
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
          return dep.git ? (await dep.git.diff((args.args as string[]) ?? [])).slice(0, 8000) : "git unavailable";
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
      return `ERROR: ${(e as Error).message}`;
    }
  }
}

function withinAllowed(p: string, allowed: string[]): boolean {
  if (allowed.includes("**")) return true;
  return allowed.some((glob) => {
    const re = new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
    return re.test(p);
  });
}

function finalize(a: AgentAssignment, result: AgentResult, raw: unknown): AgentResult {
  const merged = { ...result, ...(typeof raw === "object" && raw ? raw : {}), taskId: a.taskId, id: a.id, role: a.role, worker: result.worker };
  const parsed = AgentResultSchema.safeParse({ ...merged, finishedAt: new Date().toISOString() });
  if (parsed.success) return parsed.data;
  return {
    ...result,
    status: "partial",
    error: `worker returned a malformed result: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    findings: result.findings,
    finishedAt: new Date().toISOString(),
  };
}

function extractJson<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  try {
    return JSON.parse(candidate.trim()) as T;
  } catch {
    /* fall through to brace scan */
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n… [+${s.length - n} chars]` : s;
}
