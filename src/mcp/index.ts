import type { McpName, WebsearchConfig } from '../config';
import { context7 } from './context7';
import { grep_app } from './grep-app';
import type { McpConfig } from './types';
import { createWebsearchConfig, websearch } from './websearch';

export type { LocalMcpConfig, McpConfig, RemoteMcpConfig } from './types';

const allBuiltinMcps: Record<McpName, McpConfig> = {
  websearch,
  context7,
  grep_app,
};

/**
 * Creates MCP configurations, excluding disabled ones.
 * Accepts an optional websearchConfig to override the default Exa provider.
 */
export function createBuiltinMcps(
  disabledMcps: readonly string[] = [],
  websearchConfig?: WebsearchConfig,
): Record<string, McpConfig> {
  const mcps = Object.fromEntries(
    Object.entries(allBuiltinMcps).filter(
      ([name]) => !disabledMcps.includes(name),
    ),
  );

  // Override websearch with user-configured provider (default: Exa)
  if (!disabledMcps.includes('websearch')) {
    mcps.websearch = createWebsearchConfig(websearchConfig);
  }

  return mcps;
}

/**
 * Filter MCP configs for a specific agent based on its MCP permissions.
 * When no permission rules exist, all MCPs are available.
 */
export function filterMcpsForAgent(
  allMcps: Record<string, McpConfig>,
  _agentName: string,
  mcpPermissionRules?: Record<string, 'allow' | 'ask' | 'deny'>,
): Record<string, McpConfig> {
  if (!mcpPermissionRules) {
    return allMcps; // all allowed
  }

  const hasWildcard = mcpPermissionRules['*'] === 'allow';
  const filtered: Record<string, McpConfig> = {};

  for (const [name, config] of Object.entries(allMcps)) {
    const specific = mcpPermissionRules[name];
    if (specific === 'allow') {
      filtered[name] = config;
    } else if (specific === 'deny') {
    } else if (hasWildcard) {
      // No specific rule and wildcard is active → include
      filtered[name] = config;
    }
    // else: no wildcard and no specific rule → exclude
  }

  return filtered;
}
