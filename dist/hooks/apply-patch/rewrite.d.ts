import type { ApplyPatchRuntimeOptions } from './types';
export type RewritePatchResult = {
    patchText: string;
    changed: boolean;
};
export declare function rewritePatch(root: string, patchText: string, cfg: ApplyPatchRuntimeOptions, worktree?: string): Promise<RewritePatchResult>;
export declare function rewritePatchText(root: string, patchText: string, cfg: ApplyPatchRuntimeOptions, worktree?: string): Promise<string>;
