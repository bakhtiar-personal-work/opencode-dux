import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readTuiSnapshot } from '../tui-state';
import { UsageService } from './usage-service';

let previousXdgDataHome: string | undefined;
let tempDir: string;

function getStorageDir(): string {
  return path.join(tempDir, 'opencode', 'storage', 'opencode-dux');
}

function getSubscriptionsPath(): string {
  return path.join(getStorageDir(), 'subscriptions.json');
}

function getAuthPath(): string {
  return path.join(tempDir, 'opencode', 'auth.json');
}

function writeSubscriptions(raw: unknown): void {
  fs.mkdirSync(getStorageDir(), { recursive: true });
  fs.writeFileSync(getSubscriptionsPath(), `${JSON.stringify(raw, null, 2)}\n`);
}

function createUsageService(options?: {
  authSet?: (input: unknown) => Promise<void>;
}): UsageService {
  const client = {
    auth: {
      set: options?.authSet ?? (async () => undefined),
    },
    tui: {
      showToast: async () => undefined,
    },
  } as unknown as import('@opencode-ai/plugin').PluginInput['client'];
  return new UsageService(client, 60_000, 600_000);
}

beforeEach(() => {
  previousXdgDataHome = process.env.XDG_DATA_HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omos-usage-service-'));
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

describe('usage-service', () => {
  test('creates explicit sidebar error for faulty OpenCode Go credentials', async () => {
    writeSubscriptions({
      version: 2,
      accounts: [
        {
          provider: 'opencode-go',
          name: 'broken-go',
          workspaceId: 'wrk_123',
          authCookie: '',
          apiKey: '',
        },
      ],
    });

    const service = createUsageService();
    const entries = await service.refresh(true);
    service.dispose();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.accountName).toBe('broken-go');
    expect(entries[0]?.error).toContain('Missing OpenCode Go cookie');

    const snapshot = readTuiSnapshot();
    const usage = Object.values(snapshot.subscriptionUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]?.accountName).toBe('broken-go');
    expect(usage[0]?.error).toContain('Missing OpenCode Go cookie');
  });

  test('syncActiveAccounts resolves active names per provider from auth.json', () => {
    writeSubscriptions({
      version: 2,
      accounts: [
        {
          provider: 'opencode-go',
          name: 'go-main',
          workspaceId: 'wrk_123',
          authCookie: 'cookie',
          apiKey: 'go-key',
        },
        {
          provider: 'neuralwatt',
          name: 'nw-main',
          apiKey: 'nw-key',
        },
      ],
    });

    fs.mkdirSync(path.dirname(getAuthPath()), { recursive: true });
    fs.writeFileSync(
      getAuthPath(),
      `${JSON.stringify(
        {
          'opencode-go': { type: 'api', key: 'go-key' },
          neuralwatt: { type: 'api', key: 'nw-key' },
        },
        null,
        2,
      )}\n`,
    );

    const service = createUsageService();
    const active = service.syncActiveAccounts();
    service.dispose();

    expect(active['opencode-go']).toBe('go-main');
    expect(active.neuralwatt).toBe('nw-main');
    const snapshot = readTuiSnapshot();
    expect(snapshot.activeSubscriptionByProvider['opencode-go']).toBe(
      'go-main',
    );
    expect(snapshot.activeSubscriptionByProvider.neuralwatt).toBe('nw-main');
  });

  test('failed account-file read does not poison next non-forced refresh', async () => {
    fs.mkdirSync(getStorageDir(), { recursive: true });
    fs.writeFileSync(getSubscriptionsPath(), '{ malformed json');

    const service = createUsageService();
    const first = await service.refresh(false);
    expect(first).toEqual([]);

    writeSubscriptions({
      version: 2,
      accounts: [
        {
          provider: 'opencode-go',
          name: 'needs-key',
          workspaceId: 'wrk_123',
          authCookie: 'cookie',
        },
      ],
    });

    const second = await service.refresh(false);
    service.dispose();

    expect(second).toHaveLength(1);
    expect(second[0]?.accountName).toBe('needs-key');
    expect(second[0]?.error).toContain('Missing OpenCode Go API key');
  });

  test('switch requires provider and selects matching account', async () => {
    writeSubscriptions({
      version: 2,
      accounts: [
        {
          provider: 'opencode-go',
          name: 'Main',
          workspaceId: 'wrk_123',
          authCookie: 'cookie',
          apiKey: 'go-main-key',
        },
        {
          provider: 'neuralwatt',
          name: 'Main',
          apiKey: 'nw-main-key',
        },
      ],
    });

    const authSetCalls: unknown[] = [];
    const service = createUsageService({
      authSet: async (input) => {
        authSetCalls.push(input);
      },
    });
    const output = { parts: [] as Array<{ type: string; text?: string }> };
    await service.handleCommandExecuteBefore(
      {
        command: 'subscriptions',
        sessionID: 'ses_test',
        arguments: 'switch neuralwatt Main',
      },
      output,
    );
    service.dispose();

    expect(authSetCalls).toHaveLength(1);
    expect(authSetCalls[0]).toEqual({
      path: { id: 'neuralwatt' },
      body: { type: 'api', key: 'nw-main-key' },
    });
  });
});
