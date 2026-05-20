import type { PluginInput } from '@opencode-ai/plugin';
import type { SkillOrMcpConfig } from '../config';
export interface NormalizedSkillConfig {
    alwaysLoad: string[];
    wildcard: boolean;
    excluded: string[];
}
export declare function normalizeSkillConfig(raw: SkillOrMcpConfig | undefined): NormalizedSkillConfig;
/**
 * Get permission presets for a specific agent based on recommended skills.
 * @param agentName - The name of the agent
 * @param skillList - Optional explicit list of skills to allow (overrides recommendations)
 * @param ctx - Plugin input context for SDK discovery when wildcard=true
 * @returns Permission rules for the skill permission type
 */
export declare function getSkillPermissionsForAgent(_agentName: string, skillList?: SkillOrMcpConfig, ctx?: PluginInput): Promise<Record<string, 'allow' | 'ask' | 'deny'>>;
/**
 * Scan installed skills from the filesystem via SDK discovery.
 * @param ctx - Plugin input context for SDK discovery
 * @returns Array of skill names that are installed
 */
export declare function scanInstalledSkills(ctx: PluginInput): Promise<string[]>;
