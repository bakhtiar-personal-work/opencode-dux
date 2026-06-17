/**
 * Usage service for multi-provider subscription tracking.
 *
 * Manages account storage, refresh lifecycle, rate limiting, and the
 * /subscriptions slash command.
 *
 * Accounts are stored locally (not in plugin config) to keep auth tokens
 * out of version control and the published schema.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PluginInput } from '@opencode-ai/plugin';
import {
  recordActiveSubscriptionForProvider,
  recordSubscriptionUsage,
  removeSubscriptionUsageEntry,
} from '../tui-state';
import { createInternalAgentTextPart } from '../utils';
import {
  getAccount,
  loadAccounts,
  loadAccountsResult,
  maskCookie,
  removeAccount,
  type StoredAccount,
  saveAccount,
  updateCodexTokens,
  validateAccountName,
} from './accounts-store';
import { deriveActiveNames } from './active-state';
import {
  completeDeviceAuth,
  decodeCodexAccountId,
  initiateDeviceAuth,
  refreshCodexToken,
} from './codex-device-auth';
import { scrapeCodexQuota } from './codex-scraper';
import { scrapeDeepSeekBalance } from './deepseek-scraper';
import { scrapeMiMoUsage } from './mimo-scraper';
import { scrapeNeuralwattQuota } from './neuralwatt-scraper';
import { scrapeQuota } from './opencode-go-scraper';
import { PROVIDERS, resolveProvider } from './provider';
import type {
  CodexAccount,
  DeepSeekAccount,
  MiMoAccount,
  NeuralwattAccount,
  OpenCodeGoAccount,
  SubscriptionProvider,
  SubscriptionUsageEntry,
} from './types';

const SUBSCRIPTIONS_COMMAND = 'subscriptions';
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_PERIODIC_INTERVAL_MS = 600_000; // 10 minutes

type OAuthAuthEntry = {
  type: 'oauth';
  access?: string;
};

type OAuthAuthBody = {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
};

/** Classify an error from a scraper to produce a more descriptive message. */
function formatScrapeError(reason: unknown): string {
  if (reason instanceof Error) {
    if (reason.name === 'AbortError') {
      return 'Scrape request timed out - the provider API did not respond within 30 seconds.';
    }
    return `Scrape failed: ${reason.message}`;
  }
  return `Scrape failed: ${String(reason)}`;
}

function getApiKeyFromStoredAccount(
  account: OpenCodeGoAccount | NeuralwattAccount | DeepSeekAccount,
): string {
  return account.apiKey ?? '';
}

export class UsageService {
  private client: PluginInput['client'];
  private lastRefresh = 0;
  private pendingRefresh: Promise<SubscriptionUsageEntry[]> | null = null;
  private cached: SubscriptionUsageEntry[] = [];
  private refreshIntervalMs: number;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private periodicIntervalMs: number;

  constructor(
    client: PluginInput['client'],
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
    periodicIntervalMs = DEFAULT_PERIODIC_INTERVAL_MS,
  ) {
    this.client = client;
    this.refreshIntervalMs = refreshIntervalMs;
    this.periodicIntervalMs = periodicIntervalMs;
    this.startPeriodicRefresh();
  }

  /** Get accounts from local storage. */
  private getAccounts(): StoredAccount[] {
    return loadAccounts();
  }

  private getAccountsResult() {
    return loadAccountsResult();
  }

  /**
   * Refresh all accounts' usage data, respecting rate limit unless forced.
   * Returns the scraped results.
   */
  async refresh(force = false): Promise<SubscriptionUsageEntry[]> {
    const now = Date.now();
    if (!force && now - this.lastRefresh < this.refreshIntervalMs) {
      return this.cached;
    }

    // Deduplicate concurrent refresh calls
    if (this.pendingRefresh) {
      return this.pendingRefresh;
    }

    this.pendingRefresh = this._doRefresh();
    try {
      this.cached = await this.pendingRefresh;
      return this.cached;
    } finally {
      this.pendingRefresh = null;
    }
  }

