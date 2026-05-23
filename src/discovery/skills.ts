import { exec, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { log } from '../utils/logger';
import { getLocalDiscovery } from './local';

const execAsync = promisify(exec);

/**
 * Simple concurrency limiter for Promise-based operations.
 * Limits how many promises can run concurrently.
 */
async function withConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<R>[] = [];

  for (const item of items) {
    const p = fn(item).then((result) => {
      results.push(result);
      executing.splice(executing.indexOf(p), 1);
      return result;
    });
    results.push(undefined as R); // placeholder, will be replaced
    executing.push(p);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results.filter((r) => r !== undefined);
}

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
 * Result of probing the npx skills CLI availability.
 * Distinguishes between npx missing, skills package missing, timeout, etc.
 */
type SkillsCliProbe =
  | { status: 'available' }
  | { status: 'npx_not_installed'; error: string }
  | { status: 'npx_ok_skills_not_found'; error: string }
  | { status: 'timeout'; error: string }
  | { status: 'unknown_error'; error: string };

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

  /** Install count from npm registry (e.g., 1400 for "1.4K"). Undefined for local skills. */
  installCount?: number;
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

/** Maximum number of cache entries before LRU eviction kicks in. */
const CACHE_MAX_ENTRIES = 100;

/** Cache TTL in milliseconds for skill results (24 hours). */
const SKILL_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/** Minimum relevance score for a local skill to be included in results. */
const LOCAL_SKILL_MIN_RELEVANCE = 0.6;

/** Minimum relevance score for an online skill to be included in results. */
const ONLINE_SKILL_MIN_RELEVANCE = 0.6;

/** Relevance score threshold for skipping online search (local skills must exceed this). */
const RELEVANT_LOCAL_THRESHOLD = 0.4;

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

/**
 * Run `npx skills find` for the given keywords and return the raw stdout.
 *
 * Returns an empty string when the command fails.
 *
 * @param keywords - Search keywords
 * @param timeoutMs - Timeout in milliseconds for the exec call
 * @returns Raw stdout from the CLI, or empty string on failure
 */
function runSkillsFindCli(keywords: string[], timeoutMs = 30_000): string {
  const query = keywords.join(' ');

  const cmd = `npx skills find "${query}"`;
  try {
    const stdout = execSync(cmd, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (stdout.trim()) {
      return stripAnsi(stdout.trim());
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr;
    log(
      '[discovery/skills] npx skills find failed',
      stderr ? `${msg} (stderr: ${stderr.trim()})` : msg,
    );
  }

  return '';
}

/**
 * Async version of runSkillsFindCli for parallel execution.
 * Runs `npx skills find` for the given keywords and returns raw stdout.
 * Uses async exec to avoid blocking the event loop.
 */
async function runSkillsFindCliAsync(
  keywords: string[],
  timeoutMs = 10_000,
): Promise<string> {
  const query = keywords.join(' ');

  const cmd = `npx skills find "${query}"`;
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (stdout.trim()) {
      return stripAnsi(stdout.trim());
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr;
    log(
      '[discovery/skills] npx skills find failed',
      stderr ? `${msg} (stderr: ${stderr.trim()})` : msg,
    );
  }

  return '';
}

/**
 * Check whether the `npx skills` CLI is available on this system.
 *
 * Runs a two-step probe: first verifies npx itself is on PATH, then checks
 * whether the skills package can be resolved/executed. Distinguishes between
 * npx missing, skills package missing, network timeouts, and unknown errors.
 *
 * Timeouts are handled with a retry at 30s to accommodate first-time downloads.
 */
function probeSkillsCli(): SkillsCliProbe {
  // Step 1: Check npx exists (with 5x retry)
  const maxRetries = 5;
  const retryDelayMs = 500; // 500ms between retries

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync('npx --version', {
        timeout: 5_000,
        encoding: 'utf-8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Success - npx is available
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // npx truly not found - no point retrying
        return {
          status: 'npx_not_installed',
          error: 'npx command not found on PATH',
        };
      }

      // Other errors (timeout, EBUSY, etc.) - retry
      if (attempt < maxRetries) {
        log(
          `[discovery/skills] npx --version failed (attempt ${attempt}/${maxRetries}), retrying in ${retryDelayMs}ms...`,
          String(err),
        );
        // Sync sleep using Atomics.wait (Node.js 17+)
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          retryDelayMs,
        );
      } else {
        // All retries exhausted
        return {
          status: 'unknown_error',
          error: `npx --version failed after ${maxRetries} attempts: ${String(err)}`,
        };
      }
    }
  }

  // Step 2: Check skills package (with longer timeout for first fetch)
  const diagnosticTimeoutMs = 15_000;
  const fallbackTimeoutMs = 30_000;

  try {
    execSync('npx skills --version', {
      timeout: diagnosticTimeoutMs,
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 'available' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ETIMEDOUT') || message.includes('killed')) {
      // Retry with even longer timeout - first fetch may need it
      try {
        execSync('npx skills --version', {
          timeout: fallbackTimeoutMs,
          encoding: 'utf-8',
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { status: 'available' };
      } catch (_retryErr) {
        return {
          status: 'timeout',
          error: `npx skills --version timed out after ${fallbackTimeoutMs / 1000}s (first-time download may be slow)`,
        };
      }
    }
    return {
      status: 'npx_ok_skills_not_found',
      error: message,
    };
  }
}

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
 * Strip ANSI escape codes from a string.
 *
 * Removes sequences like `[38;5;250m`, `[0m`, etc. that terminals use for
 * colour and styling. These are emitted by `npx skills find` and must be
 * removed before any text or JSON parsing.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use the ESC control character
  return str.replace(/\u001B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Regex patterns used to parse text-format `npx skills find` output.
 *
 * Actual CLI output format (no --json support):
 * ```text
 * vercel-labs/json-render@react 2.1K installs
 * └ https://skills.sh/vercel-labs/json-render/react
 * ```
 */

/**
 * Match a skill entry line: owner/repo@skill-name [install-count installs]
 * Group 1: the full identifier (e.g. vercel-labs/json-render@react)
 * Group 2: optional install count (e.g. 2.1K)
 */
const SKILL_ENTRY_RE =
  /^([\w.-]+\/[\w.-]+@[\w.:-]+)(?:\s+([\d.]+K?)\s+installs)?$/;

/**
 * Match a URL line starting with └:
 * Group 1: the full URL (e.g. https://skills.sh/vercel-labs/json-render/react)
 */
const SKILL_URL_RE = /^└\s+(https?:\/\/\S+)/;

/**
 * Parse an install count string into a numeric value.
 *
 * Supports shorthand suffixes:
 * - "1.4K" → 1400
 * - "2K" → 2000
 * - "500" → 500
 * - "1.2M" → 1200000
 *
 * @param countStr - Raw install count string (e.g., "1.4K", "500")
 * @returns Parsed number or undefined if input is empty/invalid
 */
function parseInstallCount(countStr: string | undefined): number | undefined {
  if (!countStr) return undefined;
  const normalized = countStr.toUpperCase();
  if (normalized.endsWith('K')) {
    return Math.round(parseFloat(normalized.slice(0, -1)) * 1000);
  }
  if (normalized.endsWith('M')) {
    return Math.round(parseFloat(normalized.slice(0, -1)) * 1000000);
  }
  return parseInt(countStr, 10) || undefined;
}

/**
 * Parse plain-text output from `npx skills find` into skill entries.
 *
 * The `npx skills find` CLI (v1.5.7) does NOT support --json output.
 * Actual output format:
 * ```text
 * vercel-labs/json-render@react 2.1K installs
 * └ https://skills.sh/vercel-labs/json-render/react
 *
 * vercel-labs/json-render@react-pdf 1K installs
 * └ https://skills.sh/vercel-labs/json-render/react-pdf
 * ```
 *
 * Banner lines before the first `owner/repo@skill` line are skipped.
 *
 * @param raw - Raw ANSI-free text output to parse
 * @returns Parsed skill entries (may be empty)
 */
function parseTextSkills(raw: string): Array<{
  name: string;
  description: string;
  install_command: string;
  source_url?: string;
  installCount?: number;
}> {
  const results: Array<{
    name: string;
    description: string;
    install_command: string;
    source_url?: string;
    installCount?: number;
  }> = [];

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let currentName = '';
  let currentDesc = '';
  let currentUrl = '';
  let currentInstallCount: number | undefined;
  let started = false;

  for (const line of lines) {
    // Check for skill entry line: owner/repo@skill-name [installs]
    const entryMatch = line.match(SKILL_ENTRY_RE);
    if (entryMatch) {
      // Flush previous entry before starting a new one
      if (currentName) {
        results.push({
          name: currentName,
          description: currentDesc || 'No description available',
          install_command: buildSkillInstallCommand(currentName),
          source_url: currentUrl || undefined,
          installCount: currentInstallCount,
        });
      }
      currentName = entryMatch[1];
      currentDesc = entryMatch[2]
        ? `Skill with ${entryMatch[2]} installs`
        : 'No description available';
      currentInstallCount = parseInstallCount(entryMatch[2]);
      currentUrl = '';
      started = true;
      continue;
    }

    // Skip banner lines before the first skill entry
    if (!started) continue;

    // Check for URL line: └ https://skills.sh/...
    const urlMatch = line.match(SKILL_URL_RE);
    if (urlMatch) {
      currentUrl = urlMatch[1];
    }
  }

  // Flush last entry
  if (currentName) {
    results.push({
      name: currentName,
      description: currentDesc || 'No description available',
      install_command: buildSkillInstallCommand(currentName),
      source_url: currentUrl || undefined,
      installCount: currentInstallCount,
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

/**
 * Build the correct install command for a skill.
 * Format: npx skills add owner/repo --skill skill-name -g -a opencode -y
 *
 * @param source - Full source string like "owner/repo@skill-name"
 * @returns Install command string
 */
function buildSkillInstallCommand(source: string): string {
  const atIdx = source.lastIndexOf('@');
  if (atIdx >= 0 && atIdx < source.length - 1) {
    const repo = source.slice(0, atIdx);
    const skillName = source.slice(atIdx + 1);
    return `npx skills add ${repo} --skill ${skillName} -g -a opencode -y`;
  }
  // Short name only (local skill) - use default repo
  return `npx skills add vercel-labs/skills --skill ${source} -g -a opencode -y`;
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
 * Score relevance of a skill (name + description + tags) against
 * task keywords. Returns 0 if no keywords provided.
 *
 * - Name match:         +0.35 per keyword
 * - Description match:  +0.20 per keyword
 * - Tag match:          +0.15 per keyword
 * - Match ratio bonus:  +0.10 × (matched / total)
 * - Local bonus:        +0.05 (already installed, most actionable)
 *
 * Capped at 1.0.
 */
function scoreSkillRelevance(
  name: string,
  description: string,
  tags: string[],
  keywords: string[],
): number {
  if (keywords.length === 0) return 0;

  let score = 0;
  const nameLower = name.toLowerCase();
  const descLower = description.toLowerCase();
  const tagsLower = tags.map((t) => t.toLowerCase());
  const allText = `${nameLower} ${descLower} ${tagsLower.join(' ')}`;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (nameLower.includes(kwLower)) score += 0.35;
    if (descLower.includes(kwLower)) score += 0.2;
    if (tagsLower.includes(kwLower)) score += 0.15;
  }

  // Match ratio bonus: rewards keyword coverage
  const matchedKeywords = keywords.filter((kw) =>
    allText.includes(kw.toLowerCase()),
  ).length;
  if (keywords.length > 0) {
    score += (matchedKeywords / keywords.length) * 0.1;
  }

  // Local install bonus - already installed, more actionable
  score += 0.05;

  return Math.min(score, 1);
}

/**
 * Build a human-readable reason explaining why a skill matched.
 */
function buildSkillRelevanceReason(
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

  const parts: string[] = [];
  if (matchedKeywords.length > 0) {
    parts.push(`Matches keywords: ${matchedKeywords.join(', ')}`);
  }
  parts.push('already installed locally');
  return parts.join('; ');
}

/**
 * Match locally-installed skills against task keywords and return
 * recommendations with high priority scores.
 *
 * Local skills are already installed, so they're most actionable
 * and always ranked first in the two-tier system.
 */
function matchLocalSkills(
  skills: Array<{ name: string; description?: string; tags?: string[] }>,
  taskKeywords: string[],
): SkillRecommendation[] {
  if (taskKeywords.length === 0) {
    // No search context - return all with neutral score
    return skills.map((skill) => ({
      type: 'skill',
      name: skill.name,
      description: skill.description ?? 'No description available',
      install_command: buildSkillInstallCommand(skill.name),
      relevance_reason: 'Already installed locally',
      relevance_score: 0.05,
      already_installed: true,
    }));
  }

  const recommendations: SkillRecommendation[] = [];

  for (const skill of skills) {
    const name = skill.name;
    const description = skill.description ?? '';
    const tags = skill.tags ?? [];
    const relevanceScore = scoreSkillRelevance(
      name,
      description,
      tags,
      taskKeywords,
    );

    // Filter out completely irrelevant skills
    if (relevanceScore < LOCAL_SKILL_MIN_RELEVANCE) continue;

    recommendations.push({
      type: 'skill',
      name,
      description: description || 'No description available',
      install_command: buildSkillInstallCommand(name),
      relevance_reason: buildSkillRelevanceReason(
        name,
        description,
        tags,
        taskKeywords,
      ),
      relevance_score: relevanceScore,
      already_installed: true,
    });
  }

  return recommendations;
}

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
  const queries = [...input.task_keywords];

  // Auto-discover installed skills if caller didn't provide existing names
  let existingSkillNames = input.existing_skill_names;
  // Keep the full local skill objects for scoring
  let localSkills: Array<{
    name: string;
    description?: string;
    tags?: string[];
  }> = [];
  if (!existingSkillNames || existingSkillNames.length === 0) {
    try {
      const local = await getLocalDiscovery(ctx);
      existingSkillNames = local.skills.map((s) => s.name);
      localSkills = local.skills;
    } catch {
      // Best-effort – skip auto-discovery if SDK call fails
      existingSkillNames = [];
    }
  }

  const allRecommendations: SkillRecommendation[] = [];
  const seenNames = new Set<string>();

  // Score local skills first - skip online search only if we have enough genuinely relevant matches
  const localMatches = matchLocalSkills(localSkills, input.task_keywords);
  const relevantLocals = localMatches.filter(
    (m) => m.relevance_score > RELEVANT_LOCAL_THRESHOLD,
  );
  if (relevantLocals.length >= maxResults) {
    relevantLocals.sort((a, b) => b.relevance_score - a.relevance_score);
    return {
      recommendations: relevantLocals.slice(0, maxResults),
      from_cache: false,
      queries_used: [],
    };
  }

  // Probe the CLI once before the loop
  const probe = probeSkillsCli();

  if (probe.status !== 'available') {
    switch (probe.status) {
      case 'npx_not_installed':
        throw new Error(
          'npx is not installed or not on PATH. Install Node.js (which includes npx) from https://nodejs.org.',
        );
      case 'npx_ok_skills_not_found':
        throw new Error(
          `npx is available but the "skills" package could not be loaded: ${probe.error}\n` +
            `Try running manually: npx skills find <keyword>`,
        );
      case 'timeout':
        throw new Error(
          `npx skills CLI probe timed out (first-time download may be slow).\n` +
            `Try running manually to warm the cache: npx skills --version`,
        );
      case 'unknown_error':
        throw new Error(
          `npx skills CLI probe failed: ${probe.error}\n` +
            `Verify npx works: npx --version`,
        );
    }
  }

  // Parallel keyword search with concurrency cap to avoid overwhelming the registry
  const rawOutputs = await withConcurrency(
    input.task_keywords,
    async (query) => runSkillsFindCliAsync([query]),
    5, // max 5 concurrent npx calls
  );

  for (const rawOutput of rawOutputs) {
    if (!rawOutput) continue;

    // Try JSON parsing first
    const jsonSkills = tryParseJsonSkills(rawOutput);
    if (jsonSkills) {
      for (const [index, skill] of jsonSkills.entries()) {
        const skillName = skill.name || extractSkillName(skill.source ?? '');
        if (!skillName) continue;

        if (seenNames.has(skillName.toLowerCase())) continue;
        seenNames.add(skillName.toLowerCase());

        const description = skill.description ?? 'No description available';
        const source = skill.source ?? skillName;

        allRecommendations.push({
          type: 'skill',
          name: skillName,
          description,
          install_command: buildSkillInstallCommand(source),
          relevance_reason: `Found by npx skills find matching keyword`,
          relevance_score:
            ONLINE_SKILL_MIN_RELEVANCE + (1.0 / (index + 1)) * 0.4, // Range: 0.4-0.8, lower than locals
          installCount: skill.installs,
        });
      }
    } else {
      // Fall back to text parsing
      const textSkills = parseTextSkills(rawOutput);
      for (const [index, skill] of textSkills.entries()) {
        if (seenNames.has(skill.name.toLowerCase())) continue;
        seenNames.add(skill.name.toLowerCase());

        allRecommendations.push({
          type: 'skill',
          name: skill.name,
          description: skill.description,
          install_command: skill.install_command,
          source_url: skill.source_url,
          relevance_reason: `Found by npx skills find matching keyword`,
          relevance_score:
            ONLINE_SKILL_MIN_RELEVANCE + (1.0 / (index + 1)) * 0.4, // Range: 0.4-0.8, lower than locals
          installCount: skill.installCount,
        });
      }
    }
  }

  // If CLI returned no results, return empty (no npm fallback)
  if (allRecommendations.length === 0) {
    return {
      recommendations: [],
      from_cache: false,
      queries_used: queries,
    };
  }

  // Two-tier: locals first, then online (no score comparison needed)
  const onlineUnique = deduplicateByName(allRecommendations);
  const sortedLocals = localMatches.sort(
    (a, b) => b.relevance_score - a.relevance_score,
  );
  const sortedOnline = onlineUnique.sort((a, b) => {
    // Primary: install count (descending)
    const countA = a.installCount ?? 0;
    const countB = b.installCount ?? 0;
    if (countB !== countA) return countB - countA;
    // Tiebreaker: relevance score
    return b.relevance_score - a.relevance_score;
  });
  const final = [...sortedLocals, ...sortedOnline].slice(0, maxResults);

  return {
    recommendations: final,
    from_cache: false,
    queries_used: queries,
  };
}

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
export function createDiscoverSkillsTool(ctx: PluginInput): ToolDefinition {
  const cache = loadCacheFile();
  const cachePrefix = 'skill';

  return tool({
    description:
      'Discovers skills that could help with a task. ' +
      'Checks locally installed skills first - if enough relevant skills are ' +
      'found locally, skips online search entirely. If local results are ' +
      'insufficient, supplements with online discovery. ' +
      'Skills provide specialized instructions and workflows for specific tasks ' +
      '(testing, deployment, accessibility audits, etc.). ' +
      'Use this when a subagent lacks specialized knowledge or workflows ' +
      'and you want to discover what skills are available. ' +
      'If existing_skill_names is not provided, automatically discovers ' +
      "what's already installed and filters recommendations accordingly. " +
      'Already-installed skills are always shown first (highest priority), ' +
      'followed by online recommendations. ' +
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

      // Per-keyword cache check for better hit rate
      const uncachedKeywords: string[] = [];
      const keywordResults: Map<string, string> = new Map();

      for (const keyword of taskKeywords) {
        const perKwKey = buildCacheKey(`${cachePrefix}:kw`, [keyword]);
        const cached = readFromCache<string>(cache, perKwKey);
        if (cached) {
          keywordResults.set(keyword, cached);
          log('[discovery/skills] per-keyword cache hit for', keyword);
        } else {
          uncachedKeywords.push(keyword);
        }
      }

      // If all keywords cached, return empty (local skills will be used)
      if (uncachedKeywords.length === 0 && keywordResults.size > 0) {
        // All keywords cached - skip online search, use local skills only
        log('[discovery/skills] all keywords cached');
      }

      try {
        const output = await discoverSkillsOnline(
          {
            task_description: args.task_description ?? '',
            task_keywords:
              uncachedKeywords.length > 0 ? uncachedKeywords : taskKeywords,
            agent_name: args.agent_name ?? '',
            existing_skill_names: existingNames,
            max_results: maxResults,
          },
          ctx,
        );

        writeToCache(
          cache,
          buildCacheKey(cachePrefix, taskKeywords),
          output,
          SKILL_CACHE_TTL_MS,
        );

        // Cache each keyword individually for future per-keyword hits
        for (const keyword of taskKeywords) {
          const perKwKey = buildCacheKey(`${cachePrefix}:kw`, [keyword]);
          writeToCache(
            cache,
            perKwKey,
            keywordResults.get(keyword) || '',
            SKILL_CACHE_TTL_MS,
          );
        }

        return JSON.stringify(output);
      } catch (err) {
        // Return plain text error, not JSON
        const message = err instanceof Error ? err.message : String(err);
        return `Skills discovery unavailable: ${message}`;
      }
    },
  });
}
