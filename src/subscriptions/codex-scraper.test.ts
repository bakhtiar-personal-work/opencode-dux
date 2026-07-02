import { afterEach, describe, expect, mock, test } from 'bun:test';
import { scrapeCodexQuota } from './codex-scraper';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchByUrl(
  handlers: Record<string, () => Response>,
): typeof fetch {
  return mock(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const key of Object.keys(handlers)) {
      if (url.includes(key)) return handlers[key]();
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('scrapeCodexQuota', () => {
  test('parses usage + reset credits when both endpoints succeed', async () => {
    globalThis.fetch = mockFetchByUrl({
      '/wham/usage': () =>
        new Response(
          JSON.stringify({
            plan_type: 'plus',
            rate_limit: {
              primary_window: {
                used_percent: 40,
                reset_at: 1700000000,
                limit_window_seconds: 3600,
              },
            },
            credits: { has_credits: true, unlimited: false, balance: 12.5 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      '/wham/rate-limit-reset-credits': () =>
        new Response(
          JSON.stringify({
            available_count: 2,
            credits: [{ expires_at: 1700001000 }, { expires_at: 1700000500 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const result = await scrapeCodexQuota('cx-token');

    expect(result.provider).toBe('codex');
    expect(result.error).toBeUndefined();
    expect(result.primaryWindow.usagePercent).toBe(40);
    expect(result.credits.balance).toBe(12.5);
    expect(result.rateLimitResetCredits).toBeDefined();
    expect(result.rateLimitResetCredits?.availableCount).toBe(2);
    expect(result.rateLimitResetCredits?.credits).toHaveLength(2);
    // earliest-first sort
    expect(result.rateLimitResetCredits?.credits[0].expiresAt).toBe(
      new Date(1700000500 * 1000).toISOString(),
    );
  });

  test('reset-credits 404 leaves usage intact and field omitted', async () => {
    globalThis.fetch = mockFetchByUrl({
      '/wham/usage': () =>
        new Response(
          JSON.stringify({
            credits: { has_credits: false, unlimited: true, balance: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      '/wham/rate-limit-reset-credits': () =>
        new Response('Not Found', { status: 404 }),
    });

    const result = await scrapeCodexQuota('cx-token');

    expect(result.error).toBeUndefined();
    expect(result.credits.unlimited).toBe(true);
    expect(result.rateLimitResetCredits).toBeUndefined();
  });

  test('usage 401 sets error and omits reset credits', async () => {
    globalThis.fetch = mockFetchByUrl({
      '/wham/usage': () => new Response('Unauthorized', { status: 401 }),
      '/wham/rate-limit-reset-credits': () =>
        new Response(JSON.stringify({ available_count: 1, credits: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const result = await scrapeCodexQuota('cx-token');

    expect(result.error).toContain('Codex API returned 401');
    expect(result.rateLimitResetCredits).toBeUndefined();
  });
});
