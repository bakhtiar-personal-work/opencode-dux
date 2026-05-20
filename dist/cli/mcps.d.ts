import type { SkillOrMcpConfig } from '../config';
import { type NormalizedSkillConfig, normalizeSkillConfig } from './skills';
export type { NormalizedSkillConfig as NormalizedMcpConfig };
export { normalizeSkillConfig as normalizeMcpConfig };
/**
 * Get MCP permissions for a specific agent.
 * MCP permission rules use 'allow'/'deny' per MCP name.
 *
 * @param agentName - The agent name
 * @param mcpList - Optional MCP config (object or array syntax)
 * @returns Permission rules keyed by MCP name
 */
export declare function getMcpPermissionsForAgent(_agentName: string, mcpList?: SkillOrMcpConfig): Promise<Record<string, 'allow' | 'ask' | 'deny'>>;
