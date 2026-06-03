/**
 * DeepSeek balance API client.
 *
 * Fetches current account balance from DeepSeek's official API:
 * https://api.deepseek.com/user/balance
 */

import type { DeepSeekUsageEntry } from './types';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';

export async function scrapeDeepSeekBalance(
  apiKey: string,
  signal?: AbortSignal,
): Promise<DeepSeekUsageEntry> {
  const accountName = '';

  try {
    const res = await fetch(DEEPSEEK_BALANCE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
      return {
        provider: 'deepseek',
        accountName,
        fetchedAt: Date.now(),
        is_available: false,
        balance_infos: [],
        error: `DeepSeek API returned ${res.status}${snippet ? `: ${snippet}` : ''}`,
      };
    }

    const data = (await res.json()) as Partial<{
      is_available: boolean;
      balance_infos: Array<{
        currency?: string;
        total_balance?: string;
        granted_balance?: string;
        topped_up_balance?: string;
      }>;
    }>;

    return {
      provider: 'deepseek',
      accountName,
      fetchedAt: Date.now(),
      is_available: data.is_available ?? false,
      balance_infos: Array.isArray(data.balance_infos)
        ? data.balance_infos.map((entry) => ({
            currency: entry.currency ?? 'USD',
            total_balance: entry.total_balance ?? '0',
            granted_balance: entry.granted_balance ?? '0',
            topped_up_balance: entry.topped_up_balance ?? '0',
          }))
        : [],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      provider: 'deepseek',
      accountName,
      fetchedAt: Date.now(),
      is_available: false,
      balance_infos: [],
      error: isTimeout
        ? 'DeepSeek API request timed out. The service may be slow or unreachable.'
        : `DeepSeek fetch failed: ${message}`,
    };
  }
}
