/**
 * Type definitions for multi-provider subscription usage tracking.
 *
 * Supports OpenCode Go (dashboard scraping), Neuralwatt (REST API),
 * DeepSeek (official balance API), and Codex (device code auth) as
 * discriminated unions on the `provider` field.
 */

/** Provider discriminator. */
export type SubscriptionProvider =
  | 'opencode-go'
  | 'neuralwatt'
  | 'deepseek'
  | 'codex'
  | 'mimo';

export interface OpenCodeGoAccount {
  provider: 'opencode-go';
  name: string;
  workspaceId: string;
  authCookie: string;
  apiKey: string;
}

export interface NeuralwattAccount {
  provider: 'neuralwatt';
  name: string;
  apiKey: string;
}

export interface DeepSeekAccount {
  provider: 'deepseek';
  name: string;
  apiKey: string;
}

export interface CodexAccount {
  provider: 'codex';
  name: string;
  accessToken: string;
  refreshToken?: string;
  /** Token expiry timestamp (epoch ms). Used for proactive refresh. */
  expiresAt?: number;
  /** ChatGPT account ID from JWT. */
  accountId?: string;
  /** JWT with account metadata (email, account_id). */
  idToken?: string;
}

export interface MiMoAccount {
  provider: 'mimo';
  name: string;
  apiKey: string;
  platformPh: string;
  serviceToken: string;
  slh: string;
  userId: string;
}

export type StoredAccount =
  | OpenCodeGoAccount
  | NeuralwattAccount
  | DeepSeekAccount
  | CodexAccount
  | MiMoAccount;

/** Per-time-window usage data scraped from the OpenCode Go dashboard. */
export interface UsageWindow {
  /** Usage percentage [0..100] */
  usagePercent: number;
  /** Seconds until usage resets */
  resetInSec: number;
  /** Remaining percentage [0..100] */
  percentRemaining: number;
  /** ISO reset timestamp */
  resetTimeIso: string;
}

/** Snapshot entry per OpenCode Go account - stored in tui-state.json. */
export interface OpenCodeGoUsageEntry {
  provider: 'opencode-go';
  /** Display name for this account (from config). */
  accountName: string;
  /** OpenCode Go workspace ID. */
  workspaceId: string;
  /** Rolling (~5h) usage window, when present. */
  rolling?: UsageWindow;
  /** Weekly usage window, when present. */
  weekly?: UsageWindow;
  /** Monthly usage window, when present. */
  monthly?: UsageWindow;
  /** Timestamp when data was fetched. */
  fetchedAt: number;
  /** Error message if the scrape failed for this account. */
  error?: string;
}

export interface NeuralwattBalance {
  credits_remaining_usd: number;
  total_credits_usd: number;
  credits_used_usd: number;
  accounting_method: string;
}

export interface NeuralwattUsagePeriod {
  cost_usd: number;
  requests: number;
  tokens: number;
  energy_kwh: number;
}

export interface NeuralwattUsage {
  lifetime: NeuralwattUsagePeriod;
  current_month: NeuralwattUsagePeriod;
}

export interface NeuralwattSubscription {
  plan: string;
  status: 'active' | 'canceling' | 'past_due' | 'paused' | 'trialing';
  billing_interval: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  auto_renew: boolean | null;
  kwh_included: number | null;
  kwh_used: number | null;
  kwh_remaining: number | null;
  in_overage: boolean | null;
}

/** Snapshot entry per Neuralwatt account - stored in tui-state.json. */
export interface NeuralwattUsageEntry {
  provider: 'neuralwatt';
  /** Display name for this account. */
  accountName: string;
  /** ISO timestamp from the API response. */
  snapshot_at: string;
  /** Credit balance. */
  balance: NeuralwattBalance;
  /** Usage data (lifetime + current month). */
  usage: NeuralwattUsage;
  /** Subscription details, null if no active subscription. */
  subscription: NeuralwattSubscription | null;
  /** Timestamp when data was fetched. */
  fetchedAt: number;
  /** Error message if the fetch failed. */
  error?: string;
}

export interface DeepSeekBalanceInfo {
  currency: 'CNY' | 'USD' | string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

/** Snapshot entry per DeepSeek account - stored in tui-state.json. */
export interface DeepSeekUsageEntry {
  provider: 'deepseek';
  accountName: string;
  fetchedAt: number;
  is_available: boolean;
  balance_infos: DeepSeekBalanceInfo[];
  error?: string;
}

export interface MiMoBalance {
  balance: string;
  frozenBalance: string;
  currency: string;
  overdraftLimit: string;
  remainingOverdraftLimit: string;
  giftBalance: string;
  cashBalance: string;
}

export interface MiMoPlanDetail {
  planCode: string;
  planName: string;
  currentPeriodEnd: string;
  expired: boolean;
  enableAutoRenew: boolean;
  autoRenewDiscount: unknown;
  hasAutoRenewSubscribed: boolean;
}

export interface MiMoUsageItem {
  name: string;
  used: number;
  limit: number;
  percent: number;
}

export interface MiMoUsageData {
  percent: number;
  items: MiMoUsageItem[];
}

/** Snapshot entry per MiMo account - stored in tui-state.json. */
export interface MiMoUsageEntry {
  provider: 'mimo';
  accountName: string;
  fetchedAt: number;
  error?: string;
  balance: MiMoBalance;
  planDetail: MiMoPlanDetail;
  monthUsage: MiMoUsageData;
  planUsage: MiMoUsageData;
}

export interface CodexUsageEntry {
  provider: 'codex';
  accountName: string;
  fetchedAt: number;
  error?: string;
  /** Primary usage window (5H for paid plans, 7D for free plans) */
  primaryWindow: UsageWindow;
  /** 7-day rolling window (secondary_window from API). Null for free plan users. */
  secondaryWindow: UsageWindow | null;
  /** Credit balance info */
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: number;
  };
  /** Plan type (e.g., "Plus", "Team", "Enterprise") */
  planType?: string;
}

export type SubscriptionUsageEntry =
  | OpenCodeGoUsageEntry
  | NeuralwattUsageEntry
  | DeepSeekUsageEntry
  | CodexUsageEntry
  | MiMoUsageEntry;

/** Detailed usage data from the /usage page. */
export interface UsageDetail {
  /** Total number of API calls. */
  totalCalls: number;
  /** Total estimated cost in USD. */
  totalCost: number;
  /** Per-model breakdown. */
  perModel: Array<{
    model: string;
    calls: number;
    cost: number;
  }>;
}

/** Config for the subscription tracking feature. */
export interface SubscriptionsConfig {
  /** Minimum interval between auto-refreshes in ms (default: 60000). */
  refreshIntervalMs: number;
}
