export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** ask the provider for strict JSON output when it supports a JSON mode. */
  json?: boolean;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Provider-neutral chat surface (master plan §17, §151). The native worker drives a text-only
 * JSON-action loop on top of this, so every provider — including local Ollama — participates
 * without a bespoke tool-calling protocol.
 */
export interface LlmProvider {
  readonly id: string;
  readonly defaultModel: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  listModels?(): Promise<string[]>;
}

export class ProviderUnavailableError extends Error {
  constructor(providerId: string, reason: string) {
    super(`LLM provider "${providerId}" unavailable: ${reason}`);
    this.name = "ProviderUnavailableError";
  }
}
