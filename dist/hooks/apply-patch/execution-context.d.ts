import { resolveUpdateChunksFromText } from './resolution';
import type { ApplyPatchRuntimeOptions, PatchHunk, UpdatePatchHunk } from './types';
export type PreparedFileState = {
    exists: false;
    derived: boolean;
} | {
    exists: true;
    text: string;
    mode?: number;
    derived: boolean;
};
export type PatchExecutionContext = {
    hunks: PatchHunk[];
    pathsNormalized: boolean;
    staged: Map<string, PreparedFileState>;
    getPreparedFileState: (filePath: string, verb: 'update' | 'delete') => Promise<PreparedFileState>;
    assertPreparedPathMissing: (filePath: string, verb: 'add' | 'move') => Promise<void>;
};
export type ResolvedPreparedUpdate = {
    resolved: Awaited<ReturnType<typeof resolveUpdateChunksFromText>>['resolved'];
    nextText: string;
};
export declare function isMissingPathError(error: unknown): boolean;
export declare function parseValidatedPatch(patchText: string): PatchHunk[];
export declare function createPatchExecutionContext(root: string, patchText: string, worktree?: string): Promise<PatchExecutionContext>;
export declare function resolvePreparedUpdate(filePath: string, currentText: string, hunk: UpdatePatchHunk, cfg: ApplyPatchRuntimeOptions): ResolvedPreparedUpdate;
export declare function stageAddedText(contents: string): string;
