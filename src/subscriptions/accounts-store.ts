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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { StoredAccount, SubscriptionProvider } from './types';

// Re-export for consumers
export type { StoredAccount };

interface AccountsFile {
  version: 2;
  accounts: StoredAccount[];
}

export type LoadAccountsResult =
  | { ok: true; accounts: StoredAccount[] }
  | { ok: false; accounts: StoredAccount[] };

const STATE_DIR = 'opencode-dux';
const ACCOUNTS_FILE = 'subscriptions.json';

function dataDir(): string {
  return (
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  );
}

function getAccountsPath(): string {
  return path.join(dataDir(), 'opencode', 'storage', STATE_DIR, ACCOUNTS_FILE);
}

function emptyFile(): AccountsFile {
  return { version: 2, accounts: [] };
}

function parseAccountsFile(value: string): AccountsFile | null {
  try {
    const parsed = JSON.parse(value) as Partial<AccountsFile>;
    if (parsed?.version === 2 && Array.isArray(parsed.accounts)) {
      return {
        version: 2,
        accounts: parsed.accounts,
      };
    }
  } catch {
    // Fall through to null
  }
  return null;
}

function writeAccountsFile(file: AccountsFile): void {
  try {
    const filePath = getAccountsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`);
  } catch {
    // Best-effort
  }
}

function loadAccountsResult(): LoadAccountsResult {
  const accountsPath = getAccountsPath();
  try {
    const parsed = parseAccountsFile(fs.readFileSync(accountsPath, 'utf8'));
    if (!parsed) return { ok: false, accounts: [] };
    return { ok: true, accounts: parsed.accounts };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, accounts: [] };
    }
    return { ok: false, accounts: [] };
  }
}

function readAccountsFile(): AccountsFile {
  const result = loadAccountsResult();
  if (!result.ok) return emptyFile();
  return { version: 2, accounts: result.accounts };
}

/**
 * Load all stored accounts.
 */
export function loadAccounts(): StoredAccount[] {
  return loadAccountsResult().accounts;
}

export { loadAccountsResult };

/**
 * Load accounts filtered by provider.
 */
export function getAccountsByProvider(
  provider: SubscriptionProvider,
): StoredAccount[] {
  return readAccountsFile().accounts.filter((a) => a.provider === provider);
}

/**
 * Add a new account. If an account with the same name already exists,
 * overwrites it (update).
 */
export function saveAccount(account: StoredAccount): void {
  const file = readAccountsFile();
  const existing = file.accounts.findIndex((a) => a.name === account.name);
  if (existing >= 0) {
    file.accounts[existing] = account;
  } else {
    file.accounts.push(account);
  }
  writeAccountsFile(file);
}

/**
 * Remove an account by name. Returns true if deleted, false if not found.
 */
export function removeAccount(name: string): boolean {
  const file = readAccountsFile();
  const index = file.accounts.findIndex((a) => a.name === name);
  if (index < 0) return false;
  file.accounts.splice(index, 1);
  writeAccountsFile(file);
  return true;
}

/**
 * Update the auth cookie for an existing OpenCode Go account.
 * Returns true if updated, false if account not found or not an opencode-go account.
 */
export function updateAccountCookie(name: string, authCookie: string): boolean {
  const file = readAccountsFile();
  const account = file.accounts.find((a) => a.name === name);
  if (!account || account.provider !== 'opencode-go') return false;
  account.authCookie = authCookie;
  writeAccountsFile(file);
  return true;
}

/**
 * Mask an auth cookie for display (show first 8 + last 4 chars).
 */
export function maskCookie(cookie: string): string {
  if (cookie.length <= 16) {
    return `${cookie.slice(0, 4)}...${cookie.slice(-4)}`;
  }
  return `${cookie.slice(0, 8)}...${cookie.slice(-4)}`;
}

/**
 * Look up a stored account by name.
 */
export function getAccount(name: string): StoredAccount | undefined {
  const file = readAccountsFile();
  return file.accounts.find((a) => a.name === name);
}

/**
 * Set the provider and API key for an existing account.
 * Returns true if updated, false if account not found.
 */
export function setAccountKey(
  name: string,
  provider: string,
  apiKey: string,
): boolean {
  const file = readAccountsFile();
  const account = file.accounts.find((a) => a.name === name);
  if (!account) return false;
  account.provider = provider as SubscriptionProvider;
  account.apiKey = apiKey;
  writeAccountsFile(file);
  return true;
}
