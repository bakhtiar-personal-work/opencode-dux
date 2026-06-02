import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const logMock = mock(() => {});

const checkerMocks = {
  extractChannel: mock(() => 'latest'),
  findPluginEntry: mock(() => null),
  getCachedVersion: mock(() => null),
  getLatestVersion: mock(async () => null),
  getLocalDevVersion: mock(() => null),
  getCurrentRuntimePackageJsonPath: mock(() => null),
};

const cacheMocks = {
  preparePackageUpdate: mock(() => '/tmp/opencode'),
  resolveInstallContext: mock(() => ({ installDir: '/tmp/opencode' })),
};

const versionStoreMocks = {
  writeVersionCache: mock(() => {}),
};

const crossSpawnMock = mock((_command: string[]) => ({
  exited: Promise.resolve(0),
  exitCode: 0,
  kill: mock(() => true),
  stdout: () => Promise.resolve(''),
  stderr: () => Promise.resolve(''),
  proc: {} as never,
}));

mock.module('../../utils/logger', () => ({
  log: logMock,
}));

mock.module('./checker', () => checkerMocks);

mock.module('./cache', () => cacheMocks);

mock.module('../../version-store', () => versionStoreMocks);

mock.module('../../utils/compat', () => ({
  crossSpawn: crossSpawnMock,
  crossWrite: mock(() => Promise.resolve()),
  isBun: false,
}));

let importCounter = 0;

function createCtx() {
  return {
    ctx: {
      directory: '/test',
      client: {
        tui: {
          showToast: mock(() => Promise.resolve(undefined)),
        },
        app: {
          log: mock(() => Promise.resolve(undefined)),
        },
      },
    },
  };
}

