import * as fs from 'node:fs';
import * as path from 'node:path';
import { stripJsonComments } from '../../cli/config-manager';
import { log } from '../../utils/logger';
import { getCurrentRuntimePackageJsonPath } from './checker';
import { CACHE_DIR, PACKAGE_NAME } from './constants';

interface BunLockfile {
  workspaces?: {
    ''?: {
      dependencies?: Record<string, string>;
    };
  };
  packages?: Record<string, unknown>;
}

interface AutoUpdateInstallContext {
  installDir: string;
  packageJsonPath: string;
}

/**
 * Removes a package from the bun.lock file if it's in JSON format.
 * Note: Newer Bun versions (1.1+) use a custom text format for bun.lock.
 * This function handles JSON-based lockfiles gracefully.
 */
function removeFromBunLock(installDir: string, packageName: string): boolean {
  const lockPath = path.join(installDir, 'bun.lock');
  if (!fs.existsSync(lockPath)) return false;

  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    let lock: BunLockfile;

    try {
      lock = JSON.parse(stripJsonComments(content)) as BunLockfile;
    } catch {
      // If it's not valid JSON(C), it might be the new Bun text format or binary format.
      // For now, we only support JSON-based lockfile manipulation.
      return false;
    }

    let modified = false;

    if (lock.workspaces?.['']?.dependencies?.[packageName]) {
      delete lock.workspaces[''].dependencies[packageName];
      modified = true;
    }

    if (lock.packages?.[packageName]) {
      delete lock.packages[packageName];
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
      log(`[auto-update-checker] Removed from bun.lock: ${packageName}`);
    }

    return modified;
  } catch (err) {
    log(`[auto-update-checker] Failed to process bun.lock:`, err);
    return false;
  }
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

function removeInstalledPackage(
  installDir: string,
  packageName: string,
): boolean {
  const pkgDir = path.join(installDir, 'node_modules', packageName);
  if (!fs.existsSync(pkgDir)) return false;

  fs.rmSync(pkgDir, { recursive: true, force: true });
  log(`[auto-update-checker] Package removed: ${pkgDir}`);
  return true;
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
        // synthesize one so bun install can manage the dependency.
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
          log(`[auto-update-checker] Created synthetic workspace package.json: ${packageJsonPath}`);
        } catch (err) {
          log('[auto-update-checker] Failed to create synthetic package.json:', err);
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
 * Prepares the current install root for a clean re-install of the target version.
 * Returns the install directory to run `bun install` in.
 */
export function preparePackageUpdate(
  version: string,
  packageName: string = PACKAGE_NAME,
  runtimePackageJsonPath: string | null = getCurrentRuntimePackageJsonPath(),
): string | null {
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

    const packageRemoved = removeInstalledPackage(
      installContext.installDir,
      packageName,
    );
    const lockRemoved = removeFromBunLock(
      installContext.installDir,
      packageName,
    );

    if (!packageRemoved && !lockRemoved) {
      log(
        `[auto-update-checker] No cached package artifacts removed for ${packageName}; continuing with updated dependency spec`,
      );
    }

    return installContext.installDir;
  } catch (err) {
    log('[auto-update-checker] Failed to prepare package update:', err);
    return null;
  }
}

/**
 * Deletes ALL opencode-dux package cache directories under the OpenCode
 * packages directory. This forces OpenCode to re-fetch from npm on
 * next startup.
 *
 * Returns the number of directories deleted (0 if none found).
 */
export function clearPackageCache(): number {
  log(`[auto-update-checker] Clearing package cache. CACHE_DIR: ${CACHE_DIR}`);

  const packagesDir = path.join(CACHE_DIR, 'packages');
  if (!fs.existsSync(packagesDir)) {
    log(`[auto-update-checker] Packages directory does not exist: ${packagesDir}`);
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
}
