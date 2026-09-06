import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, ChatResult, LlmProvider } from "./provider";
import { ProviderUnavailableError } from "./provider";

const DEFAULT_MODEL = "claude-sonnet-4-5";

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly defaultModel: string;
  private client: Anthropic;

  constructor(opts: { apiKey?: string; baseUrl?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ProviderUnavailableError("anthropic", "ANTHROPIC_API_KEY is not set");
    this.client = new Anthropic({ apiKey, baseURL: opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL });
    this.defaultModel = opts.model && opts.model !== "default" ? opts.model : DEFAULT_MODEL;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const turns = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const model = opts.model && opts.model !== "default" ? opts.model : this.defaultModel;

    const res = await this.client.messages.create(
      {
        model,
        system: system || undefined,
        messages: turns.length ? turns : [{ role: "user", content: "" }],
        max_tokens: opts.maxOutputTokens ?? 4096,
        temperature: opts.temperature ?? 0,
      },
      { signal: opts.signal },
    );

    const text = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return {
      text,
      model,
      usage: { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens },
    };
  }
}
