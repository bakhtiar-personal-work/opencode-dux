import type { PluginInput } from '@opencode-ai/plugin';
import { log } from '../utils/logger';
import { SDK_DISCOVERY_TIMEOUT_MS } from '../config/constants';

/**
 * A single MCP server discovered via the OpenCode SDK.
 */
export interface DiscoveredMcp {
  /** Unique name used as the config key (e.g., 'playwright', 'github'). */
  name: string;
  /** Current connection status reported by OpenCode. */
  status:
    | 'connected'
    | 'disabled'
    | 'failed'
    | 'needs_auth'
    | 'needs_client_registration';
  /** Human-readable description, may include error details when status is 'failed'. */
  description?: string;
  /** Categorization tags derived from the MCP name. */
  tags: string[];
  /** Agents that benefit most from this MCP based on defaults. */
  recommendedAgents: string[];
}

/**
 * A single skill discovered via the OpenCode SDK.
 */
export interface DiscoveredSkill {
  /** Unique skill name. */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Filesystem location of the skill (SKILL.md path). */
  location: string;
  /** Categorization tags derived from the skill name. */
  tags: string[];
  /** Agents that benefit most from this skill based on defaults. */
  recommendedAgents: string[];
  /** Whether the skill ships with the plugin or was added by the user. */
  source: 'bundled' | 'user';
}

/**
 * Complete result of an SDK-based local discovery scan.
 */
export interface LocalDiscoveryResult {
  /** Discovered skills. */
  skills: DiscoveredSkill[];
  /** Discovered MCP servers. */
  mcps: DiscoveredMcp[];
  /** Unix timestamp (ms) when the scan was performed. */
  scannedAt: number;
  /** How long the scan took in milliseconds. */
  scanDurationMs: number;
}

// ── Tag derivation ──────────────────────────────────────────────────────────

/**
 * Known MCP/skill name patterns mapped to tags.
 * Used to derive tags from names dynamically at scan time.
 */
const NAME_TAG_MAP: Record<string, string[]> = {
  playwright: ['browser', 'ui', 'testing'],
  github: ['github', 'git'],
  filesystem: ['filesystem', 'files'],
  websearch: ['web', 'search'],
  context7: ['docs', 'search'],
  grep_app: ['search', 'code'],
  ast_grep: ['search', 'code'],
};

/**
 * Derive tags from a name string (MCP or skill name).
 *
 * Checks known patterns in a case-insensitive manner and returns the first
 * matching tag set. Falls back to an empty array when no pattern matches.
 *
 * @param name - The MCP or skill name to derive tags from
 * @returns Array of tag strings
 */
function deriveTags(name: string): string[] {
  const lower = name.toLowerCase();
  for (const [key, tags] of Object.entries(NAME_TAG_MAP)) {
    if (lower.includes(key)) {
      return [...tags];
    }
  }
  return [];
}

// ── Recommended agents derivation ───────────────────────────────────────────

/**
 * Derive recommended agent names for a given MCP or skill name.
 *
 * Agent-MCP recommendations have been removed; always returns an empty
 * array. MCPs are auto-managed by the plugin with no user config control.
 *
 * @returns Empty array
 */
function deriveRecommendedAgents(_name: string): string[] {
  return [];
}

// ── Skill source determination ──────────────────────────────────────────────

/**
 * Determine whether a skill is bundled or user-added based on its location.
 *
 * Skills located within the plugin's own `src/skills` directory are considered
 * bundled; all others are treated as user-added.
 *
 * @param location - The filesystem location of the skill
 * @returns `'bundled'` if the skill ships with the plugin, `'user'` otherwise
 */
function determineSource(location: string): 'bundled' | 'user' {
  // Normalise path separators before checking
  const normalised = location.replace(/\\/g, '/');
  return normalised.includes('src/skills') ? 'bundled' : 'user';
}

// ── Timeout helper ──────────────────────────────────────────────────────────

/**
 * Race a promise against a configurable timeout.
 * If the timeout fires first, the returned promise rejects with an error
 * that includes the label, giving downstream try/catch a clear indication
 * of which SDK call hung.
 *
 * @param promise - The async operation to protect
 * @param ms - Timeout in milliseconds
 * @param label - Human-readable label for error messages
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ── Internal SDK call helpers ───────────────────────────────────────────────

/**
 * Scan MCP servers via `ctx.client.mcp.status()`.
 *
 * Maps each entry's status value from the SDK's format to the
 * `DiscoveredMcp.status` union, derives tags and recommended agents from
 * the server name.
 *
 * @param ctx - OpenCode plugin input
 * @returns Array of discovered MCPs (empty on failure)
 */
