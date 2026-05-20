// src/version-store.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface VersionCache {
  latestVersion: string | null;
  lastChecked: number | null; // epoch ms
}

function getVersionCacheDir(): string {
  const base =
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? homedir(), 'opencode-dux')
      : join(homedir(), '.cache', 'opencode-dux');
  return base;
}

function getVersionCachePath(): string {
  return join(getVersionCacheDir(), 'version-cache.json');
}

export function readVersionCache(): VersionCache {
  const cachePath = getVersionCachePath();
  try {
    if (existsSync(cachePath)) {
      const raw = readFileSync(cachePath, 'utf-8');
      return JSON.parse(raw) as VersionCache;
    }
  } catch {
    /* best-effort */
  }
  return { latestVersion: null, lastChecked: null };
}

export function writeVersionCache(cache: VersionCache): void {
  const cachePath = getVersionCachePath();
  try {
    const dir = dirname(cachePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    /* best-effort */
  }
}

/** Staleness threshold: cache older than this is ignored at startup */
export const VERSION_CACHE_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function logVersionDisplay(
  currentVersion: string,
  savedVersion: string | null,
  latestVersion: string | null,
  lastChecked: number | null,
): void {
  if (savedVersion && savedVersion !== currentVersion) {
    console.log(
      `  \u{1F4E6} Current version: \x1b[31mv${savedVersion}\x1b[0m \u2192 \x1b[32mv${currentVersion} (Updated)\x1b[0m`,
    );
  } else {
    const cacheFresh =
      latestVersion !== null &&
      lastChecked !== null &&
      Date.now() - lastChecked < VERSION_CACHE_STALE_MS;

    if (cacheFresh && latestVersion !== currentVersion) {
      console.log(
        `  \u{1F4E6} Current version: \x1b[31mv${currentVersion}\x1b[0m \u2192 \x1b[33mv${latestVersion}\x1b[0m`,
      );
      console.log('     Restart OpenCode to update');
    } else {
      const latestIndicator =
        cacheFresh && latestVersion === currentVersion ? ' (latest)' : '';
      console.log(
        `  \u{1F4E6} Current version: \x1b[32mv${currentVersion}${latestIndicator}\x1b[0m`,
      );
    }
  }
}
