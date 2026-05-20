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
import {
  completeDeviceAuth,
  decodeCodexAccountId,
  initiateDeviceAuth,
  refreshCodexToken,
} from './codex-device-auth';
import { scrapeCodexQuota } from './codex-scraper';
import { scrapeNeuralwattQuota } from './neuralwatt-scraper';
import { scrapeQuota } from './opencode-go-scraper';
import { PROVIDERS, resolveProvider } from './provider';
import type {
  CodexAccount,
  NeuralwattAccount,
  OpenCodeGoAccount,
  SubscriptionProvider,
  SubscriptionUsageEntry,
} from './types';

const SUBSCRIPTIONS_COMMAND = 'subscriptions';
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_PERIODIC_INTERVAL_MS = 600_000; // 10 minutes
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const results = await Promise.allSettled(
        accounts.map(async (account) => {
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
            error: `Scrape failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          } as SubscriptionUsageEntry);
        }
      }

      // Persist to tui-state for the TUI sidebar to read
      recordSubscriptionUsage(entries);
      this.lastRefresh = Date.now();

      return entries;
    } finally {
      clearTimeout(timeout);
    }
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
      // Find matching auth entry — both 'api' and 'oauth' formats
      const entry = auth[provider];
      const key =
        entry?.type === 'oauth'
          ? ((entry as any).access ?? '')
          : (entry?.key ?? '');
      const match =
        typeof key === 'string' && key.length > 0
          ? accounts.find((account): boolean => {
              if (account.provider !== provider) return false;
              if (account.provider === 'codex')
                return account.accessToken === key;
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
        const [_, name, workspaceId, ...cookieParts] = parts;
        const authCookie = cookieParts.join(' ');
        if (!name || !workspaceId || !authCookie) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions add-opencode-go <name> <workspace-id> <auth-cookie>\n' +
                'Example: /subscriptions add-opencode-go personal wrk_xxx Fe26.2...',
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
        };
        saveAccount(account);
        // Auto-activate if no active account for this provider
        {
          const activeByProvider = this.syncActiveAccounts();
          const pKey: string = account.provider;
          if (!activeByProvider[pKey as SubscriptionProvider]) {
            try {
              const key: string =
                pKey === 'codex'
                  ? ((account as unknown as CodexAccount).accessToken ?? '')
                  : ((account as OpenCodeGoAccount | NeuralwattAccount)
                      .apiKey ?? '');
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
        // Auto-activate if no active account for this provider
        {
          const activeByProvider = this.syncActiveAccounts();
          const pKey: string = account.provider;
          if (!activeByProvider[pKey as SubscriptionProvider]) {
            try {
              const key: string =
                pKey === 'codex'
                  ? ((account as unknown as CodexAccount).accessToken ?? '')
                  : ((account as OpenCodeGoAccount | NeuralwattAccount)
                      .apiKey ?? '');
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
        }
        // Refresh to update sidebar immediately
        this.refresh(true).catch(() => {});
        output.parts.push(
          createInternalAgentTextPart(`✅ Added Neuralwatt account "${name}".`),
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
              // Auto-activate if no active account for this provider
              {
                const activeByProvider = this.syncActiveAccounts();
                const pKey: string = account.provider;
                if (!activeByProvider[pKey as SubscriptionProvider]) {
                  try {
                    if (pKey === 'codex') {
                      const codexAcct = account as unknown as CodexAccount;
                      const key = codexAcct.accessToken ?? '';
                      if (key) {
                        await this.client.auth.set({
                          path: { id: pKey },
                          body: {
                            type: 'oauth',
                            access: key,
                            refresh: codexAcct.refreshToken ?? '',
                            expires: codexAcct.expiresAt ?? 0,
                            accountId: codexAcct.accountId ?? '',
                          } as any,
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
        const [_, name] = parts;
        if (!name) {
          output.parts.push(
            createInternalAgentTextPart('Usage: /subscriptions remove <name>'),
          );
          return;
        }
        const account = getAccount(name);
        const activeByProvider = this.syncActiveAccounts();
        const removed = removeAccount(name);
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
            createInternalAgentTextPart(`Account "${name}" not found.`),
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
              'No accounts configured. Use /subscriptions add-opencode-go, /subscriptions add-neuralwatt, or /subscriptions add-codex-device to add one.',
            ),
          );
          return;
        }
        const lines = ['### Subscription Accounts', ''];
        for (const acct of accounts) {
          const isActive = activeByProvider[acct.provider] === acct.name;
          const star = isActive ? '★ ' : '  ';
          const providerLabel =
            acct.provider === 'opencode-go'
              ? 'OpenCode Go'
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
          '  /subscriptions add-opencode-go <name> <workspace-id> <auth-cookie>',
        );
        lines.push('  /subscriptions add-neuralwatt <name> <api-key>');
        lines.push('  /subscriptions add-codex-device <name>');
        lines.push('  /subscriptions remove <name>');
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
                'Providers: opencode-go (go), neuralwatt (nw), codex (cx)\n' +
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
        } else {
          if (!account.apiKey) {
            output.parts.push(
              createInternalAgentTextPart(
                `Account "${name}" has no API key set. Re-add with /subscriptions add-opencode-go <name> <workspace-id> <cookie>.`,
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
            await this.client.auth.set({
              path: { id: account.provider },
              body: {
                type: 'oauth',
                access: codexAccount.accessToken,
                refresh: codexAccount.refreshToken ?? '',
                expires: codexAccount.expiresAt ?? 0,
                accountId: codexAccount.accountId ?? '',
              } as any,
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
              '  /subscriptions add-opencode-go <name> <workspace-id> <auth-cookie>   Add an OpenCode Go account\n' +
              '  /subscriptions add-neuralwatt <name> <api-key>                       Add a Neuralwatt account\n' +
              '  /subscriptions add-codex-device <name>                               Add a Codex account (device auth)\n' +
              '  /subscriptions remove <name>                                         Remove an account\n' +
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
          'Manage subscription accounts (add-opencode-go, add-neuralwatt, add-codex-device, remove, list, switch, refresh)',
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
