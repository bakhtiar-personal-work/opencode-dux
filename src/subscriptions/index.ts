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
  setAccountKey,
  updateAccountCookie,
} from './accounts-store';
export { scrapeNeuralwattQuota } from './neuralwatt-scraper';
export { scrapeQuota, scrapeUsagePage } from './opencode-go-scraper';
export type {
  NeuralwattUsageEntry,
  OpenCodeGoUsageEntry,
  SubscriptionUsageEntry,
  UsageDetail,
  UsageWindow,
} from './types';
export { createUsageService, UsageService } from './usage-service';
