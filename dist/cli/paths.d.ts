/**
 * Get the OpenCode plugin config directory.
 *
 * Resolution order:
 * 1. OPENCODE_CONFIG_DIR (custom OpenCode directory)
 * 2. XDG_CONFIG_HOME/opencode
 * 3. ~/.config/opencode
 */
export declare function getConfigDir(): string;
/**
 * Get OpenCode config directories in read/search order.
 *
 * Resolution order:
 * 1. OPENCODE_CONFIG_DIR (if set)
 * 2. XDG_CONFIG_HOME/opencode or ~/.config/opencode
 *
 * Duplicate entries are removed.
 */
export declare function getConfigSearchDirs(): string[];
export declare function getOpenCodeConfigPaths(): string[];
export declare function getConfigJson(): string;
export declare function getConfigJsonc(): string;
export declare function getLiteConfig(): string;
export declare function getLiteConfigJsonc(): string;
export declare function getTuiConfig(): string;
export declare function getTuiConfigJsonc(): string;
export declare function getExistingLiteConfigPath(): string;
export declare function getExistingTuiConfigPath(): string;
export declare function getExistingConfigPath(): string;
export declare function ensureConfigDir(): void;
export declare function ensureTuiConfigDir(): void;
/**
 * Ensure the directory for OpenCode's main config file exists.
 */
export declare function ensureOpenCodeConfigDir(): void;
