import { z } from 'zod';

const FALLBACK_AGENT_NAMES = [
  'orchestrator',
  'oracle',
  'designer',
  'explorer',
  'librarian',
  'fixer',
  'steward',
  'interpreter',
] as const;

const MANUAL_AGENT_NAMES = [
  'orchestrator',
  'oracle',
  'designer',
  'explorer',
  'librarian',
  'fixer',
] as const;

export const ProviderModelIdSchema = z
  .string()
  .regex(
    /^[^/\s]+\/[^\s]+$/,
    'Expected provider/model format (provider/.../model)',
  );

export const ManualAgentPlanSchema = z
  .object({
    primary: ProviderModelIdSchema,
    fallback1: ProviderModelIdSchema,
    fallback2: ProviderModelIdSchema,
    fallback3: ProviderModelIdSchema,
  })
  .superRefine((value, ctx) => {
    const unique = new Set([
      value.primary,
      value.fallback1,
      value.fallback2,
      value.fallback3,
    ]);
    if (unique.size !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'primary and fallbacks must be unique per agent',
      });
    }
  });

export const ManualPlanSchema = z
  .object({
    orchestrator: ManualAgentPlanSchema,
    oracle: ManualAgentPlanSchema,
    designer: ManualAgentPlanSchema,
    explorer: ManualAgentPlanSchema,
    librarian: ManualAgentPlanSchema,
    fixer: ManualAgentPlanSchema,
  })
  .strict();

export type ManualAgentName = (typeof MANUAL_AGENT_NAMES)[number];
export type ManualAgentPlan = z.infer<typeof ManualAgentPlanSchema>;
export type ManualPlan = z.infer<typeof ManualPlanSchema>;

const AgentModelChainSchema = z.array(z.string()).min(1);

const FallbackChainsSchema = z
  .object({
    orchestrator: AgentModelChainSchema.optional(),
    oracle: AgentModelChainSchema.optional(),
    designer: AgentModelChainSchema.optional(),
    explorer: AgentModelChainSchema.optional(),
    librarian: AgentModelChainSchema.optional(),
    fixer: AgentModelChainSchema.optional(),
    steward: AgentModelChainSchema.optional(),
    interpreter: AgentModelChainSchema.optional(),
  })
  .catchall(AgentModelChainSchema);

export type FallbackAgentName = (typeof FALLBACK_AGENT_NAMES)[number];

const SkillOrMcpConfigSchema = z.union([
  z.array(z.string()),
  z.object({
    'always-load': z.array(z.string()).optional(),
    mandatory: z.array(z.string()).optional(), // DEPRECATED - remove in next release
    wildcard: z.boolean().optional(),
  }),
]);

// Agent override configuration (distinct from SDK's AgentConfig)
export const AgentOverrideConfigSchema = z
  .object({
    model: z
      .union([
        z.string(),
        z
          .array(
            z.union([
              z.string(),
              z.object({
                id: z.string(),
                variant: z.string().optional(),
              }),
            ]),
          )
          .min(1),
      ])
      .optional(),
    temperature: z.number().min(0).max(2).optional(),
    variant: z.string().optional().catch(undefined),
    options: z.record(z.string(), z.unknown()).optional(), // provider-specific model options (e.g., textVerbosity, thinking budget)
    displayName: z.string().min(1).optional(),
    skills: SkillOrMcpConfigSchema.optional(), // skills this agent can use ("*" = all, "!item" = exclude)
    mcps: SkillOrMcpConfigSchema.optional(), // MCPs this agent can use (same syntax as skills)
  })
  .strict();

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;

/** Normalized model entry with optional per-model variant. */
export type ModelEntry = { id: string; variant?: string };

export const PresetSchema = z.record(z.string(), AgentOverrideConfigSchema);

export type Preset = z.infer<typeof PresetSchema>;

// Websearch provider configuration
export const WebsearchConfigSchema = z.object({
  provider: z.enum(['exa', 'tavily']).default('exa'),
});
export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>;

// MCP names
export const McpNameSchema = z.enum(['websearch', 'context7', 'grep_app']);
export type McpName = z.infer<typeof McpNameSchema>;

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

export const FailoverConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().min(0).default(15000),
  retryDelayMs: z.number().min(0).default(500),
  chains: FallbackChainsSchema.default({}),
  retry_on_empty: z
    .boolean()
    .default(true)
    .describe(
      'When true (default), empty provider responses are treated as failures, ' +
        'triggering fallback/retry. Set to false to treat them as successes.',
    ),
});

export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;

export const PluginConfigSchema = z.object({
  preset: z.string().optional(),
  setDefaultAgent: z.boolean().optional(),
  scoringEngineVersion: z.enum(['v1', 'v2-shadow', 'v2']).optional(),
  balanceProviderUsage: z.boolean().optional(),
  autoUpdate: z
    .boolean()
    .optional()
    .describe(
      'Disable automatic installation of plugin updates when false. Defaults to true.',
    ),
  manualPlan: ManualPlanSchema.optional(),
  presets: z.record(z.string(), PresetSchema).optional(),
  agents: z.record(z.string(), AgentOverrideConfigSchema).optional(),
  websearch: WebsearchConfigSchema.optional(),
  sessionManager: SessionManagerConfigSchema.optional(),
  todoContinuation: TodoContinuationConfigSchema.optional(),
  contextPressure: ContextPressureConfigSchema.optional(),
  fallback: FailoverConfigSchema.optional(),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// Agent names - re-exported from constants for convenience
export type { AgentName } from './constants';

export type SkillOrMcpConfig = z.infer<typeof SkillOrMcpConfigSchema>;
