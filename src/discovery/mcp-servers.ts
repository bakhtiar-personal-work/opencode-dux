import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { log } from '../utils/logger';
import { getLocalDiscovery } from './local';

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
   * JSON configuration block to paste into opencode.json `mcpServers` section.
   * This is NOT a shell command.
   * e.g. `{"mcpServers": {"playwright": {"command": ["npx", "@modelcontextprotocol/server-playwright"]}}}`.
   */
  config_block: string;
  /** Why this recommendation is relevant to the task. */
  relevance_reason: string;
  /** Relevance score from 0 (irrelevant) to 1 (perfect match). */
  relevance_score: number;
  /** URL to the project's homepage, repository, or package page. */
  source_url: string;

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

/**
 * Build an array of MCP-focused search query strings from the task keywords
 * and agent name.
 *
 * Produces 2-4 queries depending on how many keywords are provided.
 */
function buildMcpSearchQueries(
  keywords: string[],
  _agentName: string,
): string[] {
  const queries: string[] = [];

  for (const kw of keywords) {
    queries.push(`${kw} mcp-server`);
  }

  // Broad catch-all: discover MCP servers regardless of keyword specificity
  queries.push('mcp-server');

  return queries;
}

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
 * Determine whether an npm package looks like an MCP server using broad heuristics.
 *
 * Matches:
 * - Known official namespaces (`@modelcontextprotocol/server-*`, `@anthropic/mcp-server-*`)
 * - Name contains `mcp-server` or `server-mcp`
 * - Package declares MCP-related keywords (`mcp`, `modelcontextprotocol`, `claude`)
 * - Description mentions "model context protocol" or "mcp server"
 */
