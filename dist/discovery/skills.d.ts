import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
/**
 * Input parameters for discovering OpenCode skills online.
 */
export interface DiscoverSkillsInput {
    /** Natural-language description of the task at hand. */
    task_description: string;
    /** Keywords that characterise the task (used for search queries). */
    task_keywords: string[];
    /** The subagent that initiated the discovery request. */
    agent_name: string;
    /**
     * Skills already known to be installed.
     * Recommendations that match by name will be filtered out or marked.
     */
    existing_skill_names?: string[];
    /** Maximum number of recommendations to return (default: 5). */
    max_results?: number;
}
/**
 * A single recommendation for an installable OpenCode skill.
 */
export interface SkillRecommendation {
    type: 'skill';
    /** Canonical name (e.g. 'ast-grep', 'codemap'). */
    name: string;
    /** Human-readable summary of what the skill provides. */
    description: string;
    /**
     * A ready-to-use install command, e.g.
     * `npx skills add https://github.com/vercel-labs/skills --skill ast-grep`.
     */
    install_command: string;
    /** Why this recommendation is relevant to the task. */
    relevance_reason: string;
    /** Relevance score from 0 (irrelevant) to 1 (perfect match). */
    relevance_score: number;
    /** GitHub repository URL for the skill. */
    source_url: string;
    /** Agent names that are most likely to benefit from this skill. */
    recommended_agents: string[];
    /** Categorisation tags (e.g. 'search', 'code', 'ast'). */
    tags: string[];
    /** Whether the user already has this skill installed. */
    already_installed?: boolean;
}
/**
 * The complete output of a skill discovery request.
 */
export interface DiscoverSkillsOutput {
    /** Ordered list of recommendations, highest relevance first. */
    recommendations: SkillRecommendation[];
    /** Whether the result was served from cache. */
    from_cache: boolean;
    /** The search queries that were executed. */
    queries_used: string[];
}
/**
 * Run the full skill discovery flow for a given set of inputs.
 *
 * 1. Builds search queries from keywords and agent name
 * 2. Searches the vercel-labs/skills repository for skill definitions
 * 3. Searches GitHub broadly for opencode skill-related repositories
 * 4. Tries the OpenCode SDK's skill endpoint (if available)
 * 5. Merges, deduplicates, and scores results
 * 6. Returns the top N results
 *
 * Does NOT search npm.
 * Results are cached on disk for 7 days (skills change less often).
 */
export declare function discoverSkills(input: DiscoverSkillsInput, ctx: PluginInput): Promise<DiscoverSkillsOutput>;
/**
 * Create the `discover_skills_online` tool that subagents can call to find
 * installable OpenCode skills for a given task.
 *
 * The tool:
 * 1. Builds search queries from task keywords and agent name
 * 2. Searches the vercel-labs/skills repository and general GitHub for skills
 * 3. Tries the OpenCode SDK's skill endpoint if available
 * 4. Scores each result by relevance (0-1)
 * 5. Marks already-installed skills with `already_installed: true` and
 *    only includes them when relevance_score > 0.8
 * 6. Returns the top N recommendations with install commands
 *
 * Does NOT search npm. Skills are knowledge/prompt resources separate from
 * MCP servers (which are tool/capability resources).
 *
 * Results are cached on disk at `~/.config/opencode/discovery-cache.json`
 * with a 7-day TTL and LRU eviction (max 100 entries).
 *
 * @param ctx - The OpenCode plugin input (provides client for SDK access)
 * @returns A `ToolDefinition` ready for registration in the plugin's tool hook
 */
export declare function createDiscoverSkillsTool(ctx: PluginInput): ToolDefinition;
