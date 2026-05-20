import type { AgentConfig } from '@opencode-ai/sdk/v2';
export interface AgentDefinition {
    name: string;
    displayName?: string;
    description?: string;
    config: AgentConfig;
    /** Priority-ordered model entries for runtime fallback resolution. */
    _modelArray?: Array<{
        id: string;
        variant?: string;
    }>;
}
/**
 * Resolve agent prompt from base/custom/append inputs.
 * If customPrompt is provided, it replaces the base entirely.
 * Otherwise, customAppendPrompt is appended to the base.
 */
export declare function resolvePrompt(base: string, customPrompt?: string, customAppendPrompt?: string): string;
/**
 * Build the orchestrator prompt.
 * @returns The complete orchestrator prompt string
 */
export declare function buildOrchestratorPrompt(oracleDefaultModel?: string, oracleSmartModel?: string): string;
export declare function createOrchestratorAgent(model?: string | Array<string | {
    id: string;
    variant?: string;
}>, customPrompt?: string, customAppendPrompt?: string, oracleDefaultModel?: string, oracleSmartModel?: string): AgentDefinition;
