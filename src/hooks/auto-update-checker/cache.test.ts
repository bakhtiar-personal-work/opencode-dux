import { describe, expect, mock, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { normalize } from 'node:path';
import { platform } from 'node:os';

// Mock logger to avoid noise
mock.module('../../utils/logger', () => ({
  log: mock(() => {}),
}));

mock.module('../../cli/config-manager', () => ({
  stripJsonComments: (s: string) => s,
  getOpenCodeConfigPaths: () => [
    normalize('/mock/config/opencode.json'),
    normalize('/mock/config/opencode.jsonc'),
  ],
}));

// Platform-normalize a Unix-style path for the current OS
function norm(path: string): string {
  return normalize(path);
}

// Cache buster for dynamic imports
let importCounter = 0;

const onWindows = platform() === 'win32';

const RUNTIME_PKG_JSON = norm(
  '/home/user/.cache/opencode/packages/opencode-dux@latest/node_modules/opencode-dux/package.json',
);
const WRAPPER_PKG_JSON = norm(
  '/home/user/.cache/opencode/packages/opencode-dux@latest/package.json',
);
const PKG_DIR = norm(
  '/home/user/.cache/opencode/packages/opencode-dux@latest/node_modules/opencode-dux',
);
const INSTALL_DIR = norm(
  '/home/user/.cache/opencode/packages/opencode-dux@latest',
);

function existsSync(path: unknown): boolean {
  return (
    path === WRAPPER_PKG_JSON || path === PKG_DIR
  );
}

function readFileSync(path: unknown): string | Buffer {
  if (path === WRAPPER_PKG_JSON) {
    return JSON.stringify({
      dependencies: { 'opencode-dux': '0.9.1' },
    });
  }
  return '';
}

describe('auto-update-checker/cache', () => {
  describe('resolveInstallContext', () => {
    test('detects OpenCode packages install root from runtime package path', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (path: unknown) => path === WRAPPER_PKG_JSON,
      );
      const { resolveInstallContext } = await import(
        `./cache?test=${importCounter++}`
      );

      const context = resolveInstallContext(RUNTIME_PKG_JSON);

      expect(context).toEqual({
        installDir: INSTALL_DIR,
        packageJsonPath: WRAPPER_PKG_JSON,
      });

      existsSpy.mockRestore();
    });

    test('does not fall back to legacy cache when runtime path is active but wrapper root is invalid', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        () => false,
      );
      const { resolveInstallContext } = await import(
        `./cache?test=${importCounter++}`
      );

      const context = resolveInstallContext(RUNTIME_PKG_JSON);

      expect(context).toBeNull();

      existsSpy.mockRestore();
    });
  });

  describe('preparePackageUpdate', () => {
    test('returns null when no install context is available', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
      const { preparePackageUpdate } = await import(
        `./cache?test=${importCounter++}`
      );

      const result = preparePackageUpdate('1.0.1');
      expect(result).toBeNull();

      existsSpy.mockRestore();
    });

    test('updates packages wrapper dependency and removes installed package', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (path: unknown) => path === WRAPPER_PKG_JSON || path === PKG_DIR,
      );
      const readSpy = spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify({
          dependencies: { 'opencode-dux': '0.9.1' },
        }),
      );
      const writtenData: string[] = [];
      const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(
        (_path: unknown, data: unknown) => {
          writtenData.push(data as string);
        },
      );
      const rmSyncSpy = spyOn(fs, 'rmSync').mockReturnValue(undefined);
      const { preparePackageUpdate } = await import(
        `./cache?test=${importCounter++}`
      );

      const result = preparePackageUpdate(
        '0.9.11',
        'opencode-dux',
        RUNTIME_PKG_JSON,
      );

      expect(result).toBe(INSTALL_DIR);
      expect(rmSyncSpy).toHaveBeenCalledWith(PKG_DIR, {
        recursive: true,
        force: true,
      });
      expect(writtenData.length).toBeGreaterThan(0);
      expect(JSON.parse(writtenData[0])).toEqual({
        dependencies: { 'opencode-dux': '0.9.11' },
      });

      existsSpy.mockRestore();
      readSpy.mockRestore();
      writeSpy.mockRestore();
      rmSyncSpy.mockRestore();
    });

    const testLegacyCache = onWindows ? test.skip : test;
    testLegacyCache('keeps working when dependency is already on target version', async () => {
      const legacyCache = norm('/.cache/opencode');
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (p: unknown) =>
          (typeof p === 'string' && p.endsWith(norm('/.cache/opencode/package.json'))) ||
          (typeof p === 'string' && p.endsWith(norm('/.cache/opencode/node_modules/opencode-dux'))),
      );
      const readSpy = spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify({
          dependencies: { 'opencode-dux': '1.0.1' },
        }),
      );
      const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const rmSyncSpy = spyOn(fs, 'rmSync').mockReturnValue(undefined);
      const { preparePackageUpdate } = await import(
        `./cache?test=${importCounter++}`
      );

      const result = preparePackageUpdate('1.0.1', 'opencode-dux', null);

      expect(typeof result === 'string' && result.endsWith(legacyCache)).toBe(true);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(rmSyncSpy).toHaveBeenCalled();

      existsSpy.mockRestore();
      readSpy.mockRestore();
      writeSpy.mockRestore();
      rmSyncSpy.mockRestore();
    });
  });
});
