import { z } from 'zod';

// Agent override configuration (distinct from SDK's AgentConfig)
export const AgentOverrideConfigSchema = z
  .object({
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    variant: z.string().optional().catch(undefined),
    options: z.record(z.string(), z.unknown()).optional(), // provider-specific model options (e.g., textVerbosity, thinking budget)
    displayName: z.string().min(1).optional(),
  })
  .passthrough();

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;

export const PresetSchema = z.record(z.string(), AgentOverrideConfigSchema);

export type Preset = z.infer<typeof PresetSchema>;

// Websearch provider configuration
export const WebsearchConfigSchema = z.object({
  provider: z.enum(['exa', 'tavily']).default('exa'),
});
export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>;

export const SessionManagerConfigSchema = z.object({
  maxSessionsPerAgent: z.number().int().min(1).max(10).default(2),
  readContextMinLines: z.number().int().min(0).max(1000).default(10),
  readContextMaxFiles: z.number().int().min(0).max(50).default(8),
});

export type SessionManagerConfig = z.infer<typeof SessionManagerConfigSchema>;

// Todo continuation configuration
export const TodoContinuationConfigSchema = z.object({
  maxContinuations: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(5)
    .describe(
      'Maximum consecutive auto-continuations before stopping to ask user',
    ),
  cooldownMs: z
    .number()
    .int()
    .min(0)
    .max(30_000)
    .default(3000)
    .describe('Delay in ms before auto-continuing (gives user time to abort)'),
  autoEnable: z
    .boolean()
    .default(false)
    .describe(
      'Automatically enable auto-continue when the orchestrator session has enough todos',
    ),
  autoEnableThreshold: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(4)
    .describe(
      'Number of todos that triggers auto-enable (only used when autoEnable is true)',
    ),
});

export type TodoContinuationConfig = z.infer<
  typeof TodoContinuationConfigSchema
>;

export const ContextPressureConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe(
      'When true, warn the orchestrator on high context usage before the model fails.',
    ),
  warnThresholdPct: z
    .number()
    .min(1)
    .max(99)
    .default(75)
    .describe(
      'Inject a /compact reminder when context (used ÷ limit) is at least this percent.',
    ),
});

export type ContextPressureConfig = z.infer<typeof ContextPressureConfigSchema>;

export const PluginConfigSchema = z.object({
  preset: z.string().optional(),
  setDefaultAgent: z.boolean().optional(),

  autoUpdate: z
    .boolean()
    .optional()
    .describe(
      'Disable automatic installation of plugin updates when false. Defaults to true.',
    ),

  presets: z.record(z.string(), PresetSchema).optional(),
  agents: z.record(z.string(), AgentOverrideConfigSchema).optional(),
  websearch: WebsearchConfigSchema.optional(),
  sessionManager: SessionManagerConfigSchema.optional(),
  todoContinuation: TodoContinuationConfigSchema.optional(),
  contextPressure: ContextPressureConfigSchema.optional(),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// Agent names - re-exported from constants for convenience
export type { AgentName } from './constants';
