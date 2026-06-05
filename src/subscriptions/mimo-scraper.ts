/**
 * MiMo (Xiaomi) subscription API client.
 *
 * Fetches balance, plan details, and token usage from MiMo's platform APIs:
 * - https://platform.xiaomimimo.com/api/v1/balance
 * - https://platform.xiaomimimo.com/api/v1/tokenPlan/detail
 * - https://platform.xiaomimimo.com/api/v1/tokenPlan/usage
 *
 * Auth: Cookie-based (full cookie header string stored in account config).
 */

import type {
  MiMoBalance,
  MiMoPlanDetail,
  MiMoUsageData,
  MiMoUsageEntry,
} from './types';

const MIMO_BASE_URL = 'https://platform.xiaomimimo.com/api/v1';

const EMPTY_BALANCE: MiMoBalance = {
  balance: '0',
  frozenBalance: '0',
  currency: 'USD',
  overdraftLimit: '0',
  remainingOverdraftLimit: '0',
  giftBalance: '0',
  cashBalance: '0',
};

const EMPTY_PLAN_DETAIL: MiMoPlanDetail = {
  planCode: '',
  planName: '',
  currentPeriodEnd: '',
  expired: true,
  enableAutoRenew: false,
  autoRenewDiscount: null,
  hasAutoRenewSubscribed: false,
};

const EMPTY_USAGE: MiMoUsageData = {
  percent: 0,
  items: [],
};

/** Normalize raw balance response fields. */
function normalizeBalance(raw: Record<string, unknown>): MiMoBalance {
  return {
    balance: typeof raw.balance === 'string' ? raw.balance : '0',
    frozenBalance:
      typeof raw.frozenBalance === 'string' ? raw.frozenBalance : '0',
    currency: typeof raw.currency === 'string' ? raw.currency : 'USD',
    overdraftLimit:
      typeof raw.overdraftLimit === 'string' ? raw.overdraftLimit : '0',
    remainingOverdraftLimit:
      typeof raw.remainingOverdraftLimit === 'string'
        ? raw.remainingOverdraftLimit
        : '0',
    giftBalance: typeof raw.giftBalance === 'string' ? raw.giftBalance : '0',
    cashBalance: typeof raw.cashBalance === 'string' ? raw.cashBalance : '0',
  };
}

/** Normalize raw plan detail response fields. */
function normalizePlanDetail(raw: Record<string, unknown>): MiMoPlanDetail {
  return {
    planCode: typeof raw.planCode === 'string' ? raw.planCode : '',
    planName: typeof raw.planName === 'string' ? raw.planName : '',
    currentPeriodEnd:
      typeof raw.currentPeriodEnd === 'string' ? raw.currentPeriodEnd : '',
    expired: typeof raw.expired === 'boolean' ? raw.expired : true,
    enableAutoRenew:
      typeof raw.enableAutoRenew === 'boolean' ? raw.enableAutoRenew : false,
    autoRenewDiscount: raw.autoRenewDiscount ?? null,
    hasAutoRenewSubscribed:
      typeof raw.hasAutoRenewSubscribed === 'boolean'
        ? raw.hasAutoRenewSubscribed
        : false,
  };
}

/** Normalize raw usage response into MiMoUsageData. */
function normalizeUsage(raw: Record<string, unknown>): MiMoUsageData {
  const percent = typeof raw.percent === 'number' ? raw.percent : 0;
  const items = Array.isArray(raw.items)
    ? (raw.items as Array<Record<string, unknown>>).map((item) => ({
        name: typeof item.name === 'string' ? item.name : '',
        used: typeof item.used === 'number' ? item.used : 0,
        limit: typeof item.limit === 'number' ? item.limit : 0,
        percent: typeof item.percent === 'number' ? item.percent : 0,
      }))
    : [];
  return { percent, items };
}

/**
 * Fetch all MiMo endpoints in parallel and return a normalized usage entry.
 *
 * @param accountName  Display name for this account.
 * @param platformPh   api-platform_ph cookie value.
 * @param serviceToken api-platform_serviceToken cookie value.
 * @param slh          api-platform_slh cookie value.
 * @param userId       userId cookie value.
 * @param signal       Optional AbortSignal for timeout.
 */
