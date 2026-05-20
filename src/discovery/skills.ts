import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { log } from '../utils/logger';
import { getLocalDiscovery } from './local';

// ── Skill interfaces ────────────────────────────────────────────────────────

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

// ── Cache ────────────────────────────────────────────────────────────────────

/** Maximum number of cache entries before LRU eviction kicks in. */
const CACHE_MAX_ENTRIES = 100;

/** Cache TTL in milliseconds for skill results (7 days). */
const SKILL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

/** Directory for the discovery cache file. */
const CACHE_DIR = path.join(os.homedir(), '.config', 'opencode');

/** Cache file path. */
const CACHE_FILE = path.join(CACHE_DIR, 'discovery-cache.json');

/** Internal cache entry shape stored on disk. */
interface CacheEntry {
  /** Serialised output data (DiscoverSkillsOutput). */
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
 * Uses an MD5 hex digest of the concatenated keywords and agent name.
 * MD5 is sufficient for cache-key hashing (not security sensitive).
 */
function buildCacheKey(
  prefix: string,
  taskKeywords: string[],
  agentName: string,
): string {
  const raw = `${[...taskKeywords].sort().join(',')}|${agentName}`;
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

// ── Skill search query construction ─────────────────────────────────────────

/**
 * Build an array of skill-focused search query strings from the task keywords.
 *
 * Includes a query targeting the vercel-labs/skills repository and
 * general opencode skill queries.
 */
function buildSkillSearchQueries(
  keywords: string[],
  agentName: string,
): string[] {
  const queries: string[] = [];

  // Target the known skills repository
  queries.push('org:vercel-labs SKILL.md');

  // General opencode skill queries
  for (const kw of keywords) {
    queries.push(`opencode skill ${kw}`);
  }

  // Scoped to the requesting agent
  queries.push(`opencode ${agentName} skill`);

  return queries;
}

// ── GitHub search ───────────────────────────────────────────────────────────

/** Result item from the GitHub code search API. */
interface GitHubCodeSearchItem {
  name: string;
  path: string;
  html_url?: string;
  repository: {
    full_name: string;
    html_url: string;
    description?: string;
    default_branch?: string;
  };
}

/**
 * Search the GitHub code search API for skill-related results.
 *
 * Returns an empty array on failure (network, auth, rate-limit).
 */
async function searchGitHubCode(
  query: string,
  signal?: AbortSignal,
): Promise<GitHubCodeSearchItem[]> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'opencode-dux/1.0',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=5&sort=indexed`;
  try {
    const res = await fetch(url, { signal, headers });
    if (!res.ok) {
      log(
        `[discovery/skills] GitHub search failed (${res.status}) for query: ${query}`,
      );
      return [];
    }
    const body = (await res.json()) as {
      items?: GitHubCodeSearchItem[];
    };
    return body.items ?? [];
  } catch (err) {
    log('[discovery/skills] GitHub search error', String(err));
    return [];
  }
}

/**
 * Get the default-branch content of a file from a public GitHub repo.
 * Used to fetch SKILL.md files to extract skill metadata.
 */
interface GitHubContentItem {
  name: string;
  type: 'file' | 'dir';
  path: string;
  download_url?: string;
}

async function listGitHubRepoContents(
  owner: string,
  repo: string,
  path: string,
  signal?: AbortSignal,
): Promise<GitHubContentItem[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'opencode-dux/1.0',
      },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as GitHubContentItem[] | GitHubContentItem;
    return Array.isArray(body) ? body : [body];
  } catch {
    return [];
  }
}

async function fetchRawFile(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

// ── Relevance scoring ───────────────────────────────────────────────────────

/** Known MCP/skill keywords mapped to descriptive tags. */
const NAME_TAG_MAP: Record<string, string[]> = {
  playwright: ['browser', 'ui', 'testing'],
  github: ['github', 'git', 'version-control'],
  filesystem: ['filesystem', 'file-ops'],
  websearch: ['web', 'search', 'internet'],
  context7: ['docs', 'search', 'reference'],
  'grep-app': ['search', 'code', 'grep'],
  ast_grep: ['search', 'code', 'ast'],
  puppeteer: ['browser', 'ui', 'testing'],
  postgres: ['database', 'sql'],
  sqlite: ['database', 'sql', 'embedded'],
  redis: ['cache', 'database'],
  slack: ['communication', 'messaging'],
  discord: ['communication', 'messaging'],
  jira: ['project-management', 'issue-tracking'],
  linear: ['project-management', 'issue-tracking'],
  notion: ['docs', 'knowledge', 'wiki'],
  figma: ['design', 'ui', 'prototyping'],
  sentry: ['monitoring', 'error-tracking'],
  stripe: ['payments', 'billing'],
};

/**
 * Derive tags from a package name, description, and npm keywords.
 */
function deriveTags(
  name: string,
  _description: string,
  npmKeywords?: string[],
): string[] {
  const lower = name.toLowerCase();
  const tags: string[] = [];

  for (const [key, mapped] of Object.entries(NAME_TAG_MAP)) {
    if (lower.includes(key)) {
      tags.push(...mapped);
    }
  }

  if (npmKeywords) {
    for (const kw of npmKeywords) {
      const lowerKw = kw.toLowerCase().replace(/\s+/g, '-');
      if (!tags.includes(lowerKw)) {
        tags.push(lowerKw);
      }
    }
  }

  return [...new Set(tags)];
}

/**
 * Score how relevant a recommendation is to the task context.
 *
 * Examines keyword overlap, name-tag matches, and the npm score (when available)
 * to produce a value in the [0, 1] range.
 */
function scoreRelevance(
  name: string,
  description: string,
  tags: string[],
  keywords: string[],
  npmScore?: number,
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

  if (typeof npmScore === 'number' && npmScore > 0) {
    score += npmScore * 0.2;
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
 * Determine which agents would benefit most from an item based on its tags.
 */
function deriveRecommendedAgents(
  type: 'mcp' | 'skill',
  tags: string[],
): string[] {
  const agents: string[] = [];

  if (type === 'mcp') {
    // MCP path not used in skills module, but kept for type completeness
  }

  const tagSet = new Set(tags.map((t) => t.toLowerCase()));

  if (tagSet.has('browser') || tagSet.has('ui') || tagSet.has('testing')) {
    agents.push('explorer');
  }
  if (tagSet.has('search') || tagSet.has('docs') || tagSet.has('reference')) {
    agents.push('librarian');
  }
  if (tagSet.has('database') || tagSet.has('sql')) {
    agents.push('oracle');
  }
  if (tagSet.has('design') || tagSet.has('prototyping')) {
    agents.push('designer');
  }

  return [...new Set(agents)];
}

/**
 * Build a human-readable reason string explaining why a package is relevant.
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

// ── Skill helpers ───────────────────────────────────────────────────────────

/**
 * Mark and filter skill recommendations against already-installed skills.
 *
 * Same logic as MCP filtering:
 * - Matching items are marked `already_installed: true`
 * - Only included when relevance_score > 0.8
 * - Non-installed items pass through unchanged
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
      if (rec.already_installed) {
        return rec.relevance_score > 0.8;
      }
      return true;
    });
}

/**
 * Build an install command for an OpenCode skill.
 */
function buildSkillInstallCommand(sourceUrl: string, name: string): string {
  return `npx skills add ${sourceUrl} --skill ${name}`;
}

/**
 * Parse a SKILL.md front-matter or heading to extract a skill name and description.
 */
function parseSkillMd(
  content: string,
  defaultName: string,
): { name: string; description: string } {
  const lines = content.split('\n');
  let name = defaultName;
  let description = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Check for markdown heading (first # heading is usually the name)
    if (trimmed.startsWith('# ') && !name) {
      name = trimmed.replace(/^#\s+/, '').trim();
    }
    // Check for description after the heading
    if (name && !description && trimmed && !trimmed.startsWith('#')) {
      description = trimmed;
      break;
    }
  }

  return { name, description };
}

/**
 * Try to discover skills from the vercel-labs/skills repository by
 * listing its top-level directory and fetching SKILL.md files.
 */
async function discoverSkillsFromVercelLabs(
  _keywords: string[],
  signal?: AbortSignal,
): Promise<SkillRecommendation[]> {
  const items: SkillRecommendation[] = [];

  // List the top-level contents of vercel-labs/skills
  const contents = await listGitHubRepoContents(
    'vercel-labs',
    'skills',
    '',
    signal,
  );

  // Each subdirectory that contains a SKILL.md is a potential skill
  const dirs = contents.filter((c) => c.type === 'dir');
  const seenNames = new Set<string>();

  for (const dir of dirs.slice(0, 10)) {
    const subContents = await listGitHubRepoContents(
      'vercel-labs',
      'skills',
      dir.name,
      signal,
    );
    const skillMd = subContents.find(
      (c) => c.type === 'file' && c.name === 'SKILL.md',
    );
    if (!skillMd || !skillMd.download_url) continue;

    const raw = await fetchRawFile(skillMd.download_url, signal);
    if (!raw) continue;

    const { name, description } = parseSkillMd(raw, dir.name);
    if (seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const repoUrl = `https://github.com/vercel-labs/skills`;
    const tags = deriveTags(name, description);
    const relevanceScore = scoreRelevance(name, description, tags, _keywords);
    if (relevanceScore < 0.05) continue;

    items.push({
      type: 'skill',
      name,
      description,
      install_command: buildSkillInstallCommand(repoUrl, name),
      relevance_reason: buildRelevanceReason(
        name,
        description,
        tags,
        _keywords,
      ),
      relevance_score: relevanceScore,
      source_url: `${repoUrl}/tree/main/${dir.name}`,
      recommended_agents: deriveRecommendedAgents('skill', tags),
      tags,
    });
  }

