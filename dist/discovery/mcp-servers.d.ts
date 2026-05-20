import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
/**
 * Input parameters for discovering MCP servers online.
 */
export interface McpDiscoveryInput {
    /** Natural-language description of the task at hand. */
    task_description: string;
    /** Keywords that characterise the task (used for search queries). */
    task_keywords: string[];
    /** The subagent that initiated the discovery request. */
    agent_name: string;
    /**
     * MCP servers already known to be installed.
     * Recommendations that match by name will be filtered out.
     */
    existing_mcp_names?: string[];
    /** Maximum number of recommendations to return (default: 5). */
    max_results?: number;
}
/**
 * A single recommendation for an installable MCP server.
 */
export interface McpRecommendation {
    type: 'mcp';
    /** Canonical name (e.g. 'playwright', 'github'). */
    name: string;
    /** Human-readable summary of what the MCP server provides. */
    description: string;
    /**
     * A ready-to-use JSON config block for the user's opencode config,
     * e.g. `{"mcpServers": {"playwright": {"command": ["npx", "@modelcontextprotocol/server-playwright"]}}}`.
     */
    install_command: string;
    /** Why this recommendation is relevant to the task. */
    relevance_reason: string;
    /** Relevance score from 0 (irrelevant) to 1 (perfect match). */
    relevance_score: number;
    /** URL to the project's homepage, repository, or package page. */
    source_url?: string;
    /** Agent names that are most likely to benefit from this MCP server. */
    recommended_agents: string[];
    /** Categorisation tags (e.g. 'browser', 'github', 'filesystem'). */
    tags: string[];
    /** Whether the user already has this MCP server installed. */
    already_installed?: boolean;
}
/**
 * The complete output of an MCP discovery request.
 */
export interface McpDiscoveryOutput {
    /** Ordered list of recommendations, highest relevance first. */
    recommendations: McpRecommendation[];
    /** Whether the result was served from cache. */
    from_cache: boolean;
    /** The search queries that were executed. */
    queries_used: string[];
}
/**
 * Run the full MCP discovery flow for a given set of inputs.
 *
 * 1. Builds search queries from keywords and agent name
 * 2. Searches the npm registry for matching MCP packages
 * 3. Maps results to recommendations with relevance scores
 * 4. Marks already-installed items with `already_installed: true` and
 *    only includes them when relevance_score > 0.8
 * 5. Returns the top N results
 *
 * Results are cached on disk for 24 hours.
 */
export declare function discoverMcpServers(input: McpDiscoveryInput, ctx: PluginInput): Promise<McpDiscoveryOutput>;
/**
 * Create the `discover_mcp_servers` tool that subagents can call to find
 * installable MCP servers for a given task.
 *
 * The tool:
 * 1. Builds search queries from task keywords and agent name
 * 2. Searches the npm registry for verified MCP packages
 * 3. Scores each result by relevance (0-1)
 * 4. Filters out MCP servers the user already has installed
 * 5. Returns the top N recommendations with ready-to-use mcpServers JSON config
 *
 * Results are cached on disk at `~/.config/opencode/discovery-cache.json`
 * with a 24-hour TTL and LRU eviction (max 100 entries).
 *
 * @param ctx - The OpenCode plugin input (provides client for SDK access)
 * @returns A `ToolDefinition` ready for registration in the plugin's tool hook
 */
export declare function createDiscoverMcpServersTool(ctx: PluginInput): ToolDefinition;
