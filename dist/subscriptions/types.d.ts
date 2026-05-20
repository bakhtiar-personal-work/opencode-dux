/**
 * Type definitions for multi-provider subscription usage tracking.
 *
 * Supports OpenCode Go (dashboard scraping) and Neuralwatt (REST API)
 * as discriminated unions on the `provider` field.
 */
/** Provider discriminator. */
export type SubscriptionProvider = 'opencode-go' | 'neuralwatt';
export interface OpenCodeGoAccount {
    provider: 'opencode-go';
    name: string;
    workspaceId: string;
    authCookie: string;
    apiKey?: string;
}
export interface NeuralwattAccount {
    provider: 'neuralwatt';
    name: string;
    apiKey: string;
}
export type StoredAccount = OpenCodeGoAccount | NeuralwattAccount;
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
export type SubscriptionUsageEntry = OpenCodeGoUsageEntry | NeuralwattUsageEntry;
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