  private async _doRefresh(): Promise<SubscriptionUsageEntry[]> {
    this.resetPeriodicTimer();
    const accountsResult = this.getAccountsResult();
    if (!accountsResult.ok) {
      return this.cached;
    }
    const accounts = accountsResult.accounts;

    if (accounts.length === 0) {
      recordSubscriptionUsage([]);
      this.lastRefresh = Date.now();
      return [];
    }

    const results = await Promise.allSettled(
      accounts.map(async (account) => {
        // Each provider gets its own AbortController so one slow response
        // doesn't abort every provider's request.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          if (account.provider === 'opencode-go') {
            if (!account.authCookie?.trim()) {
              return {
                provider: 'opencode-go',
                accountName: account.name,
                workspaceId: account.workspaceId,
                fetchedAt: Date.now(),
                error:
                  'Missing OpenCode Go cookie. Re-add with /subscriptions add-opencode-go.',
              } as SubscriptionUsageEntry;
            }
            if (!account.apiKey?.trim()) {
              return {
                provider: 'opencode-go',
                accountName: account.name,
                workspaceId: account.workspaceId,
                fetchedAt: Date.now(),
                error:
                  'Missing OpenCode Go API key. Re-add with /subscriptions add-opencode-go.',
              } as SubscriptionUsageEntry;
            }
            const entry = await scrapeQuota(
              account.workspaceId,
              account.authCookie,
              controller.signal,
            );
            entry.accountName = account.name;
            return entry as SubscriptionUsageEntry;
          } else if (account.provider === 'codex') {
            if (!account.accessToken?.trim()) {
              return {
                provider: 'codex',
                accountName: account.name,
                fetchedAt: Date.now(),
                error:
                  'Missing Codex access token. Re-add with /subscriptions add-codex-device.',
                primaryWindow: {
                  usagePercent: 0,
                  percentRemaining: 100,
                  resetInSec: 0,
                  resetTimeIso: '',
                },
                secondaryWindow: null,
                credits: {
                  hasCredits: false,
                  unlimited: false,
                  balance: 0,
                },
              } as SubscriptionUsageEntry;
            }
            // Proactive token refresh: if token expires within 5 min and
            // we have a refresh token, exchange it before scraping
            let accessToken = account.accessToken;
            if (
              account.refreshToken &&
              account.expiresAt &&
              Date.now() > account.expiresAt - 300_000
            ) {
              try {
                const refreshed = await refreshCodexToken(
                  account.refreshToken,
                  controller.signal,
                );
                updateCodexTokens(
                  account.name,
                  refreshed.accessToken,
                  refreshed.refreshToken,
                  refreshed.expiresAt,
                );
                accessToken = refreshed.accessToken;
              } catch {
                // Refresh failed - try with existing token, WHAM API
                // will return 401 if truly expired
              }
            }
            const entry = await scrapeCodexQuota(
              accessToken,
              controller.signal,
              account.accountId,
            );
            entry.accountName = account.name;
            return entry as SubscriptionUsageEntry;
          } else if (account.provider === 'deepseek') {
            if (!account.apiKey?.trim()) {
              return {
                provider: 'deepseek',
                accountName: account.name,
                fetchedAt: Date.now(),
                is_available: false,
                balance_infos: [],
                error:
                  'Missing DeepSeek API key. Re-add with /subscriptions add-deepseek.',
              } as SubscriptionUsageEntry;
            }
            const entry = await scrapeDeepSeekBalance(
              account.apiKey,
              controller.signal,
            );
            entry.accountName = account.name;
            return entry as SubscriptionUsageEntry;
          } else if (account.provider === 'mimo') {
            if (
              !account.platformPh?.trim() ||
              !account.serviceToken?.trim() ||
              !account.slh?.trim() ||
              !account.userId?.trim()
            ) {
              return {
                provider: 'mimo',
                accountName: account.name,
                fetchedAt: Date.now(),
                balance: {
                  balance: '0',
                  frozenBalance: '0',
                  currency: 'USD',
                  overdraftLimit: '0',
                  remainingOverdraftLimit: '0',
                  giftBalance: '0',
                  cashBalance: '0',
                },
                planDetail: {
                  planCode: '',
                  planName: '',
                  currentPeriodEnd: '',
                  expired: true,
                  enableAutoRenew: false,
                  autoRenewDiscount: null,
                  hasAutoRenewSubscribed: false,
                },
                monthUsage: { percent: 0, items: [] },
                planUsage: { percent: 0, items: [] },
                error:
                  'Missing MiMo cookie values. Re-add with /subscriptions add-mimo <name> <api-key> <platform_ph> <serviceToken> <slh> <userId>.',
              } as SubscriptionUsageEntry;
            }
            const entry = await scrapeMiMoUsage(
              account.name,
              account.platformPh,
              account.serviceToken,
              account.slh,
              account.userId,
              controller.signal,
            );
            entry.accountName = account.name;
            return entry as SubscriptionUsageEntry;
          } else {
            // neuralwatt
            if (!account.apiKey?.trim()) {
              return {
                provider: 'neuralwatt',
                accountName: account.name,
                fetchedAt: Date.now(),
                error:
                  'Missing Neuralwatt API key. Re-add with /subscriptions add-neuralwatt.',
              } as SubscriptionUsageEntry;
            }
            const entry = await scrapeNeuralwattQuota(
              account.apiKey,
              controller.signal,
            );
            entry.accountName = account.name;
            return entry as SubscriptionUsageEntry;
          }
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    const entries: SubscriptionUsageEntry[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        entries.push(result.value);
      } else {
        const account = accounts[i];
        entries.push({
          provider: account.provider,
          accountName: account.name,
          workspaceId:
            account.provider === 'opencode-go' ? account.workspaceId : '',
          fetchedAt: Date.now(),
          error: formatScrapeError(result.reason),
        } as SubscriptionUsageEntry);
      }
    }

    // Persist to tui-state for the TUI sidebar to read
    recordSubscriptionUsage(entries);
    this.lastRefresh = Date.now();

    return entries;
  }

  /**
   * Called when orchestrator goes idle - triggers a non-forced refresh.
   */
  onOrchestratorIdle(): void {
    // Sync active account from auth.json (handles external edits)
    this.syncActiveAccounts();
    // Fire-and-forget refresh (rate-limited internally)
    this.refresh(false).catch(() => {
      // Best-effort: errors are captured in the entries
    });
  }

  /**
   * Sync the active account by comparing stored API keys against
   * auth.json. If a stored account's apiKey matches the opencode-go
   * key in auth.json, that account is marked active. Otherwise active
   * is cleared. This keeps the sidebar accurate even if auth.json
   * was edited externally.
   */
  syncActiveAccounts(): Partial<Record<SubscriptionProvider, string>> {
    const authPath = path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'),
      'opencode',
      'auth.json',
    );

    let auth: Record<string, { type: string; key?: string; access?: string }> =
      {};
    try {
      const raw = fs.readFileSync(authPath, 'utf8');
      auth = JSON.parse(raw) as Record<
        string,
        { type: string; key?: string; access?: string }
      >;
    } catch {
      // auth.json doesn't exist or can't be read
    }

    const activeByProvider: Partial<Record<SubscriptionProvider, string>> = {};
    const accounts = this.getAccounts();
    for (const provider of PROVIDERS) {
      // Find matching auth entry - both 'api' and 'oauth' formats
      const entry = auth[provider];
      const key =
        entry?.type === 'oauth'
          ? ((entry as OAuthAuthEntry).access ?? '')
          : (entry?.key ?? '');
      const match =
        typeof key === 'string' && key.length > 0
          ? accounts.find((account): boolean => {
              if (account.provider !== provider) return false;
              if (account.provider === 'codex')
                return account.accessToken === key;
              if (account.provider === 'mimo') return account.apiKey === key;
              return account.apiKey === key;
            })
          : undefined;
      if (match) {
        activeByProvider[provider] = match.name;
        recordActiveSubscriptionForProvider(provider, match.name);
      } else {
        recordActiveSubscriptionForProvider(provider, null);
      }
    }
    return activeByProvider;
  }

