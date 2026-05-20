/**
 * Usage service for multi-provider subscription tracking.
 *
 * Manages account storage, refresh lifecycle, rate limiting, and the
 * /subscriptions slash command.
 *
 * Accounts are stored locally (not in plugin config) to keep auth tokens
 * out of version control and the published schema.
 */
import type { PluginInput } from '@opencode-ai/plugin';
import type { SubscriptionProvider, SubscriptionUsageEntry } from './types';
export declare class UsageService {
    private client;
    private lastRefresh;
    private pendingRefresh;
    private cached;
    private refreshIntervalMs;
    private periodicTimer;
    private periodicIntervalMs;
    constructor(client: PluginInput['client'], refreshIntervalMs?: number, periodicIntervalMs?: number);
    /** Get accounts from local storage. */
    private getAccounts;
    private getAccountsResult;
    /**
     * Refresh all accounts' usage data, respecting rate limit unless forced.
     * Returns the scraped results.
     */
    refresh(force?: boolean): Promise<SubscriptionUsageEntry[]>;
    private _doRefresh;
    /**
     * Called when orchestrator goes idle - triggers a non-forced refresh.
     */
    onOrchestratorIdle(): void;
    /**
     * Sync the active account by comparing stored API keys against
     * auth.json. If a stored account's apiKey matches the opencode-go
     * key in auth.json, that account is marked active. Otherwise active
     * is cleared. This keeps the sidebar accurate even if auth.json
     * was edited externally.
     */
    syncActiveAccounts(): Partial<Record<SubscriptionProvider, string>>;
    /**
     * Start the periodic background refresh timer.
     */
    private startPeriodicRefresh;
    /**
     * Reset the periodic timer - called after any actual refresh to
     * restart the countdown.
     */
    private resetPeriodicTimer;
    /**
     * Clean up the periodic timer. Call when the plugin is shutting down.
     */
    dispose(): void;
    /**
     * Handle slash command: /subscriptions.
     */
    handleCommandExecuteBefore(input: {
        command: string;
        sessionID: string;
        arguments: string;
    }, output: {
        parts: Array<{
            type: string;
            text?: string;
        }>;
    }): Promise<void>;
    private handleSubscriptionsCommand;
    /**
     * Register /subscriptions command in OpenCode config.
     */
    registerCommand(opencodeConfig: Record<string, unknown>): void;
}
export declare function createUsageService(client: PluginInput['client'], refreshIntervalMs?: number, periodicIntervalMs?: number): UsageService;
