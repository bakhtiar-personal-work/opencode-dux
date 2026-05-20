/**
 * Metadata for a discovered skill.
 */
export interface SkillMetadata {
    /** Unique skill name (derived from folder name) */
    name: string;
    /** Human-readable description */
    description: string;
    /** Absolute path to the SKILL.md file */
    path: string;
    /** Tags for categorisation and matching */
    tags: string[];
    /** Agents that are recommended to use this skill */
    recommendedAgents: string[];
}
/**
 * Reset the skill discovery cache (for testing).
 */
export declare function resetSkillsCache(): void;
/**
 * Scan the skills directory and return parsed skill metadata.
 * Results are cached to avoid repeated filesystem scans;
 * call {@link resetSkillsCache} to invalidate.
 *
 * Files with missing or invalid frontmatter are skipped with a warning.
 *
 * @param pluginRoot - Absolute path to the plugin root directory.
 */
export declare function discoverSkills(pluginRoot: string): Promise<SkillMetadata[]>;