  /**
   * Start the periodic background refresh timer.
   */
  private startPeriodicRefresh(): void {
    this.periodicTimer = setInterval(() => {
      this.refresh(false).catch(() => {
        // Best-effort: errors are captured in the entries
      });
    }, this.periodicIntervalMs);
    // Don't block Node exit
    if (this.periodicTimer && typeof this.periodicTimer.unref === 'function') {
      this.periodicTimer.unref();
    }
  }

  /**
   * Reset the periodic timer - called after any actual refresh to
   * restart the countdown.
   */
  private resetPeriodicTimer(): void {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    this.startPeriodicRefresh();
  }

  /**
   * Clean up the periodic timer. Call when the plugin is shutting down.
   */
  dispose(): void {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Handle slash command: /subscriptions.
   */
  async handleCommandExecuteBefore(
    input: {
      command: string;
      sessionID: string;
      arguments: string;
    },
    output: { parts: Array<{ type: string; text?: string }> },
  ): Promise<void> {
    if (input.command === SUBSCRIPTIONS_COMMAND) {
      await this.handleSubscriptionsCommand(input, output);
    }
  }

  private async handleSubscriptionsCommand(
    input: {
      command: string;
      sessionID: string;
      arguments: string;
    },
    output: { parts: Array<{ type: string; text?: string }> },
  ): Promise<void> {
    const args = input.arguments.trim();
    const parts = args.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    switch (subcommand) {
      case 'add-opencode-go':
      case 'add': {
        // 'add' defaults to opencode-go for backward compat
        const name = parts[1];
        const workspaceId = parts[2];
        const apiKey = parts.at(-1) ?? '';
        const authCookie = parts.slice(3, -1).join(' ');
        if (!name || !workspaceId || !authCookie || !apiKey) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions add-opencode-go <name> <workspace-id> <auth-cookie> <api-key>\n' +
                'Example: /subscriptions add-opencode-go personal wrk_xxx Fe26.2... sk-key',
            ),
          );
          return;
        }
        const nameValidation = validateAccountName(name);
        if (!nameValidation.valid) {
          output.parts.push(
            createInternalAgentTextPart(
              `❌ Invalid account name: ${nameValidation.error}`,
            ),
          );
          return;
        }
        const account: StoredAccount = {
          provider: 'opencode-go',
          name,
          workspaceId,
          authCookie,
          apiKey,
        };
        saveAccount(account);
        // Auto-activate: set this account as active for its provider
        {
          this.syncActiveAccounts();
          const pKey: string = account.provider;
          try {
            const key: string =
              pKey === 'codex'
                ? ((account as unknown as CodexAccount).accessToken ?? '')
                : ((account as OpenCodeGoAccount | NeuralwattAccount).apiKey ??
                  '');
            if (key) {
              await this.client.auth.set({
                path: { id: pKey },
                body: { type: 'api', key },
              });
              this.syncActiveAccounts();
            }
          } catch {
            // Non-fatal: account is saved but not activated
          }
        }
        // Refresh to update sidebar immediately
        this.refresh(true).catch(() => {});
        output.parts.push(
          createInternalAgentTextPart(
            `✅ Added OpenCode Go account "${name}".`,
          ),
        );
        break;
      }