function isMcpLike(pkg: NpmSearchObject): boolean {
  const name = pkg.package.name.toLowerCase();
  const desc = (pkg.package.description ?? '').toLowerCase();
  const keywords = (pkg.package.keywords ?? []).map((k: string) =>
    k.toLowerCase(),
  );

  // 1. Known official namespaces
  if (name.startsWith('@modelcontextprotocol/server-')) return true;
  if (name.startsWith('@anthropic/mcp-server-')) return true;

  // 2. Broad heuristic: name contains mcp-server or server-mcp
  if (name.includes('mcp-server') || name.includes('server-mcp')) return true;

  // 3. Keyword check: package declares mcp-related keywords
  if (
    keywords.some(
      (k) => k === 'mcp' || k === 'modelcontextprotocol' || k === 'claude',
    )
  )
    return true;

  // 4. Description check: mentions MCP protocol
  if (desc.includes('model context protocol') || desc.includes('mcp server'))
    return true;

  return false;
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
    return `Matches keywords: ${matchedKeywords.join(', ')}; requires manual opencode.json configuration`;
  }
  return 'Found in search results for task context; requires manual opencode.json configuration';
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
function buildMcpConfigBlock(packageName: string): string {
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
 * Always returns a value - falls back to the npm package page.
 */
function deriveSourceUrl(pkg: NpmSearchObject): string {
  const links = pkg.package.links;
  return (
    links?.homepage ??
    links?.repository ??
    links?.npm ??
    `https://www.npmjs.com/package/${pkg.package.name}`
  );
}

/**
 * Mark and filter MCP recommendations against already-installed MCP servers.
 *
 * For recommendations matching an installed MCP:
 * - Mark them as `already_installed: true`
 *
 * Non-installed recommendations pass through unchanged.
 */
function filterExistingMcps(
  recommendations: McpRecommendation[],
  existingNames: string[] | undefined,
): McpRecommendation[] {
  if (!existingNames || existingNames.length === 0) return recommendations;

  const installed = new Set(existingNames.map((n) => n.toLowerCase()));

  return recommendations.map((rec) => {
    const lower = rec.name.toLowerCase();
    if (installed.has(lower)) {
      return { ...rec, already_installed: true };
    }
    return rec;
  });
}

/**
 * Score locally-installed MCP servers against task keywords and return
 * recommendations for those that meet the relevance threshold.
 */
function matchLocalMcps(
  mcps: Array<{ name: string; description?: string; tags?: string[] }>,
  taskKeywords: string[],
): McpRecommendation[] {
  const recommendations: McpRecommendation[] = [];

  for (const mcp of mcps) {
    const name = mcp.name;
    const description = mcp.description ?? '';
    const tags = mcp.tags ?? [];
    const relevanceScore = scoreRelevance(
      name,
      description,
      tags,
      taskKeywords,
    );

    if (relevanceScore < 0.05) continue;

    recommendations.push({
      type: 'mcp',
      name,
      description: description || 'No description available',
      config_block: buildMcpConfigBlock(name),
      relevance_reason: buildRelevanceReason(
        name,
        description,
        tags,
        taskKeywords,
      ),
      relevance_score: relevanceScore,
      source_url: '',
      already_installed: true,
    });
  }

  return recommendations;
}

/**
 * Run the full MCP discovery flow for a given set of inputs.
 *
 * 1. Builds search queries from keywords and agent name
 * 2. Searches the npm registry for matching MCP packages
 * 3. Maps results to recommendations with relevance scores
 * 4. Marks already-installed items with `already_installed: true`
 *    (they are always included, with the flag set)
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
  // Keep the full local MCP objects for scoring
  let localMcps: Array<{
    name: string;
    description?: string;
    tags?: string[];
  }> = [];
  if (!existingMcpNames || existingMcpNames.length === 0) {
    try {
      const local = await getLocalDiscovery(ctx);
      existingMcpNames = local.mcps.map((m) => m.name);
      localMcps = local.mcps;
    } catch {
      // Best-effort – skip auto-discovery if SDK call fails
      existingMcpNames = [];
    }
  }
  const allRecommendations: McpRecommendation[] = [];
  const seenNames = new Set<string>();

  // Score local MCPs first - skip online search if we have enough matches
  const localMatches = matchLocalMcps(localMcps, input.task_keywords);
  if (localMatches.length >= maxResults) {
    localMatches.sort((a, b) => b.relevance_score - a.relevance_score);
    return {
      recommendations: localMatches.slice(0, maxResults),
      from_cache: false,
      queries_used: [],
    };
  }

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
        const tags: string[] = [];
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
          config_block: buildMcpConfigBlock(pkgName),
          relevance_reason: buildRelevanceReason(
            pkgName,
            description,
            tags,
            input.task_keywords,
          ),
          relevance_score: relevanceScore,
          source_url: deriveSourceUrl(obj),
        });
      }
    }
  }

  // Merge local matches with online results, deduplicating against local
  const localByName = new Set(localMatches.map((r) => r.name.toLowerCase()));
  const merged = [...localMatches];
  for (const rec of allRecommendations) {
    const key = rec.name.toLowerCase();
    if (localByName.has(key)) continue; // skip online dupes of local items
    merged.push(rec);
  }
  const unique = deduplicateByName(merged);
  unique.sort((a, b) => b.relevance_score - a.relevance_score);
  const recommendations = unique.slice(0, maxResults);

  return {
    recommendations,
    from_cache: false,
    queries_used: queries,
  };
}

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
 * 5. Returns the top N recommendations with a config_block for manual setup in opencode.json
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
      'Discovers MCP (Model Context Protocol) servers that could help ' +
      'with a task. Checks locally installed MCPs first - if enough ' +
      'relevant servers are found locally, skips online search entirely. ' +
      'If local results are insufficient, supplements with online discovery ' +
      'from the npm registry. ' +
      'Use this when a subagent lacks the capabilities it needs and you ' +
      'want to discover what external MCP servers are available. ' +
      'If existing_mcp_names is not provided, automatically discovers ' +
      "what's already installed and filters recommendations accordingly. " +
      'Already-installed MCPs are marked with an `already_installed: true` flag. ' +
      'Returns recommendations with a config_block (JSON to paste into opencode.json `mcpServers` section). ' +
      'MCP servers require manual configuration in opencode.json (paste the config_block). ' +
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
