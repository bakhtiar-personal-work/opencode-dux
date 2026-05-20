import type { SkillOrMcpConfig } from '../config';
import { type NormalizedSkillConfig, normalizeSkillConfig } from './skills';

export type { NormalizedSkillConfig as NormalizedMcpConfig };
// Reuse normalizeSkillConfig for McpConfig since it has the same shape
export { normalizeSkillConfig as normalizeMcpConfig };

/**
 * Get MCP permissions for a specific agent.
 * MCP permission rules use 'allow'/'deny' per MCP name.
 *
 * @param agentName - The agent name
 * @param mcpList - Optional MCP config (object or array syntax)
 * @returns Permission rules keyed by MCP name
 */
export async function getMcpPermissionsForAgent(
  _agentName: string,
  mcpList?: SkillOrMcpConfig,
): Promise<Record<string, 'allow' | 'ask' | 'deny'>> {
  const permissions: Record<string, 'allow' | 'ask' | 'deny'> = {};

  if (mcpList === undefined) {
    // Default: all builtin MCPs allowed for all agents
    permissions['*'] = 'allow';
    return permissions;
  }

  const normalized = normalizeSkillConfig(mcpList);
  permissions['*'] = normalized.wildcard ? 'allow' : 'deny';

  for (const name of normalized.alwaysLoad) {
    permissions[name] = 'allow';
  }
  for (const name of normalized.excluded) {
    permissions[name] = 'deny';
  }

  return permissions;
}
