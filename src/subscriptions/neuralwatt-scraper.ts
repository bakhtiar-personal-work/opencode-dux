/**
 * Neuralwatt quota API scraper.
 *
 * Fetches usage data from the Neuralwatt REST API using Bearer token
 * authentication. Returns structured quota data including credit balance,
 * energy usage (kWh), and subscription details.
 *
 * Rate limit: 1 request per second per customer.
 */

import type { NeuralwattUsageEntry } from './types';

const NEURALWATT_QUOTA_URL = 'https://api.neuralwatt.com/v1/quota';

const EMPTY_BALANCE = {
  credits_remaining_usd: 0,
  total_credits_usd: 0,
  credits_used_usd: 0,
  accounting_method: 'energy',
};

const EMPTY_USAGE_PERIOD = {
  cost_usd: 0,
  requests: 0,
  tokens: 0,
  energy_kwh: 0,
};

const EMPTY_USAGE = {
  lifetime: { ...EMPTY_USAGE_PERIOD },
  current_month: { ...EMPTY_USAGE_PERIOD },
};

/**
 * Fetch Neuralwatt quota data via the REST API.
 */
export async function scrapeNeuralwattQuota(
  apiKey: string,
  signal?: AbortSignal,
): Promise<NeuralwattUsageEntry> {
  const now = Date.now();

  try {
    const response = await fetch(NEURALWATT_QUOTA_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.text();
        detail = body.slice(0, 200).replace(/\s+/g, ' ').trim();
      } catch {
        // Ignore body read errors
      }
      return {
        provider: 'neuralwatt',
        accountName: '',
        snapshot_at: '',
        balance: { ...EMPTY_BALANCE },
        usage: {
          lifetime: { ...EMPTY_USAGE_PERIOD },
          current_month: { ...EMPTY_USAGE_PERIOD },
        },
        subscription: null,
        fetchedAt: now,
        error: `API error ${response.status}${detail ? `: ${detail}` : ''}`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      provider: 'neuralwatt',
      accountName: '',
      snapshot_at: (data.snapshot_at as string) ?? '',
      balance: (data.balance as NeuralwattUsageEntry['balance']) ?? {
        ...EMPTY_BALANCE,
      },
      usage: (data.usage as NeuralwattUsageEntry['usage']) ?? {
        ...EMPTY_USAGE,
      },
      subscription:
        (data.subscription as NeuralwattUsageEntry['subscription']) ?? null,
      fetchedAt: now,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      provider: 'neuralwatt',
      accountName: '',
      snapshot_at: '',
      balance: { ...EMPTY_BALANCE },
      usage: {
        lifetime: { ...EMPTY_USAGE_PERIOD },
        current_month: { ...EMPTY_USAGE_PERIOD },
      },
      subscription: null,
      fetchedAt: now,
      error: `Fetch failed: ${message}`,
    };
  }
}