  return items;
}

/**
 * Search GitHub broadly for opencode skill-related repositories.
 */
async function discoverSkillsFromGitHubSearch(
  keywords: string[],
  _agentName: string,
  signal?: AbortSignal,
): Promise<SkillRecommendation[]> {
  const queries = buildSkillSearchQueries(keywords, _agentName);
  const seenRepos = new Set<string>();
  const items: SkillRecommendation[] = [];

  const concurrencyLimit = 2;
  const queryBatches: string[][] = [];
  for (let i = 0; i < queries.length; i += concurrencyLimit) {
    queryBatches.push(queries.slice(i, i + concurrencyLimit));
  }

  for (const batch of queryBatches) {
    const batchResults = await Promise.all(
      batch.map((q) => searchGitHubCode(q, signal)),
    );

    for (const results of batchResults) {
      for (const result of results) {
        const repoFullName = result.repository.full_name;
        if (seenRepos.has(repoFullName)) continue;
        seenRepos.add(repoFullName);

        const name = repoFullName.split('/')[1] ?? repoFullName;
        const description = result.repository.description ?? '';
        const repoUrl = result.repository.html_url;

        // Only process results from repos other than vercel-labs/skills
        // (already handled by discoverSkillsFromVercelLabs)
        if (repoFullName === 'vercel-labs/skills') continue;

        const tags = deriveTags(name, description);
        const relevanceScore = scoreRelevance(
          name,
          description,
          tags,
          keywords,
        );
        if (relevanceScore < 0.05) continue;

        items.push({
          type: 'skill',
          name,
          description,
          install_command: buildSkillInstallCommand(repoUrl, name),
          relevance_reason: buildRelevanceReason(
            name,
            description,
            tags,
            keywords,
          ),
          relevance_score: relevanceScore,
          source_url: repoUrl,
          recommended_agents: deriveRecommendedAgents('skill', tags),
          tags,
        });
      }
    }
  }

  return items;
}

