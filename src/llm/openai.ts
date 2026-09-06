import OpenAI from "openai";
import type { ChatMessage, ChatOptions, ChatResult, LlmProvider } from "./provider";
import { ProviderUnavailableError } from "./provider";

interface OpenAiLikeOpts {
  id?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  defaultModel?: string;
  apiKeyRequired?: boolean;
}

/**
 * OpenAI Chat Completions client, reused for any OpenAI-compatible endpoint (OpenRouter, local
 * gateways) by overriding `baseUrl` (master plan §17).
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly defaultModel: string;
  private client: OpenAI;

  constructor(opts: OpenAiLikeOpts = {}) {
    this.id = opts.id ?? "openai";
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey && opts.apiKeyRequired !== false) {
      throw new ProviderUnavailableError(this.id, `${(opts.id ?? "openai").toUpperCase()} API key is not set`);
    }
    this.client = new OpenAI({ apiKey: apiKey ?? "not-required", baseURL: opts.baseUrl });
    this.defaultModel = opts.model && opts.model !== "default" ? opts.model : opts.defaultModel ?? "gpt-4o-mini";
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const model = opts.model && opts.model !== "default" ? opts.model : this.defaultModel;
    const res = await this.client.chat.completions.create(
      {
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxOutputTokens,
        response_format: opts.json ? { type: "json_object" } : undefined,
      },
      { signal: opts.signal },
    );
    return {
      text: (res.choices[0]?.message?.content ?? "").trim(),
      model,
      usage: { inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens },
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.client.models.list();
      return res.data.map((m) => m.id).sort();
    } catch {
      return [];
    }
  }
}

export function createOpenAiProvider(model?: string): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    id: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model,
    defaultModel: "gpt-4o-mini",
  });
}