      case 'add-neuralwatt': {
        const [_, name, ...keyParts] = parts;
        const apiKey = keyParts.join(' ');
        if (!name || !apiKey) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions add-neuralwatt <name> <api-key>\n' +
                'Example: /subscriptions add-neuralwatt my-neuralwatt sk-...',
            ),
          );
          return;
        }
        const nameValidation = validateAccountName(name);
        if (!nameValidation.valid) {
          output.parts.push(
            createInternalAgentTextPart(
              `❌ Invalid account name: ${nameValidation.error}`,
            ),
          );
          return;
        }
        const account: StoredAccount = {
          provider: 'neuralwatt',
          name,
          apiKey,
        };
        saveAccount(account);
        // Auto-activate: set this account as active for its provider
        {
          this.syncActiveAccounts();
          const pKey: string = account.provider;
          try {
            const key: string =
              pKey === 'codex'
                ? ((account as unknown as CodexAccount).accessToken ?? '')
                : ((account as OpenCodeGoAccount | NeuralwattAccount).apiKey ??
                  '');
            if (key) {
              await this.client.auth.set({
                path: { id: pKey },
                body: { type: 'api', key },
              });
              this.syncActiveAccounts();
            }
          } catch {
            // Non-fatal: account is saved but not activated
          }
        }
        // Refresh to update sidebar immediately
        this.refresh(true).catch(() => {});
        output.parts.push(
          createInternalAgentTextPart(`✅ Added Neuralwatt account "${name}".`),
        );
        break;
      }

      case 'add-deepseek': {
        const [_, name, ...keyParts] = parts;
        const apiKey = keyParts.join(' ');
        if (!name || !apiKey) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions add-deepseek <name> <api-key>\n' +
                'Example: /subscriptions add-deepseek my-deepseek sk-...',
            ),
          );
          return;
        }
        const nameValidation = validateAccountName(name);
        if (!nameValidation.valid) {
          output.parts.push(
            createInternalAgentTextPart(
              `❌ Invalid account name: ${nameValidation.error}`,
            ),
          );
          return;
        }
        const account: StoredAccount = {
          provider: 'deepseek',
          name,
          apiKey,
        };
        saveAccount(account);
        // Auto-activate: set this account as active for its provider
        {
          this.syncActiveAccounts();
          const pKey: string = account.provider;
          try {
            const key = getApiKeyFromStoredAccount(account);
            if (key) {
              await this.client.auth.set({
                path: { id: pKey },
                body: { type: 'api', key },
              });
              this.syncActiveAccounts();
            }
          } catch {
            // Non-fatal: account is saved but not activated
          }
        }
        this.refresh(true).catch(() => {});
        output.parts.push(
          createInternalAgentTextPart(`✅ Added DeepSeek account "${name}".`),
        );
        break;
      }

      case 'add-mimo': {
        const [_, name, apiKey, platformPh, serviceToken, slh, userId] = parts;
        if (
          !name ||
          !apiKey ||
          !platformPh ||
          !serviceToken ||
          !slh ||
          !userId
        ) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions add-mimo <name> <api-key> <platform_ph> <serviceToken> <slh> <userId>\n' +
                'Example: /subscriptions add-mimo my-mimo sk-xxx ph_value token_value slh_value uid_value',
            ),
          );
          return;
        }
        const nameValidation = validateAccountName(name);
        if (!nameValidation.valid) {
          output.parts.push(
            createInternalAgentTextPart(
              `❌ Invalid account name: ${nameValidation.error}`,
            ),
          );
          return;
        }
        const account: StoredAccount = {
          provider: 'mimo',
          name,
          apiKey,
          platformPh,
          serviceToken,
          slh,
          userId,
        };
        saveAccount(account);
        // Auto-activate: set this account as active for its provider
        {
          this.syncActiveAccounts();
          const pKey: string = account.provider;
          try {
            const key = (account as MiMoAccount).apiKey ?? '';
            if (key) {
              await this.client.auth.set({
                path: { id: pKey },
                body: { type: 'api', key },
              });
              this.syncActiveAccounts();
            }
          } catch {
            // Non-fatal: account is saved but not activated
          }
        }
        // Refresh to update sidebar immediately
        this.refresh(true).catch(() => {});
        output.parts.push(
          createInternalAgentTextPart(`✅ Added MiMo account "${name}".`),
        );
        break;
      }

      case 'add-codex-device': {
        const [_, name] = parts;
        if (!name) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions add-codex-device <name>\n' +
                'Example: /subscriptions add-codex-device my-codex',
            ),
          );
          return;
        }
        const nameValidation = validateAccountName(name);
        if (!nameValidation.valid) {
          output.parts.push(
            createInternalAgentTextPart(
              `❌ Invalid account name: ${nameValidation.error}`,
            ),
          );
          return;
        }
        try {
          const session = await initiateDeviceAuth();
          output.parts.push(
            createInternalAgentTextPart(
              '🔐 Codex Device Authorization\n\n' +
                `1. Open this URL in any browser:\n   ${session.verificationUrl}\n\n` +
                `2. Sign in with your ChatGPT account\n\n` +
                `3. Enter this one-time code:\n   ${session.userCode}\n\n` +
                '   ⏳ Waiting for authentication... (expires in 15:00)',
            ),
          );
          // Fire-and-forget: poll in the background so the user can
          // see the code immediately. Result shown via toast.
          completeDeviceAuth(session)
            .then(async (tokens) => {
              const accountId = decodeCodexAccountId(tokens.accessToken);
              const account: StoredAccount = {
                provider: 'codex',
                name,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                accountId: accountId ?? undefined,
                idToken: tokens.idToken,
              };
              saveAccount(account);
              // Auto-activate: set this account as active for its provider
              {
                this.syncActiveAccounts();
                const pKey: string = account.provider;
                try {
                  if (pKey === 'codex') {
                    const codexAcct = account as unknown as CodexAccount;
                    const key = codexAcct.accessToken ?? '';
                    if (key) {
                      const oauthBody: OAuthAuthBody = {
                        type: 'oauth',
                        access: key,
                        refresh: codexAcct.refreshToken ?? '',
                        expires: codexAcct.expiresAt ?? 0,
                        accountId: codexAcct.accountId ?? '',
                      };
                      await this.client.auth.set({
                        path: { id: pKey },
                        body: oauthBody,
                      });
                    }
                  } else {
                    const key =
                      (
                        account as unknown as
                          | OpenCodeGoAccount
                          | NeuralwattAccount
                      ).apiKey ?? '';
                    if (key) {
                      await this.client.auth.set({
                        path: { id: pKey },
                        body: { type: 'api', key },
                      });
                    }
                  }
                  this.syncActiveAccounts();
                } catch {
                  // Non-fatal: account is saved but not activated
                }
              }
              this.refresh(true).catch(() => {});
              this.client.tui
                .showToast({
                  body: {
                    title: 'Codex Account Added',
                    message: `✅ Added Codex account "${name}".`,
                    variant: 'success',
                    duration: 5000,
                  },
                })
                .catch(() => {});
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.client.tui
                .showToast({
                  body: {
                    title: 'Codex Auth Failed',
                    message: `❌ ${message}`,
                    variant: 'error',
                    duration: 10000,
                  },
                })
                .catch(() => {});
            });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          output.parts.push(
            createInternalAgentTextPart(
              `❌ Codex device auth failed: ${message}`,
            ),
          );
        }
        break;
      }

      case 'remove':
      case 'rm': {
        const [_, providerRaw, name] = parts;
        const provider = resolveProvider(providerRaw);
        if (!provider || !name) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions remove <provider> <name>\n' +
                'Providers: opencode-go, neuralwatt, deepseek, codex, mimo\n' +
                'Example: /subscriptions remove opencode-go personal',
            ),
          );
          return;
        }
        const account = getAccount(provider, name);
        const activeByProvider = this.syncActiveAccounts();
        const removed = removeAccount(provider, name);
        if (removed && account) {
          const wasActive = activeByProvider[account.provider] === name;
          if (wasActive) {
            output.parts.push(
              createInternalAgentTextPart(
                `✅ Removed account "${name}" (was active for ${account.provider}).`,
              ),
            );
          } else {
            output.parts.push(
              createInternalAgentTextPart(`✅ Removed account "${name}".`),
            );
          }
          // Clear sidebar entry immediately
          removeSubscriptionUsageEntry(account.provider, name);
          this.syncActiveAccounts();
        } else {
          output.parts.push(
            createInternalAgentTextPart(
              `Account "${name}" not found for provider "${provider}".`,
            ),
          );
        }
        break;
      }

      case 'list':
      case 'ls': {
        const accounts = this.getAccounts();
        const activeByProvider = this.syncActiveAccounts();
        if (accounts.length === 0) {
          output.parts.push(
            createInternalAgentTextPart(
              'No accounts configured. Use /subscriptions add-opencode-go, /subscriptions add-neuralwatt, /subscriptions add-deepseek, /subscriptions add-mimo, or /subscriptions add-codex-device to add one.',
            ),
          );
          return;
        }
        const activeNames = deriveActiveNames(activeByProvider);
        const lines = ['### Subscription Accounts', ''];
        for (const acct of accounts) {
          const isActive = activeNames.has(acct.name);
          const star = isActive ? '★ ' : '  ';
          const providerLabel =
            acct.provider === 'opencode-go'
              ? 'OpenCode Go'
              : acct.provider === 'deepseek'
                ? 'DeepSeek'
                : acct.provider === 'codex'
                  ? 'Codex'
                  : 'Neuralwatt';
          lines.push(`${star}${acct.name} (${providerLabel})`);
          if (acct.provider === 'opencode-go') {
            lines.push(`    workspace: ${acct.workspaceId}`);
            lines.push(`    cookie: ${maskCookie(acct.authCookie)}`);
          } else if (acct.provider === 'codex') {
            lines.push(`    access-token: ${maskCookie(acct.accessToken)}`);
            lines.push(
              `    refresh-token: ${acct.refreshToken ? '[set]' : '-'}`,
            );
          } else if (acct.provider === 'mimo') {
            lines.push(`    api-key: ${maskCookie(acct.apiKey)}`);
            lines.push(`    platform_ph: ${maskCookie(acct.platformPh)}`);
            lines.push(`    serviceToken: ${maskCookie(acct.serviceToken)}`);
            lines.push(`    slh: ${maskCookie(acct.slh)}`);
            lines.push(`    userId: ${maskCookie(acct.userId)}`);
          } else {
            lines.push(`    api-key: ${maskCookie(acct.apiKey)}`);
          }
          if (acct.provider === 'opencode-go' && acct.apiKey) {
            lines.push(`    provider-key: opencode-go (key set)`);
          }
        }
        lines.push('');
        lines.push('Active by provider:');
        for (const provider of PROVIDERS) {
          const activeName = activeByProvider[provider];
          lines.push(`  ${provider}: ${activeName ? `★ ${activeName}` : '-'}`);
        }
        lines.push('');
        lines.push('Commands:');
        lines.push(
          '  /subscriptions add-opencode-go <name> <workspace-id> <auth-cookie> <api-key>',
        );
        lines.push('  /subscriptions add-neuralwatt <name> <api-key>');
        lines.push('  /subscriptions add-deepseek <name> <api-key>');
        lines.push(
          '  /subscriptions add-mimo <name> <api-key> <platform_ph> <serviceToken> <slh> <userId>',
        );
        lines.push('  /subscriptions add-codex-device <name>');
        lines.push('  /subscriptions remove <provider> <name>');
        lines.push('  /subscriptions switch <provider> <name>');
        lines.push('  /subscriptions list');
        lines.push('  /subscriptions refresh');
        output.parts.push(createInternalAgentTextPart(lines.join('\n')));
        break;
      }

      case 'switch': {
        const [_, providerRaw, name] = parts;
        const provider = resolveProvider(providerRaw);
        if (!provider || !name) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions switch <provider> <name>\n' +
                'Providers: opencode-go, neuralwatt, deepseek, codex, mimo\n' +
                'Example: /subscriptions switch opencode-go personal',
            ),
          );
          return;
        }
        const account = this.getAccounts().find(
          (candidate) =>
            candidate.provider === provider && candidate.name === name,
        );
        if (!account) {
          output.parts.push(
            createInternalAgentTextPart(
              `Account "${name}" not found for provider "${provider}".`,
            ),
          );
          return;
        }
        if (account.provider === 'codex') {
          if (!account.accessToken) {
            output.parts.push(
              createInternalAgentTextPart(
                `Account "${name}" has no access token set. Use /subscriptions add-codex-device to re-add.`,
              ),
            );
            return;
          }
        } else if (account.provider === 'mimo') {
          if (!account.apiKey) {
            output.parts.push(
              createInternalAgentTextPart(
                `Account "${name}" has no API key set. Re-add with /subscriptions add-mimo <name> <api-key> <platform_ph> <serviceToken> <slh> <userId>.`,
              ),
            );
            return;
          }
        } else {
          if (!account.apiKey) {
            output.parts.push(
              createInternalAgentTextPart(
                account.provider === 'opencode-go'
                  ? `Account "${name}" has no API key set. Re-add with /subscriptions add-opencode-go <name> <workspace-id> <auth-cookie> <api-key>.`
                  : account.provider === 'deepseek'
                    ? `Account "${name}" has no API key set. Re-add with /subscriptions add-deepseek <name> <api-key>.`
                    : `Account "${name}" has no API key set. Re-add with /subscriptions add-neuralwatt <name> <api-key>.`,
              ),
            );
            return;
          }
        }
        const activeByProvider = this.syncActiveAccounts();
        // No-op if already active for this provider
        if (activeByProvider[account.provider] === name) {
          output.parts.push(
            createInternalAgentTextPart(
              `Account "${name}" is already active for ${account.provider}.`,
            ),
          );
          return;
        }
        try {
          // Write the API key to OpenCode auth.json via SDK's auth.set()
          if (account.provider === 'codex') {
            const codexAccount = account as CodexAccount;
            // Backfill accountId if missing (legacy accounts)
            if (!codexAccount.accountId) {
              const decodedId = decodeCodexAccountId(codexAccount.accessToken);
              if (decodedId) {
                saveAccount({ ...codexAccount, accountId: decodedId });
              }
            }
            const oauthBody: OAuthAuthBody = {
              type: 'oauth',
              access: codexAccount.accessToken,
              refresh: codexAccount.refreshToken ?? '',
              expires: codexAccount.expiresAt ?? 0,
              accountId: codexAccount.accountId ?? '',
            };
            await this.client.auth.set({
              path: { id: account.provider },
              body: oauthBody,
            });
          } else if (account.provider === 'mimo') {
            await this.client.auth.set({
              path: { id: account.provider },
              body: { type: 'api', key: account.apiKey ?? '' },
            });
          } else {
            await this.client.auth.set({
              path: { id: account.provider },
              body: { type: 'api', key: account.apiKey ?? '' },
            });
          }
        } catch {
          output.parts.push(
            createInternalAgentTextPart(
              '⚠ Failed to update auth. The key was not applied.',
            ),
          );
          return;
        }
        this.syncActiveAccounts();
        // Show restart toast
        this.client.tui
          .showToast({
            body: {
              title: 'Account Switched',
              message: `Switched to "${name}". Restart for new API key.`,
              variant: 'success',
              duration: 5000,
            },
          })
          .catch(() => {});
        output.parts.push(
          createInternalAgentTextPart(
            `✅ Switched ${account.provider} to account "${name}".`,
          ),
        );
        break;
      }

      case 'refresh': {
        await this.refresh(true);
        output.parts.push(
          createInternalAgentTextPart('✅ Refreshed all accounts.'),
        );
        break;
      }

      default: {
        output.parts.push(
          createInternalAgentTextPart(
            'Subscription Account Management\n\n' +
              'Commands:\n' +
              '  /subscriptions add-opencode-go <name> <workspace-id> <auth-cookie> <api-key>   Add an OpenCode Go account\n' +
              '  /subscriptions add-neuralwatt <name> <api-key>                       Add a Neuralwatt account\n' +
              '  /subscriptions add-deepseek <name> <api-key>                         Add a DeepSeek account\n' +
              '  /subscriptions add-mimo <name> <api-key> <platform_ph> <serviceToken> <slh> <userId>  Add a MiMo account\n' +
              '  /subscriptions add-codex-device <name>                               Add a Codex account (device auth)\n' +
              '  /subscriptions remove <provider> <name>                              Remove an account\n' +
              '  /subscriptions switch <provider> <name>                              Switch active account for provider\n' +
              '  /subscriptions list                                                  List all accounts\n' +
              '  /subscriptions refresh                                               Force refresh all',
          ),
        );
        break;
      }
    }
  }

  /**
   * Register /subscriptions command in OpenCode config.
   */
  registerCommand(opencodeConfig: Record<string, unknown>): void {
    const configCommand = opencodeConfig.command as
      | Record<string, unknown>
      | undefined;
    if (!opencodeConfig.command) {
      opencodeConfig.command = {};
    }

    if (!configCommand?.[SUBSCRIPTIONS_COMMAND]) {
      (opencodeConfig.command as Record<string, unknown>)[
        SUBSCRIPTIONS_COMMAND
      ] = {
        template:
          'Manage subscription accounts (add-opencode-go, add-neuralwatt, add-deepseek, add-mimo, add-codex-device, remove, list, switch, refresh)',
        description:
          'Add, remove, list, switch, or refresh subscription accounts for usage tracking in the sidebar',
      };
    }
  }
}

export function createUsageService(
  client: PluginInput['client'],
  refreshIntervalMs?: number,
  periodicIntervalMs?: number,
): UsageService {
  return new UsageService(client, refreshIntervalMs, periodicIntervalMs);
}
