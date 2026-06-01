import type { PluginInput } from '@opencode-ai/plugin';
import { crossSpawn } from '../../utils/compat';
import { log } from '../../utils/logger';
import { writeVersionCache } from '../../version-store';
import { preparePackageUpdate, resolveInstallContext } from './cache';
import {
  extractChannel,
  findPluginEntry,
  getCachedVersion,
  getLatestVersion,
  getLocalDevVersion,
} from './checker';
import { CACHE_DIR, PACKAGE_NAME } from './constants';
import type { AutoUpdateCheckerOptions } from './types';

/**
 * Creates an OpenCode hook that checks for plugin updates when a new session is created.
 * @param ctx The plugin input context.
 * @param options Configuration options for the update checker.
 * @returns A hook object for the session.created event.
 */
export function createAutoUpdateCheckerHook(
  ctx: PluginInput,
  options: AutoUpdateCheckerOptions = {},
) {
  const { autoUpdate = true } = options;

  let hasTriggered = false;
  let hasEventChecked = false;

  return {
    event: ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== 'session.created') return;
      if (hasEventChecked) return;

      const props = event.properties as
        | { info?: { parentID?: string } }
        | undefined;
      if (props?.info?.parentID) return;

      hasEventChecked = true;

      setTimeout(async () => {
        const localDevVersion = getLocalDevVersion(ctx.directory);

        if (localDevVersion) {
          log('[auto-update-checker] Local development mode');
          return;
        }

        runBackgroundUpdateCheck(ctx, autoUpdate).catch((err) => {
          log('[auto-update-checker] Background update check failed:', err);
        });
      }, 0);
    },

    // Trigger update check on plugin load (separate throttle from event)
    trigger: () => {
      if (hasTriggered) return;
      hasTriggered = true;

      (async () => {
        const localDevVersion = getLocalDevVersion(ctx.directory);

        if (localDevVersion) {
          log('[auto-update-checker] Local development mode');
          return;
        }

        runBackgroundUpdateCheck(ctx, autoUpdate).catch((err) => {
          log('[auto-update-checker] Background update check failed:', err);
        });
      })();
    },
  };
}

/**
 * Orchestrates the version comparison and update process in the background.
 * @param ctx The plugin input context.
 * @param autoUpdate Whether to automatically install updates.
 */
