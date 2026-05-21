import * as fs from 'node:fs';
import * as path from 'node:path';
import { stripJsonComments } from '../../cli/config-manager';
import { log } from '../../utils/logger';
import { getCurrentRuntimePackageJsonPath } from './checker';
import { CACHE_DIR, PACKAGE_NAME } from './constants';
import { withCacheLock } from './lock';

interface AutoUpdateInstallContext {
  installDir: string;
  packageJsonPath: string;
}

function ensureDependencyVersion(
  packageJsonPath: string,
  packageName: string,
  version: string,
): boolean {
  if (!fs.existsSync(packageJsonPath)) return false;

  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkgJson = JSON.parse(stripJsonComments(content)) as {
      dependencies?: Record<string, string>;
      [key: string]: unknown;
    };

    const dependencies = { ...(pkgJson.dependencies ?? {}) };
    if (dependencies[packageName] === version) {
      return true;
    }

    dependencies[packageName] = version;
    pkgJson.dependencies = dependencies;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkgJson, null, 2));
    log(
      `[auto-update-checker] Updated dependency in package.json: ${packageName} → ${version}`,
    );
    return true;
  } catch (err) {
    log(
      `[auto-update-checker] Failed to update package.json dependency for auto-update:`,
      err,
    );
    return false;
  }
}

export function resolveInstallContext(
  runtimePackageJsonPath: string | null = getCurrentRuntimePackageJsonPath(),
): AutoUpdateInstallContext | null {
  if (runtimePackageJsonPath) {
    const packageDir = path.dirname(runtimePackageJsonPath);
    const nodeModulesDir = path.dirname(packageDir);

    if (
      path.basename(packageDir) === PACKAGE_NAME &&
      path.basename(nodeModulesDir) === 'node_modules'
    ) {
      const installDir = path.dirname(nodeModulesDir);

      const packageJsonPath = path.join(installDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        // OpenCode doesn't create a workspace package.json in its cache;
        // synthesize one so npm install can manage the dependency.
        try {
          fs.writeFileSync(
            packageJsonPath,
            JSON.stringify(
              {
                name: `workspace-${PACKAGE_NAME}`,
                private: true,
                dependencies: { [PACKAGE_NAME]: 'latest' },
              },
              null,
              2,
            ),
            'utf-8',
          );
          log(
            `[auto-update-checker] Created synthetic workspace package.json: ${packageJsonPath}`,
          );
        } catch (err) {
          log(
            '[auto-update-checker] Failed to create synthetic package.json:',
            err,
          );
          return null;
        }
      }
      return { installDir, packageJsonPath };
    }

    return null;
  }

  const legacyPackageJsonPath = path.join(CACHE_DIR, 'package.json');
  if (fs.existsSync(legacyPackageJsonPath)) {
    return { installDir: CACHE_DIR, packageJsonPath: legacyPackageJsonPath };
  }

  return null;
}

/**
 * Prepares the current install root for an install of the target version.
 * Ensures the dependency version is set in package.json and returns the
 * install directory to run `npm install` in.
 */
export async function preparePackageUpdate(
  version: string,
  packageName: string = PACKAGE_NAME,
  runtimePackageJsonPath: string | null = getCurrentRuntimePackageJsonPath(),
): Promise<string | null> {
  return withCacheLock(async () => {
    try {
      const installContext = resolveInstallContext(runtimePackageJsonPath);
      if (!installContext) {
        log('[auto-update-checker] No install context found for auto-update');
        return null;
      }

      const dependencyReady = ensureDependencyVersion(
        installContext.packageJsonPath,
        packageName,
        version,
      );
      if (!dependencyReady) {
        return null;
      }

      return installContext.installDir;
    } catch (err) {
      log('[auto-update-checker] Failed to prepare package update:', err);
      return null;
    }
  });
}

/**
 * Deletes ALL opencode-dux package cache directories under the OpenCode
 * packages directory. This forces OpenCode to re-fetch from npm on
 * next startup.
 *
 * Returns the number of directories deleted (0 if none found).
 */
export async function clearPackageCache(): Promise<number> {
  return withCacheLock(async () => {
    log(
      `[auto-update-checker] Clearing package cache. CACHE_DIR: ${CACHE_DIR}`,
    );

    const packagesDir = path.join(CACHE_DIR, 'packages');
    if (!fs.existsSync(packagesDir)) {
      log(
        `[auto-update-checker] Packages directory does not exist: ${packagesDir}`,
      );
      return 0;
    }

    log(`[auto-update-checker] Packages directory exists: ${packagesDir}`);

    let deleted = 0;
    try {
      const entries = fs.readdirSync(packagesDir);
      log(
        `[auto-update-checker] Found ${entries.length} entries in packages directory`,
      );

      for (const entry of entries) {
        log(`[auto-update-checker] Checking entry: ${entry}`);
        // Match: opencode-dux@latest, opencode-dux@1.3.6, etc.
        if (entry === PACKAGE_NAME || entry.startsWith(`${PACKAGE_NAME}@`)) {
          const fullPath = path.join(packagesDir, entry);
          log(`[auto-update-checker] Deleting cache directory: ${fullPath}`);
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            log(`[auto-update-checker] Deleted cache directory: ${fullPath}`);
            deleted++;
          } catch (rmErr) {
            log(
              `[auto-update-checker] Failed to delete directory: ${fullPath}`,
              rmErr,
            );
          }
        }
      }
    } catch (err) {
      log('[auto-update-checker] Failed to read packages directory:', err);
    }

    // Also try the legacy path: CACHE_DIR/node_modules/opencode-dux/
    const legacyPkgDir = path.join(CACHE_DIR, 'node_modules', PACKAGE_NAME);
    log(`[auto-update-checker] Checking legacy cache path: ${legacyPkgDir}`);
    try {
      if (fs.existsSync(legacyPkgDir)) {
        log(
          `[auto-update-checker] Deleting legacy cache directory: ${legacyPkgDir}`,
        );
        fs.rmSync(legacyPkgDir, { recursive: true, force: true });
        log(
          `[auto-update-checker] Deleted legacy cache directory: ${legacyPkgDir}`,
        );
        deleted++;
      } else {
        log(
          `[auto-update-checker] Legacy cache path does not exist: ${legacyPkgDir}`,
        );
      }
    } catch (err) {
      log('[auto-update-checker] Failed to clear legacy cache:', err);
    }

    log(
      `[auto-update-checker] Package cache clearing complete. ${deleted} directories deleted`,
    );
    return deleted;
  });
}
