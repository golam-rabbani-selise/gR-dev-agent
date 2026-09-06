import { OpenAiCompatibleProvider } from "./openai";

/** OpenRouter is OpenAI-compatible; just a different base URL + key (master plan §17). */
export function createOpenRouterProvider(model?: string): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    id: "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    model,
    defaultModel: "openrouter/auto",
  });
}
