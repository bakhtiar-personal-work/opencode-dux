/**
 * Multi-provider subscription tracking module.
 *
 * Provides account management (local storage), provider-specific scrapers,
 * caching, and slash-command support for subscription usage data displayed
 * in the TUI sidebar and via /subscriptions command.
 */

export type { StoredAccount } from './accounts-store';
export {
  getAccount,
  getAccountsByProvider,
  loadAccounts,
  loadAccountsResult,
  maskCookie,
  removeAccount,
  saveAccount,
  validateAccountName,
} from './accounts-store';
export { scrapeCodexQuota } from './codex-scraper';
export { scrapeNeuralwattQuota } from './neuralwatt-scraper';
export { scrapeQuota, scrapeUsagePage } from './opencode-go-scraper';
export {
  formatProviderLabel,
  PROVIDERS,
  resolveProvider,
  tuiProviderLabel,
} from './provider';
export type {
  CodexUsageEntry,
  NeuralwattUsageEntry,
  OpenCodeGoUsageEntry,
  SubscriptionUsageEntry,
  UsageDetail,
  UsageWindow,
} from './types';
export { createUsageService, UsageService } from './usage-service';
