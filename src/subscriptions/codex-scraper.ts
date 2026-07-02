/**
 * Codex quota API scraper.
 *
 * Fetches usage data from the Codex (chatgpt.com) WHAM usage API using Bearer
 * token authentication. Returns structured quota data including usage windows
 * and credit balance.
 */

import type { CodexUsageEntry, UsageWindow } from './types';

const CODEX_WHAM_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

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

/** Best-effort fetch of banked rate-limit reset credits. Returns undefined on any failure. */
async function fetchRateLimitResetCredits(
  accessToken: string,
  signal: AbortSignal | undefined,
  accountId?: string,
): Promise<
  { availableCount: number; credits: Array<{ expiresAt: string }> } | undefined
> {
  try {
    const res = await fetch(CODEX_RESET_CREDITS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
      },
      signal,
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      available_count?: number;
      credits?: Array<{ expires_at?: number }>;
    };
    const credits = (data.credits ?? [])
      .filter(
        (c): c is { expires_at: number } => typeof c.expires_at === 'number',
      )
      .map((c) => ({
        expiresAt: new Date(c.expires_at * 1000).toISOString(),
      }))
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    return {
      availableCount: Math.max(0, Number(data.available_count) || 0),
      credits,
    };
  } catch {
    // 404/403/network/abort — feature may be unavailable for this account.
    return undefined;
  }
}

/**
 * Fetch Codex quota data via the WHAM usage API.
 */
export async function scrapeCodexQuota(
  accessToken: string,
  signal?: AbortSignal,
  accountId?: string,
): Promise<CodexUsageEntry> {
  const accountName = ''; // filled by caller

  try {
    const [usageResult, resetResult] = await Promise.allSettled([
      fetch(CODEX_WHAM_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
        },
        signal,
      }),
      fetchRateLimitResetCredits(accessToken, signal, accountId),
    ]);

    // Reset-credits is best-effort: only a fulfilled value is surfaced.
    const rateLimitResetCredits =
      resetResult.status === 'fulfilled' ? resetResult.value : undefined;

    if (usageResult.status !== 'fulfilled') {
      throw usageResult.reason; // routed to outer catch
    }
    const res = usageResult.value;

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
        balance: Number(data.credits?.balance) || 0,
      },
      planType: data.plan_type ?? undefined,
      rateLimitResetCredits,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      provider: 'codex',
      accountName,
      fetchedAt: Date.now(),
      error: isTimeout
        ? 'Codex API request timed out. The service may be slow or unreachable.'
        : `Codex fetch failed: ${message}`,
      primaryWindow: { ...EMPTY_WINDOW },
      secondaryWindow: null,
      credits: { ...EMPTY_CREDITS },
      planType: undefined,
    };
  }
}
