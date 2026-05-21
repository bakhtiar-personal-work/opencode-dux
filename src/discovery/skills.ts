import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { log } from '../utils/logger';
import { getLocalDiscovery } from './local';

// ── Skill interfaces ──────────────────────────────────────────────────────────

/**
 * Input parameters for discovering skills online.
 */
export interface SkillDiscoveryInput {
  /** Natural-language description of the task at hand. */
  task_description: string;
  /** Keywords that characterise the task (used for search queries). */
  task_keywords: string[];
  /** The subagent that initiated the discovery request. */
  agent_name: string;
  /**
   * Skill names already known to be installed.
   * Recommendations that match by name will be filtered out.
   */
  existing_skill_names?: string[];
  /** Maximum number of recommendations to return (default: 5). */
  max_results?: number;
}

/**
 * A single recommendation for an installable skill.
 */
export interface SkillRecommendation {
  type: 'skill';
  /** Canonical name (e.g. 'react-component-generator'). */
  name: string;
  /** Human-readable summary of what the skill provides. */
  description: string;
  /**
   * Install command for the user to run, e.g.
   * `npx skills add owner/repo@skill-name -g`.
   */
  install_command: string;
  /** Why this recommendation is relevant to the task. */
  relevance_reason: string;
  /** Relevance score from 0 (irrelevant) to 1 (perfect match). */
  relevance_score: number;
  /** URL to the project's homepage or repository. */
  source_url?: string;

  /** Whether the user already has this skill installed. */
  already_installed?: boolean;
}

/**
 * The complete output of a skill discovery request.
 */
export interface SkillDiscoveryOutput {
  /** Ordered list of recommendations, highest relevance first. */
  recommendations: SkillRecommendation[];
  /** Whether the result was served from cache. */
  from_cache: boolean;
  /** The search queries that were executed. */
  queries_used: string[];
}

// ── Cache ─────────────────────────────────────────────────────────────────────

/** Maximum number of cache entries before LRU eviction kicks in. */
const CACHE_MAX_ENTRIES = 100;

/** Cache TTL in milliseconds for skill results (24 hours). */
const SKILL_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/** Directory for the discovery cache file. */
const CACHE_DIR = path.join(os.homedir(), '.config', 'opencode');

/** Cache file path (shared with MCP discovery). */
const CACHE_FILE = path.join(CACHE_DIR, 'discovery-cache.json');

/** Internal cache entry shape stored on disk. */
interface CacheEntry {
  /** Serialised output data (SkillDiscoveryOutput). */
  data: string;
  /** Unix timestamp (ms) when this entry was written. */
  timestamp: number;
  /**
   * Access-order key for LRU eviction.
   * Lower values are older; bumped to `++nextAccessOrder` on read/write.
   */
  accessOrder: number;
  /** Cache TTL for this entry (ms), set at write time. */
  ttl: number;
}

/** Module-level monotonic access-order counter for LRU tracking. */
let nextAccessOrder = 0;

/**
 * Load and parse the on-disk cache file.
 */
function loadCacheFile(): Map<string, CacheEntry> {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return new Map();
    }
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const parsed: Record<string, CacheEntry> = JSON.parse(raw) ?? {};
    const map = new Map<string, CacheEntry>();
    for (const [key, entry] of Object.entries(parsed)) {
      map.set(key, entry);
    }
    return map;
  } catch (err) {
    log('[discovery/skills] failed to load cache file', String(err));
    return new Map();
  }
}

/**
 * Persist the cache map to disk.
 */
function saveCacheFile(cache: Map<string, CacheEntry>): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const obj: Record<string, CacheEntry> = {};
    for (const [key, entry] of cache) {
      obj[key] = entry;
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    log('[discovery/skills] failed to save cache file', String(err));
  }
}

/**
 * Perform LRU eviction on the cache map when it exceeds {@link CACHE_MAX_ENTRIES}.
 */
function evictLru(cache: Map<string, CacheEntry>): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;

  const sorted = [...cache.entries()].sort(
    ([, a], [, b]) => a.accessOrder - b.accessOrder,
  );
  const toRemove = sorted.slice(0, sorted.length - CACHE_MAX_ENTRIES);
  for (const [key] of toRemove) {
    cache.delete(key);
  }
}

/**
 * Build a cache key from a namespace prefix and the search-relevant input fields.
 *
 * Uses an MD5 hex digest of the concatenated keywords.
 * MD5 is sufficient for cache-key hashing (not security sensitive).
 */
