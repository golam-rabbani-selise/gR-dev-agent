import type { ChatMessage, ChatOptions, ChatResult, LlmProvider } from "./provider";
import { ProviderUnavailableError } from "./provider";

/** Local Ollama via its native /api/chat endpoint. No API key, no SDK (master plan §17, §58). */
export class OllamaProvider implements LlmProvider {
  readonly id = "ollama";
  readonly defaultModel: string;
  private baseUrl: string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
    const model = opts.model && opts.model !== "default" ? opts.model : process.env.OLLAMA_MODEL ?? "llama3.1";
    this.defaultModel = model;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const model = opts.model && opts.model !== "default" ? opts.model : this.defaultModel;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
          format: opts.json ? "json" : undefined,
          options: { temperature: opts.temperature ?? 0, num_predict: opts.maxOutputTokens },
        }),
        signal: opts.signal ?? null,
      });
    } catch (e) {
      throw new ProviderUnavailableError("ollama", `cannot reach ${this.baseUrl} (${(e as Error).message})`);
    }
    if (!res.ok) throw new ProviderUnavailableError("ollama", `HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      text: (body.message?.content ?? "").trim(),
      model,
      usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count },
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      const body = (await res.json()) as { models?: { name: string }[] };
      return (body.models ?? []).map((m) => m.name).sort();
    } catch {
      return [];
    }
  }
}
