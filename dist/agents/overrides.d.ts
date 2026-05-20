import type { AgentOverrideConfig, SkillOrMcpConfig } from '../config';
import type { AgentDefinition } from './orchestrator';
/**
 * Apply user-provided overrides to an agent's configuration.
 * Supports overriding model (string or priority array), variant, and temperature.
 * When model is an array, stores it as _modelArray for runtime fallback resolution
 * and clears config.model so OpenCode does not pre-resolve a stale value.
 */
export declare function applyOverrides(agent: AgentDefinition, override: AgentOverrideConfig): void;
/**
 * Apply default permissions to an agent.
 * Sets 'question' permission to 'allow' and includes skill permission presets.
 * If configuredSkills is provided, it honors that list instead of defaults.
 *
 * Note: If the agent already explicitly sets question to 'deny', that is
 * respected (e.g., an agent may explicitly deny question permission).
 */
export declare function applyDefaultPermissions(agent: AgentDefinition, configuredSkills?: SkillOrMcpConfig, configuredMcps?: SkillOrMcpConfig): Promise<void>;
