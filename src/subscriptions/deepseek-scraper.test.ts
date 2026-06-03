import { afterEach, describe, expect, mock, test } from 'bun:test';
import { scrapeDeepSeekBalance } from './deepseek-scraper';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('deepseek-scraper', () => {
  test('parses DeepSeek official balance response', async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          is_available: true,
          balance_infos: [
            {
              currency: 'USD',
              total_balance: '11.50',
              granted_balance: '1.50',
              topped_up_balance: '10.00',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch;

    const result = await scrapeDeepSeekBalance('sk-test');

    expect(result.provider).toBe('deepseek');
    expect(result.is_available).toBe(true);
    expect(result.balance_infos).toEqual([
      {
        currency: 'USD',
        total_balance: '11.50',
        granted_balance: '1.50',
        topped_up_balance: '10.00',
      },
    ]);
    expect(result.error).toBeUndefined();
  });

  test('returns structured error on non-200 response', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as unknown as typeof fetch;

    const result = await scrapeDeepSeekBalance('sk-test');

    expect(result.provider).toBe('deepseek');
    expect(result.is_available).toBe(false);
    expect(result.balance_infos).toEqual([]);
    expect(result.error).toContain('DeepSeek API returned 401');
  });
});