function buildCacheKey(prefix: string, taskKeywords: string[]): string {
  const raw = [...taskKeywords].sort().join(',');
  const hash = createHash('md5').update(raw, 'utf-8').digest('hex');
  return `${prefix}:${hash}`;
}

/**
 * Try to read a valid, non-expired entry from the cache.
 *
 * Returns the data and marks the entry as recently accessed when found.
 */
function readFromCache<T>(
  cache: Map<string, CacheEntry>,
  key: string,
): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > entry.ttl) {
    cache.delete(key);
    return null;
  }

  // Bump access order
  entry.accessOrder = ++nextAccessOrder;
  try {
    return JSON.parse(entry.data) as T;
  } catch {
    cache.delete(key);
    return null;
  }
}

/**
 * Write a result to the in-memory cache and persist to disk.
 */
function writeToCache<T>(
  cache: Map<string, CacheEntry>,
  key: string,
  data: T,
  ttl: number,
): void {
  cache.set(key, {
    data: JSON.stringify(data),
    timestamp: Date.now(),
    accessOrder: ++nextAccessOrder,
    ttl,
  });
  evictLru(cache);
  saveCacheFile(cache);
}

// ── CLI execution ─────────────────────────────────────────────────────────────

/**
 * Run `npx skills find` for the given keywords and return the raw stdout.
 *
 * Tries JSON output mode first (`--json`), then falls back to plain text.
 * Returns an empty string when neither mode succeeds.
 *
 * @param keywords - Search keywords
 * @param timeoutMs - Timeout in milliseconds for the exec call
 * @returns Raw stdout from the CLI, or empty string on failure
 */
