export declare function resolveOpenCodePath(): string;
export declare function isOpenCodeInstalled(): Promise<boolean>;
export declare function getOpenCodeVersion(): Promise<string | null>;
export declare function getOpenCodePath(): string | null;
export declare function fetchLatestVersion(packageName: string): Promise<string | null>;
