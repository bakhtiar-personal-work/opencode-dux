import type * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';
import type { PluginInput } from '@opencode-ai/plugin';
import { SDK_DISCOVERY_TIMEOUT_MS } from '../config/constants';
import { log } from '../utils/logger';

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

/**
 * Derive tags from a name string (MCP or skill name).
 *
 * Tag derivation has been removed; always returns an empty array.
 * The orchestrator decides tags dynamically from names.
 *
 * @param _name - The MCP or skill name to derive tags from
 * @returns Empty array
 */
function deriveTags(_name: string): string[] {
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
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
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
 * Parse simple YAML frontmatter from a SKILL.md file.
 * Supports `name:` and `description:` fields (string values) and
 * `tags:` and `recommendedAgents:` (inline array `[a, b]` or multiline `- item`).
 */
function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const result: { name?: string; description?: string } = {};

  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return result;

  const block = match[1];
  for (const raw of block.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('- ')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim().toLowerCase();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (key === 'name' && value) {
      result.name = value;
    } else if (key === 'description' && value) {
      result.description = value;
    }
  }

  return result;
}

/**
 * Fallback: extract name and description from SKILL.md heading structure
 * when frontmatter is absent.
 */
function parseSkillMdHeading(
  content: string,
  defaultName: string,
): { name: string; description: string } {
  const lines = content.split('\n');
  let name = defaultName;
  let description = '';
  let foundHeading = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      if (!foundHeading) {
        name = trimmed.replace(/^#\s+/, '').trim();
        foundHeading = true;
      }
    } else if (foundHeading && !description && trimmed) {
      description = trimmed;
      break;
    }
  }

  return { name, description };
}

/**
 * Scan skills from the user's skills directory (~/.config/opencode/skills/).
 *
 * Reads each subdirectory looking for a SKILL.md file, parses its
 * frontmatter (or heading) to extract the skill name and description,
 * and returns a DiscoveredSkill array. Returns an empty array when the
 * directory does not exist or an error occurs.
 *
 * @returns Array of discovered skills (empty on failure)
 */
async function scanInstanceSkills(): Promise<DiscoveredSkill[]> {
  const skillsDir = path.join(os.homedir(), '.config', 'opencode', 'skills');

  let entries: string[];
  try {
    entries = await fsp.readdir(skillsDir);
  } catch {
    // Directory doesn't exist – no user-installed skills
    return [];
  }

  const skills: DiscoveredSkill[] = [];

  for (const entry of entries) {
    const skillPath = path.join(skillsDir, entry);
    let entryStat: fs.Stats;
    try {
      entryStat = await fsp.stat(skillPath);
    } catch {
      continue;
    }

    if (!entryStat.isDirectory()) continue;

    const skillMdPath = path.join(skillPath, 'SKILL.md');
    let mdStat: fs.Stats;
    try {
      mdStat = await fsp.stat(skillMdPath);
    } catch {
      continue;
    }
    if (!mdStat.isFile()) continue;

    let content: string;
    try {
      content = await fsp.readFile(skillMdPath, 'utf-8');
    } catch {
      continue;
    }

    // Try YAML frontmatter first, fall back to heading-based parsing
    const frontmatter = parseSkillFrontmatter(content);
    const parsed =
      frontmatter.name || frontmatter.description !== undefined
        ? {
            name: frontmatter.name ?? entry,
            description: frontmatter.description ?? '',
          }
        : parseSkillMdHeading(content, entry);

    skills.push({
      name: parsed.name,
      description: parsed.description,
      location: skillMdPath,
      tags: deriveTags(parsed.name),
      recommendedAgents: deriveRecommendedAgents(parsed.name),
    });
  }

  return skills;
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
 * Scan locally configured MCP servers and skills.
 *
 * Calls `ctx.client.mcp.status()` for MCP discovery and scans the user's
 * `~/.config/opencode/skills/` directory for SKILL.md files. Each operation
 * is independently wrapped in a try/catch so that a failure in one does not
 * prevent the other from succeeding. Empty arrays are returned for any
 * failing operation.
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
    skills = await scanInstanceSkills();
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
