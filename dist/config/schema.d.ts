import { z } from 'zod';
declare const FALLBACK_AGENT_NAMES: readonly ["orchestrator", "oracle", "designer", "explorer", "librarian", "fixer", "steward", "interpreter"];
declare const MANUAL_AGENT_NAMES: readonly ["orchestrator", "oracle", "designer", "explorer", "librarian", "fixer"];
export declare const ProviderModelIdSchema: z.ZodString;
export declare const ManualAgentPlanSchema: z.ZodObject<{
    primary: z.ZodString;
    fallback1: z.ZodString;
    fallback2: z.ZodString;
    fallback3: z.ZodString;
}, z.core.$strip>;
export declare const ManualPlanSchema: z.ZodObject<{
    orchestrator: z.ZodObject<{
        primary: z.ZodString;
        fallback1: z.ZodString;
        fallback2: z.ZodString;
        fallback3: z.ZodString;
    }, z.core.$strip>;
    oracle: z.ZodObject<{
        primary: z.ZodString;
        fallback1: z.ZodString;
        fallback2: z.ZodString;
        fallback3: z.ZodString;
    }, z.core.$strip>;
    designer: z.ZodObject<{
        primary: z.ZodString;
        fallback1: z.ZodString;
        fallback2: z.ZodString;
        fallback3: z.ZodString;
    }, z.core.$strip>;
    explorer: z.ZodObject<{
        primary: z.ZodString;
        fallback1: z.ZodString;
        fallback2: z.ZodString;
        fallback3: z.ZodString;
    }, z.core.$strip>;
    librarian: z.ZodObject<{
        primary: z.ZodString;
        fallback1: z.ZodString;
        fallback2: z.ZodString;
        fallback3: z.ZodString;
    }, z.core.$strip>;
    fixer: z.ZodObject<{
        primary: z.ZodString;
        fallback1: z.ZodString;
        fallback2: z.ZodString;
        fallback3: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strict>;
export type ManualAgentName = (typeof MANUAL_AGENT_NAMES)[number];
export type ManualAgentPlan = z.infer<typeof ManualAgentPlanSchema>;
export type ManualPlan = z.infer<typeof ManualPlanSchema>;
export type FallbackAgentName = (typeof FALLBACK_AGENT_NAMES)[number];
declare const SkillOrMcpConfigSchema: z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
    'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
    mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
    wildcard: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>]>;
export declare const AgentOverrideConfigSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        id: z.ZodString;
        variant: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>]>>]>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    variant: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    displayName: z.ZodOptional<z.ZodString>;
    skills: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
        'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
        mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
        wildcard: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>>;
    mcps: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
        'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
        mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
        wildcard: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>>;
}, z.core.$strict>;
export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>;
/** Normalized model entry with optional per-model variant. */
export type ModelEntry = {
    id: string;
    variant?: string;
};
export declare const PresetSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    model: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
        id: z.ZodString;
        variant: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>]>>]>>;
    temperature: z.ZodOptional<z.ZodNumber>;
    variant: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    displayName: z.ZodOptional<z.ZodString>;
    skills: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
        'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
        mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
        wildcard: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>>;
    mcps: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
        'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
        mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
        wildcard: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>]>>;
}, z.core.$strict>>;
export type Preset = z.infer<typeof PresetSchema>;
export declare const WebsearchConfigSchema: z.ZodObject<{
    provider: z.ZodDefault<z.ZodEnum<{
        exa: "exa";
        tavily: "tavily";
    }>>;
}, z.core.$strip>;
export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>;
export declare const McpNameSchema: z.ZodEnum<{
    websearch: "websearch";
    context7: "context7";
    grep_app: "grep_app";
}>;
export type McpName = z.infer<typeof McpNameSchema>;
export declare const SessionManagerConfigSchema: z.ZodObject<{
    maxSessionsPerAgent: z.ZodDefault<z.ZodNumber>;
    readContextMinLines: z.ZodDefault<z.ZodNumber>;
    readContextMaxFiles: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type SessionManagerConfig = z.infer<typeof SessionManagerConfigSchema>;
export declare const TodoContinuationConfigSchema: z.ZodObject<{
    maxContinuations: z.ZodDefault<z.ZodNumber>;
    cooldownMs: z.ZodDefault<z.ZodNumber>;
    autoEnable: z.ZodDefault<z.ZodBoolean>;
    autoEnableThreshold: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type TodoContinuationConfig = z.infer<typeof TodoContinuationConfigSchema>;
export declare const ContextPressureConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    warnThresholdPct: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type ContextPressureConfig = z.infer<typeof ContextPressureConfigSchema>;
export declare const FailoverConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    retryDelayMs: z.ZodDefault<z.ZodNumber>;
    chains: z.ZodDefault<z.ZodObject<{
        orchestrator: z.ZodOptional<z.ZodArray<z.ZodString>>;
        oracle: z.ZodOptional<z.ZodArray<z.ZodString>>;
        designer: z.ZodOptional<z.ZodArray<z.ZodString>>;
        explorer: z.ZodOptional<z.ZodArray<z.ZodString>>;
        librarian: z.ZodOptional<z.ZodArray<z.ZodString>>;
        fixer: z.ZodOptional<z.ZodArray<z.ZodString>>;
        steward: z.ZodOptional<z.ZodArray<z.ZodString>>;
        interpreter: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$catchall<z.ZodArray<z.ZodString>>>>;
    retry_on_empty: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type FailoverConfig = z.infer<typeof FailoverConfigSchema>;
export declare const PluginConfigSchema: z.ZodObject<{
    preset: z.ZodOptional<z.ZodString>;
    setDefaultAgent: z.ZodOptional<z.ZodBoolean>;
    scoringEngineVersion: z.ZodOptional<z.ZodEnum<{
        v1: "v1";
        "v2-shadow": "v2-shadow";
        v2: "v2";
    }>>;
    balanceProviderUsage: z.ZodOptional<z.ZodBoolean>;
    autoUpdate: z.ZodOptional<z.ZodBoolean>;
    manualPlan: z.ZodOptional<z.ZodObject<{
        orchestrator: z.ZodObject<{
            primary: z.ZodString;
            fallback1: z.ZodString;
            fallback2: z.ZodString;
            fallback3: z.ZodString;
        }, z.core.$strip>;
        oracle: z.ZodObject<{
            primary: z.ZodString;
            fallback1: z.ZodString;
            fallback2: z.ZodString;
            fallback3: z.ZodString;
        }, z.core.$strip>;
        designer: z.ZodObject<{
            primary: z.ZodString;
            fallback1: z.ZodString;
            fallback2: z.ZodString;
            fallback3: z.ZodString;
        }, z.core.$strip>;
        explorer: z.ZodObject<{
            primary: z.ZodString;
            fallback1: z.ZodString;
            fallback2: z.ZodString;
            fallback3: z.ZodString;
        }, z.core.$strip>;
        librarian: z.ZodObject<{
            primary: z.ZodString;
            fallback1: z.ZodString;
            fallback2: z.ZodString;
            fallback3: z.ZodString;
        }, z.core.$strip>;
        fixer: z.ZodObject<{
            primary: z.ZodString;
            fallback1: z.ZodString;
            fallback2: z.ZodString;
            fallback3: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strict>>;
    presets: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodObject<{
        model: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            id: z.ZodString;
            variant: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>]>>]>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        variant: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        displayName: z.ZodOptional<z.ZodString>;
        skills: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
            'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
            mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
            wildcard: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>]>>;
        mcps: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
            'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
            mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
            wildcard: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>]>>;
    }, z.core.$strict>>>>;
    agents: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        model: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodObject<{
            id: z.ZodString;
            variant: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>]>>]>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        variant: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        displayName: z.ZodOptional<z.ZodString>;
        skills: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
            'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
            mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
            wildcard: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>]>>;
        mcps: z.ZodOptional<z.ZodUnion<readonly [z.ZodArray<z.ZodString>, z.ZodObject<{
            'always-load': z.ZodOptional<z.ZodArray<z.ZodString>>;
            mandatory: z.ZodOptional<z.ZodArray<z.ZodString>>;
            wildcard: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>]>>;
    }, z.core.$strict>>>;
    websearch: z.ZodOptional<z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<{
            exa: "exa";
            tavily: "tavily";
        }>>;
    }, z.core.$strip>>;
    sessionManager: z.ZodOptional<z.ZodObject<{
        maxSessionsPerAgent: z.ZodDefault<z.ZodNumber>;
        readContextMinLines: z.ZodDefault<z.ZodNumber>;
        readContextMaxFiles: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    todoContinuation: z.ZodOptional<z.ZodObject<{
        maxContinuations: z.ZodDefault<z.ZodNumber>;
        cooldownMs: z.ZodDefault<z.ZodNumber>;
        autoEnable: z.ZodDefault<z.ZodBoolean>;
        autoEnableThreshold: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    contextPressure: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        warnThresholdPct: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    fallback: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        retryDelayMs: z.ZodDefault<z.ZodNumber>;
        chains: z.ZodDefault<z.ZodObject<{
            orchestrator: z.ZodOptional<z.ZodArray<z.ZodString>>;
            oracle: z.ZodOptional<z.ZodArray<z.ZodString>>;
            designer: z.ZodOptional<z.ZodArray<z.ZodString>>;
            explorer: z.ZodOptional<z.ZodArray<z.ZodString>>;
            librarian: z.ZodOptional<z.ZodArray<z.ZodString>>;
            fixer: z.ZodOptional<z.ZodArray<z.ZodString>>;
            steward: z.ZodOptional<z.ZodArray<z.ZodString>>;
            interpreter: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$catchall<z.ZodArray<z.ZodString>>>>;
        retry_on_empty: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type { AgentName } from './constants';
export type SkillOrMcpConfig = z.infer<typeof SkillOrMcpConfigSchema>;
