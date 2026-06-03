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

  test('saveAccount keeps separate accounts for same name different providers', () => {
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
    expect(accounts).toHaveLength(2);
    const goAccounts = accounts.filter((a) => a.provider === 'opencode-go');
    const nwAccounts = accounts.filter((a) => a.provider === 'neuralwatt');
    expect(goAccounts).toHaveLength(1);
    expect(goAccounts[0].name).toBe('personal');
    expect(nwAccounts).toHaveLength(1);
    expect(nwAccounts[0].name).toBe('personal');
  });

  test('saveAccount overwrites same provider+name combination', () => {
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

  test('saveAccount does not overwrite same name across different providers', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'Main',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });
    saveAccount({
      provider: 'neuralwatt',
      name: 'Main',
      apiKey: 'sk-neuralwatt',
    });
    saveAccount({
      provider: 'codex',
      name: 'Main',
      accessToken: 'cx-token',
    });
    saveAccount({
      provider: 'deepseek',
      name: 'Main',
      apiKey: 'sk-deepseek',
    });

    const accounts = loadAccounts();
    // All four "Main" accounts should coexist since they're different providers
    const providers = accounts.map((a) => a.provider).sort();
    expect(providers).toEqual([
      'codex',
      'deepseek',
      'neuralwatt',
      'opencode-go',
    ]);
    // Verify each account belongs to the right provider
    const goAccount = getAccount('opencode-go', 'Main');
    expect(goAccount).toBeDefined();
    expect((goAccount as any).authCookie).toBe('cookie-abc');
    const nwAccount = getAccount('neuralwatt', 'Main');
    expect(nwAccount).toBeDefined();
    expect((nwAccount as any).apiKey).toBe('sk-neuralwatt');
    const cxAccount = getAccount('codex', 'Main');
    expect(cxAccount).toBeDefined();
    expect((cxAccount as any).accessToken).toBe('cx-token');
    const dsAccount = getAccount('deepseek', 'Main');
    expect(dsAccount).toBeDefined();
    expect((dsAccount as any).apiKey).toBe('sk-deepseek');
  });

  test('removeAccount removes only the matching provider+name pair', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'Main',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });
    saveAccount({
      provider: 'neuralwatt',
      name: 'Main',
      apiKey: 'sk-neuralwatt',
    });

    // Remove only the opencode-go "Main" account
    const removed = removeAccount('opencode-go', 'Main');
    expect(removed).toBe(true);

    const accounts = loadAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].provider).toBe('neuralwatt');
    expect(accounts[0].name).toBe('Main');
  });

  test('removeAccount removes by provider and name', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });
    const removed = removeAccount('opencode-go', 'personal');
    expect(removed).toBe(true);
    expect(loadAccounts()).toHaveLength(0);
  });

  test('removeAccount returns false for unknown name', () => {
    const removed = removeAccount('opencode-go', 'nonexistent');
    expect(removed).toBe(false);
  });

  test('getAccount finds by provider and name', () => {
    saveAccount({
      provider: 'opencode-go',
      name: 'personal',
      workspaceId: 'wrk_123',
      authCookie: 'cookie-abc',
    });
    const account = getAccount('opencode-go', 'personal');
    expect(account).toBeDefined();
    expect(account?.provider).toBe('opencode-go');
  });

  test('getAccount returns undefined for unknown name', () => {
    const account = getAccount('opencode-go', 'nonexistent');
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
