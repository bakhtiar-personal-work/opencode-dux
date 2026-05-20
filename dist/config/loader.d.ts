import { type PluginConfig } from './schema';
/**
 * Recursively merge two objects, with override values taking precedence.
 * For nested objects, merges recursively. For arrays and primitives, override replaces base.
 *
 * @param base - Base object to merge into
 * @param override - Override object whose values take precedence
 * @returns Merged object, or undefined if both inputs are undefined
 */
export declare function deepMerge<T extends Record<string, unknown>>(base?: T, override?: T): T | undefined;
/**
 * Load plugin configuration from user and project config files, merging them appropriately.
 *
 * Configuration is loaded from two locations:
 * 1. User config: $OPENCODE_CONFIG_DIR/opencode-dux.jsonc or .json,
 *    or ~/.config/opencode/opencode-dux.jsonc or .json (or $XDG_CONFIG_HOME)
 * 2. Project config: <directory>/.opencode/opencode-dux.jsonc or .json
 *
 * JSONC format is preferred over JSON (allows comments and trailing commas).
 * Project config takes precedence over user config. Nested objects (agents) are
 * deep-merged, while top-level arrays are replaced entirely by project config.
 *
 * @param directory - Project directory to search for .opencode config
 * @returns Merged plugin configuration (empty object if no configs found)
 */
export declare function loadPluginConfig(directory: string): PluginConfig;
/**
 * Load custom prompt for an agent from the prompts directory.
 * Checks for {agent}.md (replaces default) and {agent}_append.md (appends to default).
 * If preset is provided and safe for paths, it first checks {preset}/ subdirectory,
 * then falls back to the root prompts directory.
 *
 * @param agentName - Name of the agent (e.g., "orchestrator", "explorer")
 * @param preset - Optional preset name for preset-scoped prompt lookup
 * @returns Object with prompt and/or appendPrompt if files exist
 */
export declare function loadAgentPrompt(agentName: string, preset?: string): {
    prompt?: string;
    appendPrompt?: string;
};
