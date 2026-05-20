import type { ApplyPatchRuntimeOptions } from './types';
export declare const DEFAULT_OPTIONS: ApplyPatchRuntimeOptions;
export declare function createTempDir(prefix?: string): Promise<string>;
export declare function writeFixture(root: string, relativePath: string, contents: string): Promise<void>;
export declare function readText(root: string, relativePath: string): Promise<string>;
export declare function applyPatch(root: string, patchText: string, cfg?: ApplyPatchRuntimeOptions): Promise<void>;
