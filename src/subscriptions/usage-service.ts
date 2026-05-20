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
  setAccountKey,
  updateAccountCookie,
} from './accounts-store';
import { scrapeCodexQuota } from './codex-scraper';
import { scrapeNeuralwattQuota } from './neuralwatt-scraper';
import { scrapeQuota } from './opencode-go-scraper';
import type { SubscriptionProvider, SubscriptionUsageEntry } from './types';

const SUBSCRIPTIONS_COMMAND = 'subscriptions';
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_PERIODIC_INTERVAL_MS = 600_000; // 10 minutes
const PROVIDERS: SubscriptionProvider[] = ['opencode-go', 'neuralwatt', 'codex'];

function parseProvider(
  raw: string | undefined,
): SubscriptionProvider | undefined {
  if (raw === 'opencode-go' || raw === 'neuralwatt' || raw === 'codex') return raw;
  return undefined;
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
                  'Missing OpenCode Go cookie. Re-add with /subscriptions add-opencode-go or update via /subscriptions edit.',
              } as SubscriptionUsageEntry;
            }
            if (!account.apiKey?.trim()) {
              return {
                provider: 'opencode-go',
                accountName: account.name,
                workspaceId: account.workspaceId,
                fetchedAt: Date.now(),
                error:
                  'Missing OpenCode Go API key. Run /subscriptions set-key <name> <api-key>.',
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
                  'Missing Codex access token. Re-add with /subscriptions add-codex.',
                primaryWindow: {
                  usagePercent: 0,
                  percentRemaining: 100,
                  resetInSec: 0,
                  resetTimeIso: '',
                },
                secondaryWindow: {
                  usagePercent: 0,
                  percentRemaining: 100,
                  resetInSec: 0,
                  resetTimeIso: '',
                },
                credits: { hasCredits: false, unlimited: false, balance: 0 },
              } as SubscriptionUsageEntry;
            }
            const entry = await scrapeCodexQuota(
              account.accessToken,
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

    let auth: Record<string, { type: string; key?: string }> = {};
    try {
      const raw = fs.readFileSync(authPath, 'utf8');
      auth = JSON.parse(raw) as Record<string, { type: string; key?: string }>;
    } catch {
      // auth.json doesn't exist or can't be read
    }

    const activeByProvider: Partial<Record<SubscriptionProvider, string>> = {};
    const accounts = this.getAccounts();
    for (const provider of PROVIDERS) {
      const key = auth[provider]?.key;
      const match =
        typeof key === 'string' && key.length > 0
          ? accounts.find((account): boolean => {
              if (account.provider !== provider) return false;
              if (account.provider === 'codex') return account.accessToken === key;
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
        saveAccount({
          provider: 'opencode-go',
          name,
          workspaceId,
          authCookie,
        });
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
        saveAccount({ provider: 'neuralwatt', name, apiKey });
        // Refresh to update sidebar immediately
        this.refresh(true).catch(() => {});
        output.parts.push(
          createInternalAgentTextPart(`✅ Added Neuralwatt account "${name}".`),
        );
        break;
      }

      case 'add-codex': {
        const [_, name, ...tokenParts] = parts;
        const accessToken = tokenParts.join(' ');
        if (!name || !accessToken) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions add-codex <name> <access-token>\n' +
                'Example: /subscriptions add-codex my-codex eyJhbGci...',
            ),
          );
          return;
        }
        saveAccount({ provider: 'codex', name, accessToken });
        this.refresh(true).catch(() => {});
        output.parts.push(
          createInternalAgentTextPart(`✅ Added Codex account "${name}".`),
        );
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

      case 'edit': {
        const [_, name, ...cookieParts] = parts;
        const authCookie = cookieParts.join(' ');
        if (!name || !authCookie) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions edit <name> <new-auth-cookie>',
            ),
          );
          return;
        }
        const updated = updateAccountCookie(name, authCookie);
        if (updated) {
          output.parts.push(
            createInternalAgentTextPart(
              `✅ Updated auth cookie for "${name}".`,
            ),
          );
          this.refresh(true).catch(() => {});
        } else {
          output.parts.push(
            createInternalAgentTextPart(
              `Account "${name}" not found or is not an OpenCode Go account.`,
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
              'No accounts configured. Use /subscriptions add-opencode-go, /subscriptions add-neuralwatt, or /subscriptions add-codex to add one.',
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
        lines.push('  /subscriptions add-codex <name> <access-token>');
        lines.push('  /subscriptions remove <name>');
        lines.push('  /subscriptions edit <name> <new-auth-cookie>');
        lines.push('  /subscriptions set-key <name> <api-key>');
        lines.push('  /subscriptions switch <provider> <name>');
        lines.push('  /subscriptions list');
        lines.push('  /subscriptions refresh');
        output.parts.push(createInternalAgentTextPart(lines.join('\n')));
        break;
      }

      case 'set-key': {
        const [_, name, ...keyParts] = parts;
        const apiKey = keyParts.join(' ');
        if (!name || !apiKey) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions set-key <name> <api-key>\n' +
                'Example: /subscriptions set-key personal sk-...\n' +
                'After setting a key, use /subscriptions switch <provider> <name> to activate it.',
            ),
          );
          return;
        }
        const account = getAccount(name);
        const provider = account?.provider ?? 'opencode-go';
        const updated = setAccountKey(name, provider, apiKey);
        if (updated) {
          output.parts.push(
            createInternalAgentTextPart(
              `✅ Set API key for "${name}". Use /subscriptions switch <provider> ${name} to activate.`,
            ),
          );
        } else {
          output.parts.push(
            createInternalAgentTextPart(`Account "${name}" not found.`),
          );
        }
        break;
      }

      case 'switch': {
        const [_, providerRaw, name] = parts;
        const provider = parseProvider(providerRaw);
        if (!provider || !name) {
          output.parts.push(
            createInternalAgentTextPart(
              'Usage: /subscriptions switch <provider> <name>\n' +
                'Providers: opencode-go, neuralwatt, codex\n' +
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
                `Account "${name}" has no access token set. Use /subscriptions add-codex to re-add.`,
              ),
            );
            return;
          }
        } else {
          if (!account.apiKey) {
            output.parts.push(
              createInternalAgentTextPart(
                `Account "${name}" has no API key set. Use /subscriptions set-key ${name} <api-key> first.`,
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
          const key: string =
            account.provider === 'codex'
              ? account.accessToken
              : (account.apiKey ?? '');
          await this.client.auth.set({
            path: { id: account.provider },
            body: { type: 'api', key },
          });
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
              '  /subscriptions add-neuralwatt <name> <api-key>                        Add a Neuralwatt account\n' +
              '  /subscriptions add-codex <name> <access-token>                        Add a Codex account\n' +
              '  /subscriptions remove <name>                                          Remove an account\n' +
              '  /subscriptions edit <name> <new-auth-cookie>                         Update auth cookie (OpenCode Go)\n' +
              '  /subscriptions set-key <name> <api-key>                               Set API key for switching\n' +
              '  /subscriptions switch <provider> <name>                               Switch active account for provider\n' +
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
          'Manage subscription accounts (add-opencode-go, add-neuralwatt, add-codex, remove, list, edit, set-key, switch, refresh)',
        description:
          'Add, remove, list, edit, set-key, switch, or refresh subscription accounts for usage tracking in the sidebar',
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
