/**
 * OpenCode Go dashboard scraper.
 *
 * Fetches the OpenCode Go workspace dashboard page and parses SolidJS SSR
 * hydration output for known usage windows (rollingUsage, weeklyUsage,
 * monthlyUsage) containing usagePercent and resetInSec fields.
 */

import type { OpenCodeGoUsageEntry, UsageDetail, UsageWindow } from './types';

const DASHBOARD_URL_PREFIX = 'https://opencode.ai/workspace/';
const DASHBOARD_URL_SUFFIX = '/go';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0';
const _SCRAPE_TIMEOUT_MS = 10_000;

/**
 * Regex patterns matching SolidJS SSR hydration output for usage windows.
 * Field order may vary, so we try both orderings.
 */
const SCRAPED_NUMBER_PATTERN = String.raw`(-?\d+(?:\.\d+)?)`;

const RE_ROLLING_PCT_FIRST = new RegExp(
  String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_ROLLING_RESET_FIRST = new RegExp(
  String.raw`rollingUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

const RE_WEEKLY_PCT_FIRST = new RegExp(
  String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_WEEKLY_RESET_FIRST = new RegExp(
  String.raw`weeklyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

const RE_MONTHLY_PCT_FIRST = new RegExp(
  String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);
const RE_MONTHLY_RESET_FIRST = new RegExp(
  String.raw`monthlyUsage:\$R\[\d+\]=\{[^}]*resetInSec:${SCRAPED_NUMBER_PATTERN}[^}]*usagePercent:${SCRAPED_NUMBER_PATTERN}[^}]*\}`,
);

interface ScrapedWindowUsage {
  usagePercent: number;
  resetInSec: number;
}

function parseWindowUsage(
  html: string,
  rePctFirst: RegExp,
  reResetFirst: RegExp,
): ScrapedWindowUsage | null {
  const pctFirstMatch = rePctFirst.exec(html);
  if (pctFirstMatch) {
    const usagePercent = Number(pctFirstMatch[1]);
    const resetInSec = Number(pctFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  const resetFirstMatch = reResetFirst.exec(html);
  if (resetFirstMatch) {
    const resetInSec = Number(resetFirstMatch[1]);
    const usagePercent = Number(resetFirstMatch[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  return null;
}

function normalizeWindowUsage(
  window: ScrapedWindowUsage,
  now: number,
): UsageWindow {
  const usagePercent = Math.max(0, window.usagePercent);
  const resetInSec = Math.max(0, window.resetInSec);

  return {
    usagePercent,
    resetInSec,
    percentRemaining: 100 - usagePercent,
    resetTimeIso: new Date(now + resetInSec * 1000).toISOString(),
  };
}

/**
 * Fetch the OpenCode Go dashboard /go page and extract quota usage data.
 */
export async function scrapeQuota(
  workspaceId: string,
  authCookie: string,
  signal?: AbortSignal,
): Promise<OpenCodeGoUsageEntry> {
  const now = Date.now();
  const url = `${DASHBOARD_URL_PREFIX}${encodeURIComponent(workspaceId)}${DASHBOARD_URL_SUFFIX}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        Cookie: `auth=${authCookie}`,
      },
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
      return {
        provider: 'opencode-go',
        accountName: '',
        workspaceId,
        fetchedAt: now,
        error: `Dashboard error ${response.status}: ${snippet}`,
      };
    }

    const html = await response.text();

    const rolling = parseWindowUsage(
      html,
      RE_ROLLING_PCT_FIRST,
      RE_ROLLING_RESET_FIRST,
    );
    const weekly = parseWindowUsage(
      html,
      RE_WEEKLY_PCT_FIRST,
      RE_WEEKLY_RESET_FIRST,
    );
    const monthly = parseWindowUsage(
      html,
      RE_MONTHLY_PCT_FIRST,
      RE_MONTHLY_RESET_FIRST,
    );

    if (!rolling && !weekly && !monthly) {
      return {
        provider: 'opencode-go',
        accountName: '',
        workspaceId,
        fetchedAt: now,
        error:
          'Could not parse any usage windows (rollingUsage, weeklyUsage, monthlyUsage) from dashboard. ' +
          'The dashboard format may have changed.',
      };
    }

    return {
      provider: 'opencode-go',
      accountName: '',
      workspaceId,
      fetchedAt: now,
      ...(rolling ? { rolling: normalizeWindowUsage(rolling, now) } : {}),
      ...(weekly ? { weekly: normalizeWindowUsage(weekly, now) } : {}),
      ...(monthly ? { monthly: normalizeWindowUsage(monthly, now) } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      provider: 'opencode-go',
      accountName: '',
      workspaceId,
      fetchedAt: now,
      error: isTimeout
        ? 'OpenCode Go dashboard request timed out. The service may be slow or unreachable.'
        : `Fetch failed: ${message}`,
    };
  }
}

function _parseUsageHTML(
  _doc: globalThis.Document,
): UsageDetail | { error: string } {
  // The /usage page is client-side rendered and all data is in SSR hydration.
  // HTML table parsing is not applicable.
  return { error: 'Could not parse usage data from the page.' };
}

// Export for testing
export { parseWindowUsage as _parseWindowUsage };
