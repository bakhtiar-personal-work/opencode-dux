import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  flushLoggerForTesting,
  getLogDir,
  initLogger,
  log,
  resetLogger,
} from './logger';

describe('logger', () => {
  let tmpDir: string;
  let origLogDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
    origLogDir = process.env.OPENCODE_LOG_DIR;
    process.env.OPENCODE_LOG_DIR = tmpDir;
    resetLogger();
  });

  afterEach(async () => {
    await flushLoggerForTesting();
    if (origLogDir === undefined) {
      delete process.env.OPENCODE_LOG_DIR;
    } else {
      process.env.OPENCODE_LOG_DIR = origLogDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('log() silently no-ops before initLogger()', () => {
    log('should not crash');
    expect(fs.readdirSync(tmpDir).length).toBe(0);
  });

  test('initLogger creates per-session log file', () => {
    initLogger('20260416T143052');
    log('test message');

    const files = fs.readdirSync(tmpDir);
    expect(files).toEqual(['opencode-dux.20260416T143052.log']);
  });

  test('writes log message with timestamp', async () => {
    initLogger('session1');
    log('timestamped message');
    await flushLoggerForTesting();

    const logPath = path.join(tmpDir, 'opencode-dux.session1.log');
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    expect(content).toContain('timestamped message');
  });

  test('logs message with data object', async () => {
    initLogger('session1');
    log('message with data', { key: 'value', number: 42 });
    await flushLoggerForTesting();

    const logPath = path.join(tmpDir, 'opencode-dux.session1.log');
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('"key":"value"');
    expect(content).toContain('"number":42');
  });

  test('logs message without extra JSON when no data', async () => {
    initLogger('session1');
    log('message without data');
    await flushLoggerForTesting();

    const logPath = path.join(tmpDir, 'opencode-dux.session1.log');
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content.trim()).toMatch(/message without data\s*$/);
  });

  test('appends multiple log entries', async () => {
    initLogger('session1');
    log('first');
    log('second');
    log('third');
    await flushLoggerForTesting();

    const logPath = path.join(tmpDir, 'opencode-dux.session1.log');
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('first');
    expect(lines[1]).toContain('second');
    expect(lines[2]).toContain('third');
  });

  test('initLogger called twice uses second session file', async () => {
    initLogger('session1');
    log('from session1');
    initLogger('session2');
    log('from session2');
    await flushLoggerForTesting();

    const files = fs.readdirSync(tmpDir).sort();
    expect(files).toEqual([
      'opencode-dux.session1.log',
      'opencode-dux.session2.log',
    ]);

    const content1 = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8');
    const content2 = fs.readFileSync(path.join(tmpDir, files[1]), 'utf-8');
    expect(content1).toContain('from session1');
    expect(content1).not.toContain('from session2');
    expect(content2).toContain('from session2');
  });

  test('cleanup keeps only the latest 10 log files', () => {
    const baseTime = Date.now() - 50_000;
    for (let i = 0; i < 10; i++) {
      const fileName = `opencode-dux.seed-${i}.log`;
      const filePath = path.join(tmpDir, fileName);
      fs.writeFileSync(filePath, `seed-${i}\n`);
      const mtime = baseTime + i * 1_000;
      fs.utimesSync(filePath, new Date(mtime), new Date(mtime));
    }

    initLogger('current');
    log('init');

    const files = fs
      .readdirSync(tmpDir)
      .filter(
        (file) =>
          file.startsWith('opencode-dux.') && file.endsWith('.log'),
      )
      .sort();

    expect(files.length).toBe(10);
    expect(files).toContain('opencode-dux.current.log');
    expect(files).not.toContain('opencode-dux.seed-0.log');
    expect(files).toContain('opencode-dux.seed-9.log');
  });

  test('cleanup does not delete current session log when overflowing', () => {
    const baseTime = Date.now() - 100_000;
    for (let i = 0; i < 25; i++) {
      const fileName = `opencode-dux.old-${i}.log`;
      const filePath = path.join(tmpDir, fileName);
      fs.writeFileSync(filePath, `old-${i}\n`);
      const mtime = baseTime + i * 1_000;
      fs.utimesSync(filePath, new Date(mtime), new Date(mtime));
    }

    initLogger('current');

    const files = fs
      .readdirSync(tmpDir)
      .filter(
        (file) =>
          file.startsWith('opencode-dux.') && file.endsWith('.log'),
      );

    expect(files.length).toBe(10);
    expect(files).toContain('opencode-dux.current.log');
  });

  test('cleanup with no existing files does not crash', () => {
    expect(() => initLogger('fresh')).not.toThrow();
    log('init');
    const files = fs.readdirSync(tmpDir);
    expect(files.find((f) => f.includes('fresh'))).toBeDefined();
  });

  test('handles circular references in data', async () => {
    initLogger('session1');
    const circular: any = { name: 'test' };
    circular.self = circular;

    expect(() => log('circular data', circular)).not.toThrow();
    await flushLoggerForTesting();

    const logPath = path.join(tmpDir, 'opencode-dux.session1.log');
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('circular data');
    expect(content).toContain('[unserializable]');
  });

  test('getLogDir returns OPENCODE_LOG_DIR when set', () => {
    expect(getLogDir()).toBe(tmpDir);
  });

  test('getLogDir falls back to os.homedir when env not set', () => {
    delete process.env.OPENCODE_LOG_DIR;
    try {
      expect(getLogDir()).toBe(
        path.join(os.homedir(), '.local/share/opencode'),
      );
    } finally {
      if (origLogDir === undefined) {
        delete process.env.OPENCODE_LOG_DIR;
      } else {
        process.env.OPENCODE_LOG_DIR = origLogDir;
      }
    }
  });

  test('handles complex data structures', async () => {
    initLogger('session1');
    log('complex data', {
      nested: { deep: { value: 'test' } },
      array: [1, 2, 3],
      boolean: true,
      null: null,
    });
    await flushLoggerForTesting();

    const logPath = path.join(tmpDir, 'opencode-dux.session1.log');
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('"nested":');
    expect(content).toContain('"array":[1,2,3]');
    expect(content).toContain('"boolean":true');
  });
});