/**
 * Try to discover skills via the OpenCode SDK's skill endpoint.
 */
async function discoverSkillsFromSdk(
  _ctx: PluginInput,
  _keywords: string[],
  _signal?: AbortSignal,
): Promise<SkillRecommendation[]> {
  // Attempt to use the SDK's client.skill API if available.
  // This is a best-effort call; failures are silently ignored.
  try {
    const client = _ctx.client as unknown as Record<string, unknown>;
    const skillApi = client.skill as
      | {
          list?: (args: Record<string, unknown>) => Promise<{ data?: unknown }>;
        }
      | undefined;

    if (skillApi?.list) {
      const result = await skillApi.list({});
      const data = result.data as
        | Array<{
            name?: string;
            description?: string;
            source?: string;
            tags?: string[];
          }>
        | undefined;

      if (Array.isArray(data)) {
        return data
          .filter((s) => s.name)
          .map((s) => {
            const name = s.name ?? 'unknown';
            const description = s.description ?? '';
            const sourceUrl = s.source ?? `https://github.com/opencode/${name}`;
            const tags = (s.tags ?? []).filter(
              (t): t is string => typeof t === 'string',
            );
            const relevanceScore = scoreRelevance(
              name,
              description,
              tags,
              _keywords,
            );

            return {
              type: 'skill' as const,
              name,
              description,
              install_command: buildSkillInstallCommand(sourceUrl, name),
              relevance_reason: buildRelevanceReason(
                name,
                description,
                tags,
                _keywords,
              ),
              relevance_score: relevanceScore,
              source_url: sourceUrl,
              recommended_agents: deriveRecommendedAgents('skill', tags),
              tags,
            };
          })
          .filter((s) => s.relevance_score >= 0.05);
      }
    }
  } catch {
    // SDK endpoint not available - fall back to GitHub search only
  }

  return [];
}

