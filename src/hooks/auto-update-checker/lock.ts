import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from './constants';

const LOCK_FILE = join(CACHE_DIR, '.update.lock');
const MAX_WAIT_MS = 30_000;
const POLL_MS = 200;

/**
 * Executes a function with an advisory lock on the shared cache directory.
 * Prevents concurrent access to cache paths during update operations.
 * @param fn Async function to execute while holding the lock
 * @returns Result of the function
 * @throws Error if lock cannot be acquired within MAX_WAIT_MS
 */
export async function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
      }
      // Atomic create: if file already exists, writeFileSync succeeds on most OS,
      // but we check existence first + write as a best-effort advisory lock.
      if (!existsSync(LOCK_FILE)) {
        writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
        try {
          return await fn();
        } finally {
          try {
            rmSync(LOCK_FILE, { force: true });
          } catch {
            // best-effort cleanup
          }
        }
      }
    } catch {
      // Lock held by another process — wait and retry
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('Timed out waiting for cache lock');
}
