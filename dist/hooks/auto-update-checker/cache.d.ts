interface AutoUpdateInstallContext {
    installDir: string;
    packageJsonPath: string;
}
export declare function resolveInstallContext(runtimePackageJsonPath?: string | null): AutoUpdateInstallContext | null;
/**
 * Prepares the current install root for a clean re-install of the target version.
 * Returns the install directory to run `bun install` in.
 */
export declare function preparePackageUpdate(version: string, packageName?: string, runtimePackageJsonPath?: string | null): string | null;
export {};