async function runBackgroundUpdateCheck(
  ctx: PluginInput,
  autoUpdate: boolean,
): Promise<void> {
  const pluginInfo = findPluginEntry(ctx.directory);
  if (!pluginInfo) {
    log('[auto-update-checker] Could not find plugin entry in config');
    ctx.client.tui
      .showToast({
        body: {
          title: 'Plugin Update Check',
          message: 'Plugin entry not found in config. Update check deferred.',
          variant: 'info',
          duration: 5000,
        },
      })
      .catch((err) => {
        log('[auto-update-checker] Failed to show toast:', err);
      });
    return;
  }

  const cachedVersion = getCachedVersion();
  const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion;
  if (!currentVersion) {
    log('[auto-update-checker] No version found (cached or pinned)');
    return;
  }

  const channel = extractChannel(pluginInfo.pinnedVersion ?? currentVersion);
  const latestVersion = await getLatestVersion(channel);
  if (!latestVersion) {
    log(
      '[auto-update-checker] Failed to fetch latest version for channel:',
      channel,
    );
    ctx.client.tui
      .showToast({
        body: {
          title: 'Plugin Update Check',
          message: `Failed to fetch latest version for channel "${channel}". Update check will retry.`,
          variant: 'error',
          duration: 5000,
        },
      })
      .catch((err) => {
        log('[auto-update-checker] Failed to show toast:', err);
      });
    return;
  }

  // Persist latest version to cache for startup display
  writeVersionCache({ latestVersion, lastChecked: Date.now() });

  if (currentVersion === latestVersion) {
    log(
      '[auto-update-checker] Already on latest version for channel:',
      channel,
    );
    return;
  }

  if (pluginInfo.isPinned) {
    log(
      `[auto-update-checker] Version is pinned; skipping auto-update. Update available: v${currentVersion} → v${latestVersion}`,
    );
    return;
  }

  if (!autoUpdate) {
    log(
      `[auto-update-checker] Auto-update disabled; update available: v${currentVersion} → v${latestVersion}`,
    );
    return;
  }

  // Show "Updating..." Toast to indicate install is starting
  ctx.client.tui
    .showToast({
      body: {
        title: 'Updating Plugin',
        message: `opencode-dux is updating to v${latestVersion}`,
        variant: 'info',
        duration: 3000,
      },
    })
    .catch(() => {});

  log(
    `[auto-update-checker] Starting auto-update: ${currentVersion} → ${latestVersion}`,
  );

  const installDir = await preparePackageUpdate(latestVersion, PACKAGE_NAME);
  if (!installDir) {
    log('[auto-update-checker] Failed to prepare install root for auto-update');
    ctx.client.app
      .log({
        body: {
          service: 'opencode-dux',
          level: 'error',
          message: `Auto-update could not prepare the active install for v${latestVersion}`,
        },
      })
      .catch(() => {});

    // Show error Toast
    ctx.client.tui
      .showToast({
        body: {
          title: 'Plugin Update Failed',
          message: `Failed to prepare update for opencode-dux v${latestVersion}. You can retry later or update manually.`,
          variant: 'error',
          duration: 3000,
        },
      })
      .catch(() => {});
    return;
  }

  const installSuccess = await runNpmInstallSafe(installDir);

  if (installSuccess) {
    log(
      `[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`,
    );

    // Show Toast notification
    ctx.client.tui
      .showToast({
        body: {
          title: 'Plugin Updated',
          message: `opencode-dux updated to v${latestVersion}. Restart OpenCode to apply.`,
          variant: 'success',
          duration: 3000,
        },
      })
      .catch(() => {});
  } else {
    log('[auto-update-checker] npm install failed; update not installed');
    ctx.client.app
      .log({
        body: {
          service: 'opencode-dux',
          level: 'error',
          message: `Auto-update install failed for v${latestVersion}: npm install returned non-zero exit code`,
        },
      })
      .catch(() => {});

    // Show error Toast
    ctx.client.tui
      .showToast({
        body: {
          title: 'Plugin Update Failed',
          message: `Failed to update opencode-dux to v${latestVersion}. npm install failed. You can retry later or update manually.`,
          variant: 'error',
          duration: 3000,
        },
      })
      .catch(() => {});
  }
}

export function getAutoUpdateInstallDir(): string {
  return resolveInstallContext()?.installDir ?? CACHE_DIR;
}

/**
 * Spawns a background process to run 'npm install'.
 * Includes a 60-second timeout to prevent stalling OpenCode.
 * @param installDir The directory whose package manager context should be refreshed.
 * @returns True if the installation succeeded within the timeout.
 */
async function runNpmInstallSafe(installDir: string): Promise<boolean> {
  try {
    const proc = crossSpawn(['npm', 'install'], {
      cwd: installDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    log(
      '[auto-update-checker] Running npm install in background for directory:',
      installDir,
    );
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 60_000),
    );
    const exitPromise = proc.exited.then(() => 'completed' as const);
    const result = await Promise.race([exitPromise, timeoutPromise]);

    if (result === 'timeout') {
      try {
        proc.kill();
      } catch {
        /* empty */
      }
      return false;
    }

    log(
      '[auto-update-checker] npm install process completed with exit code:',
      proc.exitCode,
    );
    return proc.exitCode === 0;
  } catch (err) {
    log('[auto-update-checker] npm install error:', err);
    return false;
  }
}

export { getLatestVersion } from './checker';

export type { AutoUpdateCheckerOptions } from './types';