// ── discoverSkills ─────────────────────────────────────────────────────────

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
export async function discoverSkills(
  input: DiscoverSkillsInput,
  ctx: PluginInput,
): Promise<DiscoverSkillsOutput> {
  const maxResults = input.max_results ?? 5;

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

  const queries = buildSkillSearchQueries(
    input.task_keywords,
    input.agent_name,
  );
  const allRecommendations: SkillRecommendation[] = [];
  const abortController = new AbortController();

  // Gather results from all sources in parallel
  const [vercelResults, gitHubResults, sdkResults] = await Promise.all([
    discoverSkillsFromVercelLabs(input.task_keywords, abortController.signal),
    discoverSkillsFromGitHubSearch(
      input.task_keywords,
      input.agent_name,
      abortController.signal,
    ),
    discoverSkillsFromSdk(ctx, input.task_keywords, abortController.signal),
  ]);

  // Merge and deduplicate
  const seen = new Set<string>();
  for (const rec of [...vercelResults, ...gitHubResults, ...sdkResults]) {
    const key = rec.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    allRecommendations.push(rec);
  }

  // Sort by relevance
  allRecommendations.sort((a, b) => b.relevance_score - a.relevance_score);

  // Filter out or mark already-installed skills
  const filtered = filterExistingSkills(allRecommendations, existingSkillNames);

  // Return top N
  const recommendations = filtered.slice(0, maxResults);

  return {
    recommendations,
    from_cache: false,
    queries_used: queries,
  };
}

// ── Tool factory ────────────────────────────────────────────────────────────

const z = tool.schema;

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
export function createDiscoverSkillsTool(ctx: PluginInput): ToolDefinition {
  const cache = loadCacheFile();
  const cachePrefix = 'skill';

  return tool({
    description:
      'Search online for OpenCode skills that could be installed to help ' +
      'with a given task. ' +
      'Use this when you want to discover installable skill packages for ' +
      'task-specific knowledge or workflows. ' +
      'If existing_skill_names is not provided, automatically discovers ' +
      "what's already installed and filters recommendations accordingly. " +
      'Already-installed skills are shown only when relevance_score > 0.8 ' +
      '(significantly better). ' +
      'Skills are knowledge and prompt resources (not tool/capability resources ' +
      'like MCP servers). ' +
      'Results are cached for 7 days.',
    args: {
      task_description: z
        .string()
        .describe(
          'Natural language description of the task the subagent needs help with',
        ),
      task_keywords: z
        .array(z.string())
        .describe(
          'Keywords characterising the task (used to build search queries)',
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
    execute: async (args, toolCtx) => {
      const taskKeywords = args.task_keywords ?? [];
      const agentName = args.agent_name ?? '';
      const maxResults = args.max_results ?? 5;
      const projectDir = toolCtx.directory || ctx.directory;

      const cacheKey = buildCacheKey(cachePrefix, taskKeywords, agentName);

      const cached = readFromCache<DiscoverSkillsOutput>(cache, cacheKey);
      if (cached) {
        log('[discovery/skills] cache hit for', cacheKey);
        return JSON.stringify({
          ...cached,
          from_cache: true,
          recommendations: cached.recommendations.slice(0, maxResults),
        });
      }

      log(`[discovery/skills] cache miss for project: ${projectDir}`);

      const output = await discoverSkills(
        {
          task_description: args.task_description ?? '',
          task_keywords: taskKeywords,
          agent_name: agentName,
          existing_skill_names: args.existing_skill_names ?? undefined,
          max_results: maxResults,
        },
        ctx,
      );

      writeToCache(cache, cacheKey, output, SKILL_CACHE_TTL_MS);

      return JSON.stringify(output);
    },
  });
}
