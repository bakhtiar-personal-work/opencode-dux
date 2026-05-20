/**
 * Codex quota API scraper.
 *
 * Fetches usage data from the Codex (chatgpt.com) WHAM usage API using Bearer
 * token authentication. Returns structured quota data including usage windows
 * and credit balance.
 */

import type { CodexUsageEntry, UsageWindow } from './types';

const CODEX_WHAM_URL = 'https://chatgpt.com/backend-api/wham/usage';

const EMPTY_WINDOW: UsageWindow = {
  usagePercent: 0,
  percentRemaining: 100,
  resetInSec: 0,
  resetTimeIso: '',
};

const EMPTY_CREDITS = { hasCredits: false, unlimited: false, balance: 0 };

function windowFromApi(
  w:
    | { used_percent: number; reset_at: number; limit_window_seconds: number }
    | undefined,
): UsageWindow {
  if (!w) return { ...EMPTY_WINDOW };
  const usagePercent = Math.max(0, Math.min(100, w.used_percent));
  return {
    usagePercent,
    percentRemaining: 100 - usagePercent,
    resetInSec: Math.max(0, w.limit_window_seconds),
    resetTimeIso: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : '',
  };
}

/**
 * Fetch Codex quota data via the WHAM usage API.
 */
export async function scrapeCodexQuota(
  accessToken: string,
  signal?: AbortSignal,
): Promise<CodexUsageEntry> {
  const accountName = ''; // filled by caller

  try {
    const res = await fetch(CODEX_WHAM_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal,
    });

    if (!res.ok) {
      return {
        provider: 'codex',
        accountName,
        fetchedAt: Date.now(),
        error: `Codex API returned ${res.status} ${res.statusText}`,
        primaryWindow: { ...EMPTY_WINDOW },
        secondaryWindow: null,
        credits: { ...EMPTY_CREDITS },
        planType: undefined,
      };
    }

    const data = (await res.json()) as {
      plan_type?: string;
      rate_limit?: {
        primary_window?: {
          used_percent: number;
          reset_at: number;
          limit_window_seconds: number;
        };
        secondary_window?: {
          used_percent: number;
          reset_at: number;
          limit_window_seconds: number;
        };
      };
      credits?: { has_credits: boolean; unlimited: boolean; balance: number };
    };

    return {
      provider: 'codex',
      accountName,
      fetchedAt: Date.now(),
      primaryWindow: windowFromApi(data.rate_limit?.primary_window),
      secondaryWindow: data.rate_limit?.secondary_window
        ? windowFromApi(data.rate_limit.secondary_window)
        : null,
      credits: {
        hasCredits: data.credits?.has_credits ?? false,
        unlimited: data.credits?.unlimited ?? false,
        balance: data.credits?.balance ?? 0,
      },
      planType: data.plan_type ?? undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      provider: 'codex',
      accountName,
      fetchedAt: Date.now(),
      error: `Codex fetch failed: ${message}`,
      primaryWindow: { ...EMPTY_WINDOW },
      secondaryWindow: null,
      credits: { ...EMPTY_CREDITS },
      planType: undefined,
    };
  }
}
