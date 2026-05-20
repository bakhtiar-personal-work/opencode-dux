import type { Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

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

// Module-level cache to avoid repeated filesystem scans
let skillsCache: SkillMetadata[] | null = null;
let cacheRoot: string | null = null;

/**
 * Reset the skill discovery cache (for testing).
 */
export function resetSkillsCache(): void {
  skillsCache = null;
  cacheRoot = null;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Supports simple key-value pairs and array values (both inline `[a, b]`
 * and multiline `- item` formats). Returns a partial record of parsed
 * values, ignoring unknown keys without error.
 */
function parseFrontmatter(content: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  // Match content between leading --- and trailing ---
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return result;

  const block = match[1];
  const lines = block.split('\n');

  let currentKey: string | null = null;
  const currentArray: string[] = [];

  for (const raw of lines) {
    const trimmed = raw.trim();

    // Skip empty lines
    if (trimmed === '') continue;

    // Array item under a key (- value)
    if (trimmed.startsWith('- ')) {
      if (currentKey) {
        currentArray.push(trimmed.slice(2).trim());
      }
      continue;
    }

    // If we were collecting an array, flush it
    if (currentKey && currentArray.length > 0) {
      result[currentKey] = [...currentArray];
      currentArray.length = 0;
    }

    // Key: value pair
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      currentKey = null;
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (!key) {
      currentKey = null;
      continue;
    }

    if (value === '') {
      // Multiline array follows
      currentKey = key;
      continue;
    }

    // Inline array: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      result[key] = inner
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      result[key] = value;
    }

    currentKey = null;
  }

  // Flush trailing array if any
  if (currentKey && currentArray.length > 0) {
    result[currentKey] = [...currentArray];
  }

  return result;
}

/**
 * Ensure a frontmatter field value is always a string array.
 */
function asStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * Scan the skills directory and return parsed skill metadata.
 * Results are cached to avoid repeated filesystem scans;
 * call {@link resetSkillsCache} to invalidate.
 *
 * Files with missing or invalid frontmatter are skipped with a warning.
 *
 * @param pluginRoot - Absolute path to the plugin root directory.
 */
export async function discoverSkills(
  pluginRoot: string,
): Promise<SkillMetadata[]> {
  const normalizedRoot = resolve(pluginRoot);

  // Return cached results for the same root
  if (skillsCache && cacheRoot === normalizedRoot) {
    return skillsCache;
  }

  const skillsDir = join(normalizedRoot, 'src', 'skills');
  const discovered: SkillMetadata[] = [];

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    // Skills directory does not exist - nothing to discover
    console.warn(`Skills directory not found: ${skillsDir}`);
    skillsCache = [];
    cacheRoot = normalizedRoot;
    return [];
  }

  for (const entry of entries) {
    const skillPath = join(skillsDir, entry);
    let entryStat: Stats;
    try {
      entryStat = await stat(skillPath);
    } catch {
      continue;
    }

    if (!entryStat.isDirectory()) continue;

    const skillMdPath = join(skillPath, 'SKILL.md');
    let skillMdStat: Stats;
    try {
      skillMdStat = await stat(skillMdPath);
    } catch {
      // No SKILL.md in this directory - skip silently
      continue;
    }

    if (!skillMdStat.isFile()) continue;

    let content: string;
    try {
      content = await readFile(skillMdPath, 'utf-8');
    } catch {
      console.warn(
        `Could not read skill file: ${relative(normalizedRoot, skillMdPath)}`,
      );
      continue;
    }

    const frontmatter = parseFrontmatter(content);
    const name =
      typeof frontmatter.name === 'string' ? frontmatter.name : entry;
    const description =
      typeof frontmatter.description === 'string'
        ? frontmatter.description
        : '';

    if (typeof name !== 'string') {
      console.warn(
        'Invalid frontmatter in ' +
          relative(normalizedRoot, skillMdPath) +
          ': name must be a string',
      );
      continue;
    }

    discovered.push({
      name,
      description,
      path: skillMdPath,
      tags: asStringArray(frontmatter.tags),
      recommendedAgents: asStringArray(frontmatter.recommendedAgents),
    });
  }

  skillsCache = discovered;
  cacheRoot = normalizedRoot;
  return discovered;
}
