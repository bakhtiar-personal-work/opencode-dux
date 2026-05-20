import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { SUBAGENT_NAMES } from '../config/constants';
import { log } from '../utils/logger';
import { getLocalDiscovery } from './local';

// ── MCP interfaces ───────────────────────────────────────────────────────────

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

// ── Cache ────────────────────────────────────────────────────────────────────

/** Maximum number of cache entries before LRU eviction kicks in. */
const CACHE_MAX_ENTRIES = 100;

/** Cache TTL in milliseconds for MCP results (24 hours). */
const MCP_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/** Directory for the discovery cache file. */
const CACHE_DIR = path.join(os.homedir(), '.config', 'opencode');

/** Cache file path. */
const CACHE_FILE = path.join(CACHE_DIR, 'discovery-cache.json');

/** Internal cache entry shape stored on disk. */
interface CacheEntry {
  /** Serialised output data (McpDiscoveryOutput). */
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
    log('[discovery/mcp-servers] failed to load cache file', String(err));
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
    log('[discovery/mcp-servers] failed to save cache file', String(err));
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

// ── MCP search query construction ───────────────────────────────────────────

/**
 * Build an array of MCP-focused search query strings from the task keywords
 * and agent name.
 *
 * Produces 2-4 queries depending on how many keywords are provided.
 */
function buildMcpSearchQueries(
  keywords: string[],
  agentName: string,
): string[] {
  const queries: string[] = [];

  for (const kw of keywords) {
    queries.push(`opencode MCP server ${kw}`);
    queries.push(`modelcontextprotocol ${kw}`);
  }

  // Add a general query scoped to the requesting agent
  queries.push(`opencode ${agentName} MCP`);

  return queries;
}

// ── NPM registry search ─────────────────────────────────────────────────────

/** URL of the npm registry search endpoint. */
const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';

/** npm search result item shape (subset of the API response). */
interface NpmSearchObject {
  package: {
    name: string;
    description?: string;
    keywords?: string[];
    version: string;
    links?: {
      npm?: string;
      homepage?: string;
      repository?: string;
    };
  };
  score: {
    final: number;
  };
}

/**
 * Known MCP package name substrings that identify an npm package
 * as an MCP server implementation.
 */
const KNOWN_MCP_NAMES = [
  'playwright',
  'puppeteer',
  'filesystem',
  'github',
  'postgres',
] as const;

/**
 * Search the npm registry for packages matching a query.
 *
 * Returns the raw search objects; the caller is responsible for filtering
 * and mapping to recommendations.
 */
async function searchNpm(
  query: string,
  size: number,
  signal?: AbortSignal,
): Promise<NpmSearchObject[]> {
  const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(query)}&size=${Math.min(size, 20)}`;
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/vnd.npm.install-v1+json',
        'User-Agent': 'opencode-dux/1.0',
      },
    });
    if (!res.ok) {
      log(
        `[discovery/mcp-servers] npm search failed (${res.status}) for query: ${query}`,
      );
      return [];
    }
    const body = (await res.json()) as {
      objects?: NpmSearchObject[];
    };
    return body.objects ?? [];
  } catch (err) {
    log('[discovery/mcp-servers] npm search error', String(err));
    return [];
  }
}

/**
 * Determine whether an npm package name looks like a verified MCP server.
 *
 * Only matches verified MCP patterns:
 * - `@modelcontextprotocol/server-*` namespace
 * - `@anthropic/mcp-server-*` namespace
 * - Known MCP package names (playwright, puppeteer, filesystem, github, postgres)
 */
function isMcpLike(pkg: NpmSearchObject): boolean {
  const name = pkg.package.name.toLowerCase();

  // Check known namespaces
  if (name.startsWith('@modelcontextprotocol/server-')) return true;
  if (name.startsWith('@anthropic/mcp-server-')) return true;

  // Check known MCP package names
  for (const known of KNOWN_MCP_NAMES) {
    if (name.includes(known)) return true;
  }

  return false;
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
    agents.push(...SUBAGENT_NAMES);
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

// ── MCP helpers ─────────────────────────────────────────────────────────────

/**
 * Extract a short server name from an MCP package name.
 *
 * Examples:
 * - `@modelcontextprotocol/server-playwright` → `playwright`
 * - `@anthropic/mcp-server-playwright` → `playwright`
 */
function extractMcpServerName(packageName: string): string {
  const lower = packageName.toLowerCase();
  if (lower.startsWith('@modelcontextprotocol/server-')) {
    return packageName.split('/')[1].replace('server-', '');
  }
  if (lower.startsWith('@anthropic/mcp-server-')) {
    return packageName.split('/')[1].replace('mcp-server-', '');
  }
  // For non-standard MCP package names, use the last path segment
  const last = packageName.split('/').pop() ?? packageName;
  // Strip common prefixes
  return last.replace(/^mcp-server-/, '').replace(/^server-/, '');
}

/**
 * Build a ready-to-use mcpServers JSON config block for an MCP package.
 *
 * Returns a JSON string like:
 * ```json
 * {"mcpServers": {"playwright": {"command": ["npx", "@modelcontextprotocol/server-playwright"]}}}
 * ```
 */
function buildMcpInstallCommand(packageName: string): string {
  const serverName = extractMcpServerName(packageName);
  const config = {
    mcpServers: {
      [serverName]: {
        command: ['npx', packageName],
      },
    },
  };
  return JSON.stringify(config);
}

/**
 * Derive a source URL from a package's npm metadata.
 */
function deriveSourceUrl(pkg: NpmSearchObject): string | undefined {
  const links = pkg.package.links;
  return links?.homepage ?? links?.repository ?? links?.npm;
}

/**
 * Mark and filter MCP recommendations against already-installed MCP servers.
 *
 * For recommendations matching an installed MCP:
 * - Mark them as `already_installed: true`
 * - Only include them if the relevance score is > 0.8 (significantly better
 *   than the installed default, meaning this MCP is highly relevant to the
 *   current task)
 *
 * Non-installed recommendations pass through unchanged.
 */
function filterExistingMcps(
  recommendations: McpRecommendation[],
  existingNames: string[] | undefined,
): McpRecommendation[] {
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

// ── discoverMcpServers ──────────────────────────────────────────────────────

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
export async function discoverMcpServers(
  input: McpDiscoveryInput,
  ctx: PluginInput,
): Promise<McpDiscoveryOutput> {
  const maxResults = input.max_results ?? 5;
  const queries = buildMcpSearchQueries(input.task_keywords, input.agent_name);

  // Auto-discover installed MCPs if caller didn't provide existing names
  let existingMcpNames = input.existing_mcp_names;
  if (!existingMcpNames || existingMcpNames.length === 0) {
    try {
      const local = await getLocalDiscovery(ctx);
      existingMcpNames = local.mcps.map((m) => m.name);
    } catch {
      // Best-effort – skip auto-discovery if SDK call fails
      existingMcpNames = [];
    }
  }
  const allRecommendations: McpRecommendation[] = [];
  const seenNames = new Set<string>();

  const concurrencyLimit = 3;
  const queryBatches: string[][] = [];
  for (let i = 0; i < queries.length; i += concurrencyLimit) {
    queryBatches.push(queries.slice(i, i + concurrencyLimit));
  }

  for (const batch of queryBatches) {
    const batchResults = await Promise.all(batch.map((q) => searchNpm(q, 5)));

    for (let i = 0; i < batch.length; i++) {
      const results = batchResults[i];

      for (const obj of results) {
        const pkgName = obj.package.name;

        if (seenNames.has(pkgName.toLowerCase())) continue;
        seenNames.add(pkgName.toLowerCase());

        // Only include verified MCP packages
        if (!isMcpLike(obj)) continue;

        const description = obj.package.description ?? '';
        const npmKeywords = obj.package.keywords;
        const tags = deriveTags(pkgName, description, npmKeywords);
        const recommendedAgents = deriveRecommendedAgents('mcp', tags);
        const relevanceScore = scoreRelevance(
          pkgName,
          description,
          tags,
          input.task_keywords,
          obj.score.final,
        );

        if (relevanceScore < 0.05) continue;

        allRecommendations.push({
          type: 'mcp',
          name: pkgName,
          description,
          install_command: buildMcpInstallCommand(pkgName),
          relevance_reason: buildRelevanceReason(
            pkgName,
            description,
            tags,
            input.task_keywords,
          ),
          relevance_score: relevanceScore,
          source_url: deriveSourceUrl(obj),
          recommended_agents: recommendedAgents,
          tags,
        });
      }
    }
  }

  const unique = deduplicateByName(allRecommendations);
  unique.sort((a, b) => b.relevance_score - a.relevance_score);

  const filtered = filterExistingMcps(unique, existingMcpNames);

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
export function createDiscoverMcpServersTool(ctx: PluginInput): ToolDefinition {
  const cache = loadCacheFile();
  const cachePrefix = 'mcp';

  return tool({
    description:
      'Search online for popular MCP (Model Context Protocol) servers ' +
      'that could be installed to help with a given task. ' +
      'Use this when a subagent lacks the capabilities it needs and you ' +
      'want to discover what external MCP servers are available. ' +
      'If existing_mcp_names is not provided, automatically discovers ' +
      "what's already installed and filters recommendations accordingly. " +
      'Already-installed MCPs are shown only when relevance_score > 0.8 ' +
      '(significantly better). ' +
      'Returns recommendations with ready-to-use mcpServers config blocks. ' +
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
          'Keywords characterising the task (used to build search queries)',
        ),
      agent_name: z
        .string()
        .describe('The subagent name requesting the discovery'),
      existing_mcp_names: z
        .array(z.string())
        .optional()
        .describe(
          'MCP server names already installed (to avoid duplicate recommendations). ' +
            'If not provided, auto-detects installed MCPs.',
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
      const existingNames = args.existing_mcp_names ?? undefined;
      const projectDir = toolCtx.directory || ctx.directory;

      const cacheKey = buildCacheKey(cachePrefix, taskKeywords, agentName);

      const cached = readFromCache<McpDiscoveryOutput>(cache, cacheKey);
      if (cached) {
        log('[discovery/mcp-servers] cache hit for', cacheKey);
        return JSON.stringify({
          ...cached,
          from_cache: true,
          recommendations: cached.recommendations.slice(0, maxResults),
        });
      }

      log(`[discovery/mcp-servers] cache miss for project: ${projectDir}`);

      const output = await discoverMcpServers(
        {
          task_description: args.task_description ?? '',
          task_keywords: taskKeywords,
          agent_name: agentName,
          existing_mcp_names: existingNames,
          max_results: maxResults,
        },
        ctx,
      );

      writeToCache(cache, cacheKey, output, MCP_CACHE_TTL_MS);

      return JSON.stringify(output);
    },
  });
}