async function waitForCalls(
  fn: { mock: { calls: unknown[] } },
  minCalls = 1,
): Promise<void> {
  const deadline = Date.now() + 1000;

  while (fn.mock.calls.length < minCalls) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for async hook work');
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('auto-update-checker/index', () => {
  beforeEach(() => {
    logMock.mockClear();

    checkerMocks.extractChannel.mockReset();
    checkerMocks.extractChannel.mockImplementation(() => 'latest');
    checkerMocks.findPluginEntry.mockReset();
    checkerMocks.findPluginEntry.mockImplementation(() => null);
    checkerMocks.getCachedVersion.mockReset();
    checkerMocks.getCachedVersion.mockImplementation(() => null);
    checkerMocks.getLatestVersion.mockReset();
    checkerMocks.getLatestVersion.mockImplementation(async () => null);
    checkerMocks.getLocalDevVersion.mockReset();
    checkerMocks.getLocalDevVersion.mockImplementation(() => null);

    cacheMocks.preparePackageUpdate.mockReset();
    cacheMocks.preparePackageUpdate.mockImplementation(() => '/tmp/opencode');
    cacheMocks.resolveInstallContext.mockReset();
    cacheMocks.resolveInstallContext.mockImplementation(() => ({
      installDir: '/tmp/opencode',
    }));

    crossSpawnMock.mockReset();
    crossSpawnMock.mockImplementation(() => ({
      exited: Promise.resolve(0),
      exitCode: 0,
      kill: mock(() => true),
      stdout: () => Promise.resolve(''),
      stderr: () => Promise.resolve(''),
      proc: {} as never,
    }));
  });

  afterEach(() => {
    // Mocks are automatically cleared by Bun's test runner between tests
  });

  test('uses resolved install root for auto-update installs', async () => {
    const { getAutoUpdateInstallDir } = await import(
      `./index?test=${importCounter++}`
    );

    expect(getAutoUpdateInstallDir()).toBe('/tmp/opencode');
  });

  test('prefers npm-cli from the active runtime when available', async () => {
    const { resolveNpmInstallCommand } = await import(
      `./index?test=${importCounter++}`
    );

    const command = resolveNpmInstallCommand(
      'win32',
      'C:\\Program Files\\nodejs\\node.exe',
      (candidate) =>
        candidate ===
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    );

    expect(command).toEqual([
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      'install',
    ]);
  });

  test('falls back to npm.cmd on Windows when npm-cli cannot be resolved', async () => {
    const { resolveNpmInstallCommand } = await import(
      `./index?test=${importCounter++}`
    );

    const command = resolveNpmInstallCommand(
      'win32',
      'C:\\Program Files\\nodejs\\node.exe',
      () => false,
    );

    expect(command).toEqual(['npm.cmd', 'install']);
  });

  test('skips background update for local dev installs without logs', async () => {
    checkerMocks.getLocalDevVersion.mockImplementation(() => '0.9.11-dev');

    const { createAutoUpdateCheckerHook } = await import(
      `./index?test=${importCounter++}`
    );
    const { ctx } = createCtx();

    const hook = createAutoUpdateCheckerHook(ctx as never);
    hook.event({ event: { type: 'session.created', properties: {} } });
    await waitForCalls(logMock);

    expect(checkerMocks.findPluginEntry).not.toHaveBeenCalled();
    expect(checkerMocks.getLatestVersion).not.toHaveBeenCalled();
  });

  test('logs success message after updating the active install root', async () => {
    checkerMocks.findPluginEntry.mockImplementation(() => ({
      pinnedVersion: null,
      isPinned: false,
    }));
    checkerMocks.getCachedVersion.mockImplementation(() => '0.9.1');
    checkerMocks.getLatestVersion.mockImplementation(async () => '0.9.11');

    crossSpawnMock.mockImplementation(() => ({
      exited: Promise.resolve(0),
      exitCode: 0,
      kill: mock(() => true),
      stdout: () => Promise.resolve(''),
      stderr: () => Promise.resolve(''),
      proc: {} as never,
    }));

    const { createAutoUpdateCheckerHook } = await import(
      `./index?test=${importCounter++}`
    );
    const { ctx } = createCtx();
    const showToast = ctx.client.tui.showToast;

    const hook = createAutoUpdateCheckerHook(ctx as never);
    hook.event({ event: { type: 'session.created', properties: {} } });
    await waitForCalls(logMock, 2);

    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: 'Updating Plugin',
          message: 'opencode-dux is updating to v0.9.11',
        }),
      }),
    );
    expect(cacheMocks.preparePackageUpdate).toHaveBeenCalledWith(
      '0.9.11',
      'opencode-dux',
    );
    expect(crossSpawnMock).toHaveBeenCalledWith(
      expect.arrayContaining(['install']),
      expect.objectContaining({ cwd: '/tmp/opencode' }),
    );
    expect(logMock).toHaveBeenCalledWith(
      '[auto-update-checker] Update installed: 0.9.1 → 0.9.11',
    );
    expect(versionStoreMocks.writeVersionCache).toHaveBeenCalledWith({
      latestVersion: '0.9.11',
      lastChecked: expect.any(Number),
    });
  });

  test('logs message when auto-update is disabled', async () => {
    checkerMocks.findPluginEntry.mockImplementation(() => ({
      pinnedVersion: null,
      isPinned: false,
    }));
    checkerMocks.getCachedVersion.mockImplementation(() => '0.9.1');
    checkerMocks.getLatestVersion.mockImplementation(async () => '0.9.11');

    const { createAutoUpdateCheckerHook } = await import(
      `./index?test=${importCounter++}`
    );
    const { ctx } = createCtx();

    const hook = createAutoUpdateCheckerHook(ctx as never, {
      autoUpdate: false,
    });
    hook.event({ event: { type: 'session.created', properties: {} } });
    await waitForCalls(logMock, 1);

    expect(logMock).toHaveBeenCalledWith(
      '[auto-update-checker] Auto-update disabled; update available: v0.9.1 → v0.9.11',
    );
    expect(cacheMocks.preparePackageUpdate).not.toHaveBeenCalled();
    expect(crossSpawnMock).not.toHaveBeenCalled();
  });

  test('logs prepare failure when active install cannot be resolved', async () => {
    checkerMocks.findPluginEntry.mockImplementation(() => ({
      pinnedVersion: null,
      isPinned: false,
    }));
    checkerMocks.getCachedVersion.mockImplementation(() => '0.9.1');
    checkerMocks.getLatestVersion.mockImplementation(async () => '0.9.11');
    cacheMocks.preparePackageUpdate.mockImplementation(() => null);

    const { createAutoUpdateCheckerHook } = await import(
      `./index?test=${importCounter++}`
    );
    const { ctx } = createCtx();
    const showToast = ctx.client.tui.showToast;

    const hook = createAutoUpdateCheckerHook(ctx as never);
    hook.event({ event: { type: 'session.created', properties: {} } });
    await waitForCalls(logMock, 2);

    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: 'Updating Plugin',
          message: 'opencode-dux is updating to v0.9.11',
        }),
      }),
    );
    expect(crossSpawnMock).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledWith(
      '[auto-update-checker] Failed to prepare install root for auto-update',
    );
  });

  test('logs install failure without telling users to restart', async () => {
    checkerMocks.findPluginEntry.mockImplementation(() => ({
      pinnedVersion: null,
      isPinned: false,
    }));
    checkerMocks.getCachedVersion.mockImplementation(() => '0.9.1');
    checkerMocks.getLatestVersion.mockImplementation(async () => '0.9.11');

    crossSpawnMock.mockImplementation(() => ({
      exited: Promise.resolve(1),
      exitCode: 1,
      kill: mock(() => true),
      stdout: () => Promise.resolve(''),
      stderr: () => Promise.resolve(''),
      proc: {} as never,
    }));

    const { createAutoUpdateCheckerHook } = await import(
      `./index?test=${importCounter++}`
    );
    const { ctx } = createCtx();
    const showToast = ctx.client.tui.showToast;

    const hook = createAutoUpdateCheckerHook(ctx as never);
    hook.event({ event: { type: 'session.created', properties: {} } });
    await waitForCalls(logMock, 2);

    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          title: 'Updating Plugin',
          message: 'opencode-dux is updating to v0.9.11',
        }),
      }),
    );
    expect(crossSpawnMock).toHaveBeenCalledWith(
      expect.arrayContaining(['install']),
      expect.objectContaining({ cwd: '/tmp/opencode' }),
    );
    expect(logMock).toHaveBeenCalledWith(
      '[auto-update-checker] npm install failed; update not installed',
    );
  });

  describe('trigger()', () => {
    test('runs background update when not checked', async () => {
      checkerMocks.findPluginEntry.mockImplementation(() => ({
        pinnedVersion: null,
        isPinned: false,
      }));
      checkerMocks.getCachedVersion.mockImplementation(() => '0.9.1');
      checkerMocks.getLatestVersion.mockImplementation(async () => '0.9.11');

      const { createAutoUpdateCheckerHook } = await import(
        `./index?test=${importCounter++}`
      );
      const { ctx } = createCtx();

      const hook = createAutoUpdateCheckerHook(ctx as never);
      hook.trigger();
      await waitForCalls(logMock, 2);

      expect(logMock).toHaveBeenCalledWith(
        '[auto-update-checker] Update installed: 0.9.1 → 0.9.11',
      );
    });

    test('is no-op when hasTriggered is true', async () => {
      checkerMocks.findPluginEntry.mockImplementation(() => ({
        pinnedVersion: null,
        isPinned: false,
      }));
      checkerMocks.getCachedVersion.mockImplementation(() => '0.9.1');
      checkerMocks.getLatestVersion.mockImplementation(async () => '0.9.11');

      const { createAutoUpdateCheckerHook } = await import(
        `./index?test=${importCounter++}`
      );
      const { ctx } = createCtx();

      const hook = createAutoUpdateCheckerHook(ctx as never);
      // First call sets hasTriggered and runs update
      hook.trigger();
      await waitForCalls(logMock, 2);
      logMock.mockClear();

      // Second call should be no-op (hasTriggered is true)
      hook.trigger();
      // Give it a moment - should not log anything new
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(checkerMocks.findPluginEntry).toHaveBeenCalledTimes(1);
    });

    test('event() can still fire after trigger() fails silently', async () => {
      const { createAutoUpdateCheckerHook } = await import(
        `./index?test=${importCounter++}`
      );
      const { ctx } = createCtx();
      const showToast = ctx.client.tui.showToast;

      const hook = createAutoUpdateCheckerHook(ctx as never);

      // Call trigger first - findPluginEntry returns null (default mock), fails silently
      hook.trigger();
      await waitForCalls(logMock);

      // Verify trigger failure showed a toast and logged
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            title: 'Plugin Update Check',
          }),
        }),
      );
      expect(logMock).toHaveBeenCalledWith(
        '[auto-update-checker] Could not find plugin entry in config',
      );
      logMock.mockClear();
      showToast.mockClear();

      // Now set up mocks for a successful update check via event()
      checkerMocks.findPluginEntry.mockImplementation(() => ({
        pinnedVersion: null,
        isPinned: false,
      }));
      checkerMocks.getCachedVersion.mockImplementation(() => '0.9.1');
      checkerMocks.getLatestVersion.mockImplementation(async () => '0.9.11');

      crossSpawnMock.mockImplementation(() => ({
        exited: Promise.resolve(0),
        exitCode: 0,
        kill: mock(() => true),
        stdout: () => Promise.resolve(''),
        stderr: () => Promise.resolve(''),
        proc: {} as never,
      }));

      // event() should still fire because hasEventChecked is separate from hasTriggered
      hook.event({ event: { type: 'session.created', properties: {} } });
      await waitForCalls(logMock, 2);

      expect(logMock).toHaveBeenCalledWith(
        '[auto-update-checker] Update installed: 0.9.1 → 0.9.11',
      );
    });

    test('skips for local dev installs', async () => {
      checkerMocks.getLocalDevVersion.mockImplementation(() => '0.9.11-dev');

      const { createAutoUpdateCheckerHook } = await import(
        `./index?test=${importCounter++}`
      );
      const { ctx } = createCtx();

      const hook = createAutoUpdateCheckerHook(ctx as never);
      hook.trigger();
      await waitForCalls(logMock);

      expect(checkerMocks.findPluginEntry).not.toHaveBeenCalled();
      expect(checkerMocks.getLatestVersion).not.toHaveBeenCalled();
    });
  });
});
