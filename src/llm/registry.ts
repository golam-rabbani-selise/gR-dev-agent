import type { LlmProvider } from "./provider";
import { ProviderUnavailableError } from "./provider";
import { AnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import { createOpenRouterProvider } from "./openrouter";
import { OllamaProvider } from "./ollama";
import type { Config, ProviderConfig } from "../config/schema";
import { RiqsError } from "../util/errors";

export interface ResolvedModel {
  provider: LlmProvider;
  providerId: string;
  model: string;
}

/**
 * Resolve `provider + model + credentials` for a native agent (master plan §17, §163, §174, §185).
 * `model: "default"` defers to the provider's configured default.
 */
export function resolveProvider(name: string, cfg?: ProviderConfig): LlmProvider {
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

function inferProviderId(name: string): ProviderConfig["provider"] {
  const n = name.toLowerCase();
  if (n.includes("claude") || n.includes("anthropic") || n.includes("sonnet") || n.includes("opus")) return "anthropic";
  if (n.includes("openrouter")) return "openrouter";
  if (n.includes("ollama") || n.includes("llama") || n.includes("qwen") || n.includes("mistral")) return "ollama";
  return "openai";
}

function envKey(cfg?: ProviderConfig): string | undefined {
  return cfg?.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
}

/**
 * Pick the native provider for a run. Explicit config wins; otherwise auto-detect the first
 * provider with credentials, preferring a reachable local Ollama so offline use just works.
 */
export function resolveNativeProvider(config: Config, override?: string): ResolvedModel {
  const key = override ?? config.native.default;
  const named = config.native.providers[key];
  if (named) {
    const provider = resolveProvider(key, named);
    return { provider, providerId: named.provider, model: named.model };
  }

  const candidates: { id: ProviderConfig["provider"]; ok: boolean }[] = [
    { id: "anthropic", ok: !!process.env.ANTHROPIC_API_KEY },
    { id: "openai", ok: !!process.env.OPENAI_API_KEY },
    { id: "openrouter", ok: !!process.env.OPENROUTER_API_KEY },
    { id: "ollama", ok: !!process.env.OLLAMA_BASE_URL || true }, // may be running on the default port
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
    hint: "Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY, or run a local Ollama and set OLLAMA_BASE_URL.",
  });
}
