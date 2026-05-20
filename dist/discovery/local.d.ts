import type { PluginInput } from '@opencode-ai/plugin';
/**
 * A single MCP server discovered via the OpenCode SDK.
 */
export interface DiscoveredMcp {
    /** Unique name used as the config key (e.g., 'playwright', 'github'). */
    name: string;
    /** Current connection status reported by OpenCode. */
    status: 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration';
    /** Human-readable description, may include error details when status is 'failed'. */
    description?: string;
    /** Categorization tags derived from the MCP name. */
    tags: string[];
    /** Agents that benefit most from this MCP based on defaults. */
    recommendedAgents: string[];
}
/**
 * A single skill discovered via the OpenCode SDK.
 */
export interface DiscoveredSkill {
    /** Unique skill name. */
    name: string;
    /** Human-readable description. */
    description?: string;
    /** Filesystem location of the skill (SKILL.md path). */
    location: string;
    /** Categorization tags derived from the skill name. */
    tags: string[];
    /** Agents that benefit most from this skill based on defaults. */
    recommendedAgents: string[];
    /** Whether the skill ships with the plugin or was added by the user. */
    source: 'bundled' | 'user';
}
/**
 * Complete result of an SDK-based local discovery scan.
 */
export interface LocalDiscoveryResult {
    /** Discovered skills. */
    skills: DiscoveredSkill[];
    /** Discovered MCP servers. */
    mcps: DiscoveredMcp[];
    /** Unix timestamp (ms) when the scan was performed. */
    scannedAt: number;
    /** How long the scan took in milliseconds. */
    scanDurationMs: number;
}
/**
 * Scan locally configured MCP servers and skills using the OpenCode SDK.
 *
 * Calls `ctx.client.mcp.status()` and `ctx.client.instance.skill()` for fast,
 * authoritative local discovery. Each SDK call is independently wrapped in a
 * try/catch so that a failure in one does not prevent the other from
 * succeeding. Empty arrays are returned for any failing SDK call.
 *
 * Results are **not** cached by this function – use
 * {@link getLocalDiscovery} for caching support.
 *
 * @param ctx - The OpenCode plugin input context
 * @returns A {@link LocalDiscoveryResult} with discovered MCPs and skills
 */
export declare function scanLocal(ctx: PluginInput): Promise<LocalDiscoveryResult>;
/**
 * Get locally discovered resources, using a cached result when available.
 *
 * Results are cached for 5 minutes. Call with `forceRefresh = true` to
 * bypass the cache and perform a fresh scan. The cache lives at module
 * scope and is shared across all callers within the same plugin instance.
 *
 * @param ctx - The OpenCode plugin input context
 * @param forceRefresh - If `true`, bypass the cache and force a fresh scan
 * @returns A {@link LocalDiscoveryResult}
 */
export declare function getLocalDiscovery(ctx: PluginInput, forceRefresh?: boolean): Promise<LocalDiscoveryResult>;
