/**
 * Type definitions for the discovery module.
 *
 * These types describe MCP servers and skills discovered from local
 * filesystem sources (node_modules, skill directories, etc.).
 *
 * @module
 */
/**
 * An MCP server discovered from a local source (e.g., node_modules).
 */
export interface DiscoveredMcp {
    /** Unique name used as the config key (e.g., 'server-github'). */
    name: string;
    /** Command to launch the MCP server (e.g., `['npx', '@org/mcp-server']`). */
    command: string[];
    /** Human-readable description of what this MCP provides. */
    description?: string;
    /** Categorization tags (e.g., 'browser', 'github', 'filesystem'). */
    tags: string[];
    /** Source identifier indicating where this was found (e.g., 'node_modules'). */
    source: string;
    /** Absolute path to the package.json that defined this MCP. */
    packageJsonPath: string;
    /** Version from the package.json, if available. */
    version?: string;
}
/**
 * A skill discovered from a local source (skill directory, plugin root, etc.).
 */
export interface DiscoveredSkill {
    /** Unique skill name (derived from folder name). */
    name: string;
    /** Human-readable description. */
    description: string;
    /** Absolute path to the SKILL.md file. */
    path: string;
    /** Tags for categorisation and matching. */
    tags: string[];
    /** Agents that are recommended to use this skill. */
    recommendedAgents: string[];
    /** Source identifier (e.g., 'plugin', 'user-skills-dir'). */
    source: string;
    /** Version of the skill, if available. */
    version?: string;
}
/**
 * Complete result of a local discovery scan.
 */
export interface LocalDiscoveryResult {
    /** Discovered MCP servers. */
    mcps: DiscoveredMcp[];
    /** Discovered skills. */
    skills: DiscoveredSkill[];
    /** ISO timestamp when the scan was performed. */
    scannedAt: string;
    /** How long the scan took in milliseconds. */
    scanDurationMs: number;
}
/**
 * Options to control the behaviour of a local discovery scan.
 */
export interface ScanOptions {
    /**
     * Additional directories to scan for skills (absolute paths).
     * Skills are discovered from each directory using the same SKILL.md
     * convention as the plugin's built-in skills.
     */
    userSkillsDirs?: string[];
    /**
     * If true, skip scanning node_modules for MCP servers.
     * Useful when the caller only needs skill discovery.
     */
    skipNodeModules?: boolean;
    /**
     * If true, bypass the module-level cache and force a fresh scan.
     */
    forceRefresh?: boolean;
}
