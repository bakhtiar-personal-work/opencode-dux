/**
 * Local file-based storage for subscription accounts.
 *
 * Stores account credentials in a local JSON file alongside tui-state.json,
 * NOT in the plugin config, so auth tokens are never committed to repos or
 * exposed in the published schema.
 *
 * Supports multiple providers (OpenCode Go, Neuralwatt, Codex) via
 * discriminated unions on the `provider` field.
 *
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  CodexAccount,
  StoredAccount,
  SubscriptionProvider,
} from './types';

// Re-export for consumers
export type { StoredAccount };

const ACCOUNT_NAME_REGEX = /^[a-zA-Z0-9_-]{1,12}$/;

/**
 * Validate an account name.
 * Rules: 1–12 chars, alphanumeric, dashes, and underscores only (no spaces, no other special chars).
 */
export function validateAccountName(
  name: string,
): { valid: true } | { valid: false; error: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Account name is required.' };
  }
  if (name.length > 12) {
    return {
      valid: false,
      error: `Account name must be 12 characters or fewer (got ${name.length}).`,
    };
  }
  if (!ACCOUNT_NAME_REGEX.test(name)) {
    return {
      valid: false,
      error:
        'Account name must be alphanumeric, dashes, or underscores only (no spaces or other special characters).',
    };
  }
  return { valid: true };
}

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
  const validation = validateAccountName(account.name);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
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
 * Update tokens for an existing Codex account.
 * Returns true if updated, false if account not found or not a codex account.
 */
export function updateCodexTokens(
  name: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): boolean {
  const file = readAccountsFile();
  const account = file.accounts.find((a) => a.name === name);
  if (!account || account.provider !== 'codex') return false;
  const codex = account as CodexAccount;
  codex.accessToken = accessToken;
  codex.refreshToken = refreshToken;
  codex.expiresAt = expiresAt;
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