function runSkillsFindCli(keywords: string[], timeoutMs = 30_000): string {
  const query = keywords.join(' ');
  const errors: string[] = [];

  // Try JSON mode first (most reliable for parsing)
  for (const cmd of [
    `npx skills find "${query}" --json 2>nul`,
    `npx skills find "${query}" 2>nul`,
  ]) {
    try {
      const stdout = execSync(cmd, {
        timeout: timeoutMs,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      if (stdout.trim()) {
        return stdout.trim();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
    }
  }

  if (errors.length > 0) {
    log(
      '[discovery/skills] all npx skills find attempts failed',
      errors.join('; '),
    );
  }
  return '';
}

// ── Output parsing ───────────────────────────────────────────────────────────

/**
 * Try to parse the CLI output as a JSON array of skill objects.
 *
 * Expected JSON format from `--json` flag:
 * ```json
 * [
 *   {
 *     "name": "skill-name",
 *     "description": "What the skill does",
 *     "source": "owner/repo@skill-name"
 *   }
 * ]
 * ```
 *
 * Also handles `{ "skills": [...] }` wrapper format.
 */
function tryParseJsonSkills(raw: string): Array<{
  name: string;
  description?: string;
  source?: string;
  installs?: number;
}> | null {
  try {
    const parsed = JSON.parse(raw);

    // Handle array format directly
    if (Array.isArray(parsed)) {
      return parsed;
    }

    // Handle wrapper object format
    if (parsed && typeof parsed === 'object') {
      const skills =
        (parsed as Record<string, unknown>).skills ??
        (parsed as Record<string, unknown>).results;

      if (Array.isArray(skills)) {
        return skills;
      }
    }
  } catch {
    // Not JSON – fall through to text parsing
  }

  return null;
}

/**
 * Regex patterns used to parse text-format `npx skills find` output.
 *
 * Matches lines like:
 * - `• skill-name Description text`
 * - `1. skill-name - Description text`
 * - `skill-name - Description text`
 * - `npx skills add owner/repo@skill -g`
 */
const SKILL_BULLET_RE = /^[•\-*\d.\s]+(\S[\w-]*)\s*[-–:]\s*(.+)$/im;

const SKILL_INSTALL_RE = /npx\s+skills\s+add\s+(\S+?)(?:\s+-g\s*)?$/im;

const SKILL_NAME_RE = /^[•\-*\d.\s]*(\S[\w-]*)$/im;

/**
 * Parse plain-text output from `npx skills find` into skill entries.
 *
 * Handles common output formats:
 * ```text
 * Found 3 skills:
 *
 * • react-component - Generate React components
 *   npx skills add owner/repo@react-component -g
 *
 * 1. testing-utils - Testing utilities for web apps
 *    Install: npx skills add owner/repo@testing-utils -g
 * ```
 *
 * @param raw - Raw text output to parse
 * @returns Parsed skill entries (may be empty)
 */
function parseTextSkills(raw: string): Array<{
  name: string;
  description: string;
  install_command: string;
}> {
  const results: Array<{
    name: string;
    description: string;
    install_command: string;
  }> = [];

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let currentName = '';
  let currentDesc = '';
  let currentInstall = '';

  for (const line of lines) {
    // Skip header lines
    if (
      /^(found|searching|looking|matching)/i.test(line) ||
      /^-{3,}$/.test(line)
    ) {
      continue;
    }

    // Check if this line contains an install command
    const installMatch = line.match(SKILL_INSTALL_RE);
    if (installMatch) {
      currentInstall = `npx skills add ${installMatch[1]} -g`;
      // If we have a pending entry, finalize it
      if (currentName) {
        results.push({
          name: currentName,
          description: currentDesc || 'No description available',
          install_command: currentInstall,
        });
        currentName = '';
        currentDesc = '';
        currentInstall = '';
      }
      continue;
    }

    // Check if this line starts a new skill entry (bullet or numbered)
    const bulletMatch = line.match(SKILL_BULLET_RE);
    if (bulletMatch) {
      // Save previous entry if any
      if (currentName) {
        results.push({
          name: currentName,
          description: currentDesc || 'No description available',
          install_command: currentInstall || `npx skills add ${currentName} -g`,
        });
      }
      currentName = bulletMatch[1];
      currentDesc = bulletMatch[2];
      currentInstall = '';
      continue;
    }

    // Check if line is just a name (followed by description on next lines)
    const nameMatch = line.match(SKILL_NAME_RE);
    if (nameMatch && !currentName) {
      // Only start a new entry if we don't have one in progress
      currentName = nameMatch[1];
      currentDesc = '';
      currentInstall = '';
      continue;
    }

    // If we have a current name and this looks like a description, append it
    if (
      currentName &&
      !currentInstall &&
      !results.some((r) => r.name === currentName)
    ) {
      if (currentDesc) {
        currentDesc += ' ' + line;
      } else {
        currentDesc = line;
      }
    }
  }

  // Flush last entry
  if (currentName) {
    results.push({
      name: currentName,
      description: currentDesc || 'No description available',
      install_command: currentInstall || `npx skills add ${currentName} -g`,
    });
  }

  return results;
}

/**
 * Extract a short skill name from an install source string.
 *
 * Examples:
 * - `owner/repo@skill-name` → `skill-name`
 * - `vercel-labs/skills@react-component` → `react-component`
 */
function extractSkillName(source: string): string {
  // If source contains @, take the part after @
  const atIdx = source.lastIndexOf('@');
  if (atIdx >= 0 && atIdx < source.length - 1) {
    return source.slice(atIdx + 1);
  }
  // Otherwise take the last segment after /
  const slashIdx = source.lastIndexOf('/');
  if (slashIdx >= 0 && slashIdx < source.length - 1) {
    return source.slice(slashIdx + 1);
  }
  return source;
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

/**
 * Derive tags from a skill name and description.
 *
 * Tag derivation has been removed; always returns an empty array.
 * The orchestrator decides tags dynamically from skill names.
 *
 * @returns Empty array
 */
function deriveTags(_name: string, _description: string): string[] {
  return [];
}

/**
 * Score how relevant a recommendation is to the task context.
 *
 * Examines keyword overlap, name-tag matches to produce a value in the [0, 1] range.
 */
function scoreRelevance(
  name: string,
  description: string,
  tags: string[],
  keywords: string[],
): number {
  let score = 0;

  const nameLower = name.toLowerCase();
  const descLower = description.toLowerCase();
  const tagsLower = tags.map((t) => t.toLowerCase());
  const allText = `${nameLower} ${descLower} ${tagsLower.join(' ')}`;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (nameLower.includes(kwLower)) {
      score += 0.35;
    }
    if (descLower.includes(kwLower)) {
      score += 0.2;
    }
    if (tagsLower.includes(kwLower)) {
      score += 0.15;
    }
  }

  const matchedKeywords = keywords.filter((kw) =>
    allText.includes(kw.toLowerCase()),
  ).length;
  if (keywords.length > 0) {
    score += (matchedKeywords / keywords.length) * 0.1;
  }

  return Math.min(score, 1);
}

/**
 * Build a human-readable reason string explaining why a skill is relevant.
 */
function buildRelevanceReason(
  name: string,
  description: string,
  tags: string[],
  keywords: string[],
): string {
  const matchedKeywords = keywords.filter(
    (kw) =>
      name.toLowerCase().includes(kw.toLowerCase()) ||
      description.toLowerCase().includes(kw.toLowerCase()) ||
      tags.some((t) => t.includes(kw.toLowerCase())),
  );

  if (matchedKeywords.length > 0) {
    return `Matches keywords: ${matchedKeywords.join(', ')}`;
  }
  return 'Found in search results for task context';
}

/**
 * Determine which agents would benefit most from a skill based on its tags.
 *
 * Agent recommendation has been removed; always returns an empty array.
 * The orchestrator decides which agent to delegate to.
 *
 * @returns Empty array
 */
function deriveRecommendedAgents(_tags: string[]): string[] {
  return [];
}

/**
 * Deduplicate recommendations by case-insensitive name, keeping the one with
 * the higher relevance score.
 */
function deduplicateByName<T extends { name: string; relevance_score: number }>(
  items: T[],
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    const existing = map.get(key);
    if (!existing || item.relevance_score > existing.relevance_score) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

// ── Filtering ─────────────────────────────────────────────────────────────────

/**
 * Mark and filter skill recommendations against already-installed skills.
 *
 * For recommendations matching an installed skill:
 * - Mark them as `already_installed: true`
 * - Only include them if the relevance score is > 0.8 (significantly better
 *   than the installed default, meaning this skill is highly relevant to the
 *   current task)
 *
 * Non-installed recommendations pass through unchanged.
 */
function filterExistingSkills(
  recommendations: SkillRecommendation[],
  existingNames: string[] | undefined,
): SkillRecommendation[] {
  if (!existingNames || existingNames.length === 0) return recommendations;

  const installed = new Set(existingNames.map((n) => n.toLowerCase()));

  return recommendations
    .map((rec) => {
      const lower = rec.name.toLowerCase();
      if (installed.has(lower)) {
        return { ...rec, already_installed: true };
      }
      return rec;
    })
    .filter((rec) => {
      // For already-installed items, only show if relevance_score > 0.8
      // (significantly better enough to mention despite being installed)
      if (rec.already_installed) {
        return rec.relevance_score > 0.8;
      }
      return true;
    });
}

// ── discoverSkillsOnline ──────────────────────────────────────────────────────

/**
 * Run the full skill discovery flow for a given set of inputs.
 *
 * 1. Builds search queries from keywords
 * 2. Executes `npx skills find` CLI for each query
 * 3. Parses CLI output (JSON preferred, text fallback)
 * 4. Maps results to recommendations with relevance scores
 * 5. Marks already-installed items with `already_installed: true`
 * 6. Returns the top N results
 *
 * Results are cached on disk for 24 hours.
 */
export async function discoverSkillsOnline(
  input: SkillDiscoveryInput,
  ctx: PluginInput,
): Promise<SkillDiscoveryOutput> {
  const maxResults = input.max_results ?? 5;
  const queries = input.task_keywords.map((kw) => `skill query: ${kw}`);

  // Auto-discover installed skills if caller didn't provide existing names
  let existingSkillNames = input.existing_skill_names;
  if (!existingSkillNames || existingSkillNames.length === 0) {
    try {
      const local = await getLocalDiscovery(ctx);
      existingSkillNames = local.skills.map((s) => s.name);
    } catch {
      // Best-effort – skip auto-discovery if SDK call fails
      existingSkillNames = [];
    }
  }

  const allRecommendations: SkillRecommendation[] = [];
  const seenNames = new Set<string>();

  for (const query of input.task_keywords) {
    const rawOutput = runSkillsFindCli([query]);
    if (!rawOutput) continue;

    // Try JSON parsing first
    const jsonSkills = tryParseJsonSkills(rawOutput);
    if (jsonSkills) {
      for (const skill of jsonSkills) {
        const skillName = skill.name || extractSkillName(skill.source ?? '');
        if (!skillName) continue;

        if (seenNames.has(skillName.toLowerCase())) continue;
        seenNames.add(skillName.toLowerCase());

        const description = skill.description ?? 'No description available';
        const source = skill.source ?? skillName;
        const tags = deriveTags(skillName, description);
        const relevanceScore = scoreRelevance(
          skillName,
          description,
          tags,
          input.task_keywords,
        );

        if (relevanceScore < 0.05) continue;

        allRecommendations.push({
          type: 'skill',
          name: skillName,
          description,
          install_command: `npx skills add ${source} -g`,
          relevance_reason: buildRelevanceReason(
            skillName,
            description,
            tags,
            input.task_keywords,
          ),
          relevance_score: relevanceScore,
        });
      }
    } else {
      // Fall back to text parsing
      const textSkills = parseTextSkills(rawOutput);
      for (const skill of textSkills) {
        if (seenNames.has(skill.name.toLowerCase())) continue;
        seenNames.add(skill.name.toLowerCase());

        const tags = deriveTags(skill.name, skill.description);
        const relevanceScore = scoreRelevance(
          skill.name,
          skill.description,
          tags,
          input.task_keywords,
        );

        if (relevanceScore < 0.05) continue;

        allRecommendations.push({
          type: 'skill',
          name: skill.name,
          description: skill.description,
          install_command: skill.install_command,
          relevance_reason: buildRelevanceReason(
            skill.name,
            skill.description,
            tags,
            input.task_keywords,
          ),
          relevance_score: relevanceScore,
        });
      }
    }
  }

  const unique = deduplicateByName(allRecommendations);
  unique.sort((a, b) => b.relevance_score - a.relevance_score);

  const filtered = filterExistingSkills(unique, existingSkillNames);
  const recommendations = filtered.slice(0, maxResults);

  return {
    recommendations,
    from_cache: false,
    queries_used: queries,
  };
}

// ── Tool factory ──────────────────────────────────────────────────────────────

const z = tool.schema;

/**
 * Create the `discover_skills` tool that orchestrators can call to find
 * installable skills for a given task.
 *
 * The tool:
 * 1. Executes `npx skills find <keywords>` for each keyword
 * 2. Parses output (prefers JSON, falls back to text)
 * 3. Scores each result by relevance (0-1)
 * 4. Checks which skills are already installed locally
 * 5. Returns the top N recommendations with install commands
 *
 * Results are cached on disk at `~/.config/opencode/discovery-cache.json`
 * with a 24-hour TTL and LRU eviction (max 100 entries).
 *
 * @param ctx - The OpenCode plugin input (provides client for SDK access)
 * @returns A `ToolDefinition` ready for registration in the plugin's tool hook
 */
export function createDiscoverSkillsTool(
  ctx: PluginInput,
): ToolDefinition {
  const cache = loadCacheFile();
  const cachePrefix = 'skill';

  return tool({
    description:
      'Search online for skills that could be installed to help with a ' +
      'given task. Skills provide specialized instructions and workflows ' +
      'for specific tasks (testing, deployment, accessibility audits, etc.). ' +
      'Use this when a subagent lacks specialized knowledge or workflows ' +
      'and you want to discover what skills are available. ' +
      'If existing_skill_names is not provided, automatically discovers ' +
      "what's already installed and filters recommendations accordingly. " +
      'Already-installed skills are shown only when relevance_score > 0.8 ' +
      '(significantly better). ' +
      'Returns recommendations with install commands (npx skills add ...). ' +
      'Results are cached for 24 hours.',
    args: {
      task_description: z
        .string()
        .describe(
          'Natural language description of the task the subagent needs help with',
        ),
      task_keywords: z
        .array(z.string())
        .describe(
          'Keywords characterising the task (used to search for skills)',
        ),
      agent_name: z
        .string()
        .describe('The subagent name requesting the discovery'),
      existing_skill_names: z
        .array(z.string())
        .optional()
        .describe(
          'Skill names already installed (to avoid duplicate recommendations). ' +
            'If not provided, auto-detects installed skills.',
        ),
      max_results: z
        .number()
        .min(1)
        .max(20)
        .default(5)
        .describe('Maximum number of recommendations to return'),
    },
    execute: async (args, _toolCtx) => {
      const taskKeywords = args.task_keywords ?? [];
      const maxResults = args.max_results ?? 5;
      const existingNames = args.existing_skill_names ?? undefined;

      const cacheKey = buildCacheKey(cachePrefix, taskKeywords);

      const cached = readFromCache<SkillDiscoveryOutput>(cache, cacheKey);
      if (cached) {
        log('[discovery/skills] cache hit for', cacheKey);
        return JSON.stringify({
          ...cached,
          from_cache: true,
          recommendations: cached.recommendations.slice(0, maxResults),
        });
      }

      log('[discovery/skills] cache miss');

      const output = await discoverSkillsOnline(
        {
          task_description: args.task_description ?? '',
          task_keywords: taskKeywords,
          agent_name: args.agent_name ?? '',
          existing_skill_names: existingNames,
          max_results: maxResults,
        },
        ctx,
      );

      writeToCache(cache, cacheKey, output, SKILL_CACHE_TTL_MS);

      return JSON.stringify(output);
    },
  });
}
