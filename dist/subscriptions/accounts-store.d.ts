/**
 * Local file-based storage for subscription accounts.
 *
 * Stores account credentials in a local JSON file alongside tui-state.json,
 * NOT in the plugin config, so auth tokens are never committed to repos or
 * exposed in the published schema.
 *
 * Supports multiple providers (OpenCode Go, Neuralwatt) via discriminated
 * unions on the `provider` field.
 *
 */
import type { StoredAccount, SubscriptionProvider } from './types';
export type { StoredAccount };
export type LoadAccountsResult = {
    ok: true;
    accounts: StoredAccount[];
} | {
    ok: false;
    accounts: StoredAccount[];
};
declare function loadAccountsResult(): LoadAccountsResult;
/**
 * Load all stored accounts.
 */
export declare function loadAccounts(): StoredAccount[];
export { loadAccountsResult };
/**
 * Load accounts filtered by provider.
 */
export declare function getAccountsByProvider(provider: SubscriptionProvider): StoredAccount[];
/**
 * Add a new account. If an account with the same name already exists,
 * overwrites it (update).
 */
export declare function saveAccount(account: StoredAccount): void;
/**
 * Remove an account by name. Returns true if deleted, false if not found.
 */
export declare function removeAccount(name: string): boolean;
/**
 * Update the auth cookie for an existing OpenCode Go account.
 * Returns true if updated, false if account not found or not an opencode-go account.
 */
export declare function updateAccountCookie(name: string, authCookie: string): boolean;
/**
 * Mask an auth cookie for display (show first 8 + last 4 chars).
 */
export declare function maskCookie(cookie: string): string;
/**
 * Look up a stored account by name.
 */
export declare function getAccount(name: string): StoredAccount | undefined;
/**
 * Set the provider and API key for an existing account.
 * Returns true if updated, false if account not found.
 */
export declare function setAccountKey(name: string, provider: string, apiKey: string): boolean;
