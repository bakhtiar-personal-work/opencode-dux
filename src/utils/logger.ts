import * as fs from 'node:fs';
import { appendFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const LOG_PREFIX = 'opencode-dux.';
const LOG_SUFFIX = '.log';
const MAX_LOG_FILES = 10;
const MAX_BG_TASK_FILES = 10;

let logFile: string | null = null;
let writeChain: Promise<void> = Promise.resolve();

function getLogDir(): string {
  return (
    process.env.OPENCODE_LOG_DIR ??
    path.join(os.homedir(), '.local/share/opencode')
  );
}

function trimByCount(
  filePaths: string[],
  maxFiles: number,
  preservePath?: string,
): void {
  if (filePaths.length <= maxFiles) return;

  const sortedByMtime = filePaths
    .map((filePath) => {
      try {
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { filePath: string; mtimeMs: number } =>
      Boolean(entry),
    )
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  const overflow = sortedByMtime.length - maxFiles;
  if (overflow <= 0) return;

  const candidates = preservePath
    ? sortedByMtime.filter((entry) => entry.filePath !== preservePath)
    : sortedByMtime;

  for (const entry of candidates.slice(0, overflow)) {
    try {
      fs.unlinkSync(entry.filePath);
    } catch {
      // Skip individual file errors
    }
  }
}

function cleanupOldLogs(logDir: string, preservePath?: string): void {
  try {
    const entries = fs.readdirSync(logDir);
    const logFiles = entries
      .filter(
        (entry) => entry.startsWith(LOG_PREFIX) && entry.endsWith(LOG_SUFFIX),
      )
      .map((entry) => path.join(logDir, entry));

    trimByCount(logFiles, MAX_LOG_FILES, preservePath);
  } catch {
    // Directory may not exist yet - that's fine
  }

  // Apply the same count-based retention to persisted background task files
  try {
    const bgTaskDir = path.join(logDir, 'bg-tasks');
    const taskFiles = fs
      .readdirSync(bgTaskDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => path.join(bgTaskDir, entry));

    trimByCount(taskFiles, MAX_BG_TASK_FILES);
  } catch {
    // bg-tasks dir may not exist yet - that's fine
  }
}

export function initLogger(sessionId: string): void {
  const dir = getLogDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Directory creation failed - logging will silently fail
  }
  logFile = path.join(dir, `${LOG_PREFIX}${sessionId}${LOG_SUFFIX}`);
  try {
    fs.closeSync(fs.openSync(logFile, 'a'));
  } catch {
    // File creation failed - later writes will silently fail
  }
  cleanupOldLogs(dir, logFile);
}

/** @internal Reset logger state for testing */
export function resetLogger(): void {
  logFile = null;
  writeChain = Promise.resolve();
}

/** @internal Wait for queued log writes in tests. */
export async function flushLoggerForTesting(): Promise<void> {
  await writeChain;
}

export { getLogDir };

export function log(message: string, data?: unknown): void {
  const target = logFile;
  if (!target) return; // Uninitialized - silently no-op
  try {
    const timestamp = new Date().toISOString();
    let dataStr = '';
    if (data !== undefined) {
      try {
        dataStr = JSON.stringify(data);
      } catch {
        dataStr = '[unserializable]';
      }
    }
    const logEntry = `[${timestamp}] ${message} ${dataStr}\n`;
    writeChain = writeChain
      .then(() => appendFile(target, logEntry))
      .catch(() => {
        // Silently ignore logging errors and keep future writes alive
      });
  } catch {
    // Silently ignore logging errors
  }
}