export async function scrapeMiMoUsage(
  accountName: string,
  platformPh: string,
  serviceToken: string,
  slh: string,
  userId: string,
  signal?: AbortSignal,
): Promise<MiMoUsageEntry> {
  const authCookie = [
    `api-platform_ph=${platformPh}`,
    `api-platform_serviceToken=${serviceToken}`,
    `api-platform_slh=${slh}`,
    `userId=${userId}`,
  ].join('; ');

  const headers = {
    Cookie: authCookie,
    Accept: 'application/json',
  };

  const zeroedEntry: MiMoUsageEntry = {
    provider: 'mimo',
    accountName,
    fetchedAt: Date.now(),
    balance: EMPTY_BALANCE,
    planDetail: EMPTY_PLAN_DETAIL,
    monthUsage: EMPTY_USAGE,
    planUsage: EMPTY_USAGE,
  };

  try {
    const [balanceRes, planRes, usageRes] = await Promise.all([
      fetch(`${MIMO_BASE_URL}/balance`, { headers, signal }),
      fetch(`${MIMO_BASE_URL}/tokenPlan/detail`, { headers, signal }),
      fetch(`${MIMO_BASE_URL}/tokenPlan/usage`, { headers, signal }),
    ]);

    // Check HTTP status for each endpoint
    if (!balanceRes.ok) {
      const text = await balanceRes.text();
      const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
      return {
        ...zeroedEntry,
        error: `MiMo balance API returned ${balanceRes.status}${snippet ? `: ${snippet}` : ''}`,
      };
    }
    if (!planRes.ok) {
      const text = await planRes.text();
      const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
      return {
        ...zeroedEntry,
        error: `MiMo plan API returned ${planRes.status}${snippet ? `: ${snippet}` : ''}`,
      };
    }
    if (!usageRes.ok) {
      const text = await usageRes.text();
      const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
      return {
        ...zeroedEntry,
        error: `MiMo usage API returned ${usageRes.status}${snippet ? `: ${snippet}` : ''}`,
      };
    }

    const balanceJson = (await balanceRes.json()) as Record<string, unknown>;
    const planJson = (await planRes.json()) as Record<string, unknown>;
    const usageJson = (await usageRes.json()) as Record<string, unknown>;

    // Validate code === 0 for each response
    if (balanceJson.code !== 0) {
      return {
        ...zeroedEntry,
        error: `MiMo balance API error: ${balanceJson.message ?? 'unknown'}`,
      };
    }
    if (planJson.code !== 0) {
      return {
        ...zeroedEntry,
        error: `MiMo plan API error: ${planJson.message ?? 'unknown'}`,
      };
    }
    if (usageJson.code !== 0) {
      return {
        ...zeroedEntry,
        error: `MiMo usage API error: ${usageJson.message ?? 'unknown'}`,
      };
    }

    const balanceData = balanceJson.data as Record<string, unknown> | undefined;
    const planData = planJson.data as Record<string, unknown> | undefined;
    const usageData = usageJson.data as Record<string, unknown> | undefined;

    const monthUsageRaw = usageData?.monthUsage as
      | Record<string, unknown>
      | undefined;
    const planUsageRaw = usageData?.usage as
      | Record<string, unknown>
      | undefined;

    return {
      provider: 'mimo',
      accountName,
      fetchedAt: Date.now(),
      balance: balanceData ? normalizeBalance(balanceData) : EMPTY_BALANCE,
      planDetail: planData ? normalizePlanDetail(planData) : EMPTY_PLAN_DETAIL,
      monthUsage: monthUsageRaw ? normalizeUsage(monthUsageRaw) : EMPTY_USAGE,
      planUsage: planUsageRaw ? normalizeUsage(planUsageRaw) : EMPTY_USAGE,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ...zeroedEntry,
      error: isTimeout
        ? 'MiMo API request timed out. The service may be slow or unreachable.'
        : `MiMo fetch failed: ${message}`,
    };
  }
}
