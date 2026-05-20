import type { WebsearchConfig } from '../config';
import type { McpConfig } from './types';
export type { LocalMcpConfig, McpConfig, RemoteMcpConfig } from './types';
/**
 * Creates MCP configurations, excluding disabled ones.
 * Accepts an optional websearchConfig to override the default Exa provider.
 */
export declare function createBuiltinMcps(disabledMcps?: readonly string[], websearchConfig?: WebsearchConfig): Record<string, McpConfig>;
/**
 * Filter MCP configs for a specific agent based on its MCP permissions.
 * When no permission rules exist, all MCPs are available.
 */
export declare function filterMcpsForAgent(allMcps: Record<string, McpConfig>, _agentName: string, mcpPermissionRules?: Record<string, 'allow' | 'ask' | 'deny'>): Record<string, McpConfig>;
