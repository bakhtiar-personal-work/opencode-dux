import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getAccount,
  getAccountsByProvider,
  loadAccounts,
  loadAccountsResult,
  removeAccount,
  saveAccount,
} from './accounts-store';

let previousXdgDataHome: string | undefined;
let tempDir: string;

beforeEach(() => {
  previousXdgDataHome = process.env.XDG_DATA_HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omos-subscriptions-store-'));
  process.env.XDG_DATA_HOME = tempDir;
});

afterEach(() => {
  if (previousXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = previousXdgDataHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('accounts-store (subscriptions)', () => {
  test('saveAccount and loadAccounts for opencode-go', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });

    const accounts = loadAccounts();
    expect(accounts).toHaveLength(1);
    const acct = accounts[0];
    expect(acct.provider).toBe('opencode-go');
    expect(acct.name).toBe('personal');
    if (acct.provider === 'opencode-go') {
      expect(acct.workspaceId).toBe('wrk_123');
      expect(acct.authCookie).toBe('cookie-abc');
    }
  });

  test('saveAccount and loadAccounts for neuralwatt', () => {
    saveAccount({
      provider: 'neuralwatt',
      name: 'nwaccount',
      apiKey: 'sk-test-key',
    });

    const accounts = loadAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].provider).toBe('neuralwatt');
    expect(accounts[0].name).toBe('nwaccount');
    expect(accounts[0].apiKey).toBe('sk-test-key');
  });

  test('saveAccount overwrites existing account by name', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-old',
    });
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_456',
      authCookie: 'cookie-new',
    });

    const accounts = loadAccounts();
    expect(accounts).toHaveLength(1);
    const acct = accounts[0];
    if (acct.provider === 'opencode-go') {
      expect(acct.workspaceId).toBe('wrk_456');
      expect(acct.authCookie).toBe('cookie-new');
    }
  });

  test('saveAccount can change provider type for same name', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });
    saveAccount({
      provider: 'neuralwatt',
      name: 'personal',
      apiKey: 'sk-new-key',
    });

    const accounts = loadAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].provider).toBe('neuralwatt');
  });

  test('removeAccount removes by name', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });
    const removed = removeAccount('personal');
    expect(removed).toBe(true);
    expect(loadAccounts()).toHaveLength(0);
  });

  test('removeAccount returns false for unknown name', () => {
    const removed = removeAccount('nonexistent');
    expect(removed).toBe(false);
  });

  test('getAccount finds by name', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });
    const account = getAccount('personal');
    expect(account).toBeDefined();
    expect(account?.provider).toBe('opencode-go');
  });

  test('getAccount returns undefined for unknown name', () => {
    const account = getAccount('nonexistent');
    expect(account).toBeUndefined();
  });

  test('getAccountsByProvider filters by provider', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });
    saveAccount({
      provider: 'neuralwatt',
      name: 'nwaccount',
      apiKey: 'sk-test-key',
    });
    saveAccount({
      provider: 'opencode-go',
      name: 'work',
      workspaceId: 'wrk_456',
      authCookie: 'cookie-def',
    });

    const goAccounts = getAccountsByProvider('opencode-go');
    expect(goAccounts).toHaveLength(2);
    expect(goAccounts.every((a) => a.provider === 'opencode-go')).toBe(true);

    const nwAccounts = getAccountsByProvider('neuralwatt');
    expect(nwAccounts).toHaveLength(1);
    expect(nwAccounts[0].name).toBe('nwaccount');
  });

  test('loadAccountsResult reports parse failures', () => {
    const storageDir = path.join(
      tempDir,
      'opencode',
      'storage',
      'opencode-dux',
    );
    fs.mkdirSync(storageDir, { recursive: true });
    const subscriptionsPath = path.join(storageDir, 'subscriptions.json');
    fs.writeFileSync(subscriptionsPath, '{ malformed json');

    const result = loadAccountsResult();
    expect(result.ok).toBe(false);
    expect(result.accounts).toEqual([]);
  });

  test('loadAccountsResult accepts current version schema', () => {
    const storageDir = path.join(
      tempDir,
      'opencode',
      'storage',
      'opencode-dux',
    );
    fs.mkdirSync(storageDir, { recursive: true });

    const newPath = path.join(storageDir, 'subscriptions.json');
    fs.writeFileSync(
      newPath,
      JSON.stringify({
        version: 2,
        accounts: [
          {
            provider: 'neuralwatt',
            name: 'new-account',
            apiKey: 'sk-new',
          },
        ],
      }),
    );

    const result = loadAccountsResult();
    expect(result.ok).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].name).toBe('new-account');
    expect(result.accounts[0].provider).toBe('neuralwatt');
  });
});
