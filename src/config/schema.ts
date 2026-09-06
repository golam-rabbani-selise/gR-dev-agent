import { z } from "zod";
import { RoleSchema } from "../riqs/contracts";

export const SCHEMA_VERSION = 1;

export const WorkflowModeSchema = z.enum(["auto", "parallel", "sequential", "single-worker", "manual"]);
export type WorkflowMode = z.infer<typeof WorkflowModeSchema>;

export const RoutingPolicySchema = z.enum(["strict", "fallback"]);

/** A route target: one worker/agent id, or several for ensemble mode (master plan §143). */
const RouteTargetSchema = z.union([z.string(), z.array(z.string()).min(1)]);

export const ProviderConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "openrouter", "ollama"]),
  model: z.string().default("default"),
  baseUrl: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** .riqs-agent/config.json */
export const ConfigSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  mode: WorkflowModeSchema.default("auto"),
  routingPolicy: RoutingPolicySchema.default("fallback"),
  primaryWorker: z.string().optional(),
  parallelism: z.number().int().min(1).max(16).default(4),
  routing: z.record(RoleSchema, RouteTargetSchema).default({}),
  preferences: z.record(RoleSchema, z.array(z.string())).default({}),
  taskDefaults: z.record(z.string(), z.record(RoleSchema, RouteTargetSchema)).default({}),
  skip: z.array(z.string()).default([]),
  native: z
    .object({
      default: z.string().default("default"),
      providers: z.record(z.string(), ProviderConfigSchema).default({}),
    })
    .default({ default: "default", providers: {} }),
  integrations: z
    .object({
      installation: z
        .object({
          enabled: z.boolean().default(true),
          allowAutomaticDownload: z.boolean().default(false),
          allowedMethods: z.array(z.string()).default(["npm", "winget", "brew"]),
          allowedIntegrations: z.array(z.string()).default(["claude", "codex", "cursor", "opencode", "antigravity"]),
        })
        .default({}),
    })
    .default({}),
});
export type Config = z.infer<typeof ConfigSchema>;

/** .riqs-agent/workers.json (master plan §127) */
export const WorkersConfigSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  workers: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().default(true),
        roles: z.array(RoleSchema).default([]),
        capabilities: z.array(z.string()).default([]),
      }),
    )
    .default({}),
});
export type WorkersConfig = z.infer<typeof WorkersConfigSchema>;

/** .riqs-agent/agents.json (master plan §165) */
export const AgentsConfigSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  agents: z
    .record(
      z.string(),
      z.object({
        worker: z.string(),
        model: z.string().default("default"),
        enabled: z.boolean().default(true),
        roles: z.array(RoleSchema).default([]),
        instructions: z.string().optional(),
        toolPermissions: z.array(z.string()).optional(),
        skills: z.array(z.string()).default([]),
        capabilities: z.array(z.string()).default([]),
      }),
    )
    .default({}),
});
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;

/** .riqs-agent/profiles/<name>.json (master plan §148) */
export const ProfileSchema = z.object({
  name: z.string(),
  mode: WorkflowModeSchema.optional(),
  routingPolicy: RoutingPolicySchema.optional(),
  primaryWorker: z.string().optional(),
  workers: WorkersConfigSchema.shape.workers.optional(),
  routing: ConfigSchema.shape.routing.optional(),
  skip: z.array(z.string()).optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;
