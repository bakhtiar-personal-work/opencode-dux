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

  let hasChecked = false;

  return {
    event: ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== 'session.created') return;
      if (hasChecked) return;

      const props = event.properties as
        | { info?: { parentID?: string } }
        | undefined;
      if (props?.info?.parentID) return;

      hasChecked = true;

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
    log('[auto-update-checker] Plugin not found in config');
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

  log(
    `[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`,
  );

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

  const installDir = preparePackageUpdate(latestVersion, PACKAGE_NAME);
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
    return;
  }

  const installSuccess = await runBunInstallSafe(installDir);

  if (installSuccess) {
    console.log(
      `\n  \u2705 Update installed: v${currentVersion} \u2192 v${latestVersion}`,
    );
    console.log('     Restart OpenCode to apply\n');
    log(
      `[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`,
    );
  } else {
    log('[auto-update-checker] bun install failed; update not installed');
    ctx.client.app
      .log({
        body: {
          service: 'opencode-dux',
          level: 'error',
          message: `Auto-update install failed for v${latestVersion}: bun install returned non-zero exit code`,
        },
      })
      .catch(() => {});
  }
}

export function getAutoUpdateInstallDir(): string {
  return resolveInstallContext()?.installDir ?? CACHE_DIR;
}

/**
 * Spawns a background process to run 'bun install'.
 * Includes a 60-second timeout to prevent stalling OpenCode.
 * @param installDir The directory whose package manager context should be refreshed.
 * @returns True if the installation succeeded within the timeout.
 */
async function runBunInstallSafe(installDir: string): Promise<boolean> {
  try {
    const proc = crossSpawn(['bun', 'install'], {
      cwd: installDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

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

    return proc.exitCode === 0;
  } catch (err) {
    log('[auto-update-checker] bun install error:', err);
    return false;
  }
}

export { getLatestVersion } from './checker';

export type { AutoUpdateCheckerOptions } from './types';