async function scanMcpStatuses(ctx: PluginInput): Promise<DiscoveredMcp[]> {
  const response = await withTimeout(
    ctx.client.mcp.status(),
    SDK_DISCOVERY_TIMEOUT_MS,
    'MCP status scan',
  );
  // McpStatusResponses returns { [key: string]: McpStatus } inside `data`
  const data = response.data as
    | Record<string, { status: string; error?: string }>
    | undefined;

  if (!data) {
    return [];
  }

  return Object.entries(data).map(([name, statusInfo]) => ({
    name,
    status: statusInfo.status as DiscoveredMcp['status'],
    description: statusInfo.error,
    tags: deriveTags(name),
    recommendedAgents: deriveRecommendedAgents(name),
  }));
}

/**
 * Scan skills via `ctx.client.instance.skill()`.
 *
 * Uses a type-asserted call because `instance.skill()` may not be reflected
 * in the published SDK type definitions yet. Returns an empty array when the
 * method is unavailable or the call fails.
 *
 * @param ctx - OpenCode plugin input
 * @returns Array of discovered skills (empty on failure)
 */
async function scanInstanceSkills(
  ctx: PluginInput,
): Promise<DiscoveredSkill[]> {
  const skillFn = (
    ctx.client.instance as unknown as {
      skill?: (opts?: Record<string, unknown>) => Promise<{
        data?: Array<{
          name: string;
          description?: string;
          location: string;
        }>;
      }>;
    }
  ).skill;

  if (typeof skillFn !== 'function') {
    log(
      '[discovery] ctx.client.instance.skill() is not available, returning empty skills',
    );
    return [];
  }

  const response = await withTimeout(
    skillFn(),
    SDK_DISCOVERY_TIMEOUT_MS,
    'Instance skill scan',
  );
  const items = Array.isArray(response?.data) ? response.data : [];

  return items.map((s) => ({
    name: s.name,
    description: s.description,
    location: s.location,
    tags: deriveTags(s.name),
    recommendedAgents: deriveRecommendedAgents(s.name),
    source: determineSource(s.location),
  }));
}

// ── Cache ───────────────────────────────────────────────────────────────────

/** Internal cache entry for a completed scan result. */
interface CacheEntry {
  result: LocalDiscoveryResult;
  timestamp: number;
}

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1_000;

/** Module-level scan result cache. */
let cache: CacheEntry | null = null;

// ── Exported API ────────────────────────────────────────────────────────────

/**
 * Scan locally configured MCP servers and skills using the OpenCode SDK.
 *
 * Calls `ctx.client.mcp.status()` and `ctx.client.instance.skill()` for fast,
 * authoritative local discovery. Each SDK call is independently wrapped in a
 * try/catch so that a failure in one does not prevent the other from
 * succeeding. Empty arrays are returned for any failing SDK call.
 *
 * Results are **not** cached by this function – use
 * {@link getLocalDiscovery} for caching support.
 *
 * @param ctx - The OpenCode plugin input context
 * @returns A {@link LocalDiscoveryResult} with discovered MCPs and skills
 */
export async function scanLocal(
  ctx: PluginInput,
): Promise<LocalDiscoveryResult> {
  const start = performance.now();

  let mcps: DiscoveredMcp[] = [];
  let skills: DiscoveredSkill[] = [];

  // Scan MCPs – failure is non-fatal, results default to empty
  try {
    mcps = await scanMcpStatuses(ctx);
  } catch (err) {
    log('[discovery] MCP scan failed', String(err));
  }

  // Scan skills – failure is non-fatal, results default to empty
  try {
    skills = await scanInstanceSkills(ctx);
  } catch (err) {
    log('[discovery] skill scan failed', String(err));
  }

  const scanDurationMs = performance.now() - start;

  return {
    skills,
    mcps,
    scannedAt: Date.now(),
    scanDurationMs,
  };
}

/**
 * Get locally discovered resources, using a cached result when available.
 *
 * Results are cached for 5 minutes. Call with `forceRefresh = true` to
 * bypass the cache and perform a fresh scan. The cache lives at module
 * scope and is shared across all callers within the same plugin instance.
 *
 * @param ctx - The OpenCode plugin input context
 * @param forceRefresh - If `true`, bypass the cache and force a fresh scan
 * @returns A {@link LocalDiscoveryResult}
 */
export async function getLocalDiscovery(
  ctx: PluginInput,
  forceRefresh?: boolean,
): Promise<LocalDiscoveryResult> {
  if (
    !forceRefresh &&
    cache !== null &&
    Date.now() - cache.timestamp < CACHE_TTL_MS
  ) {
    return cache.result;
  }

  const result = await scanLocal(ctx);
  cache = { result, timestamp: Date.now() };
  return result;
}
