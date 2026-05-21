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
