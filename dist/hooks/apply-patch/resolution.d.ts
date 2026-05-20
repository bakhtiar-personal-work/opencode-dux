import type { ApplyPatchRuntimeOptions, MatchHit, PatchChunk, ResolvedChunk } from './types';
export declare function readFileLines(file: string): Promise<string[]>;
export declare function resolveChunkStart(lines: string[], chunk: PatchChunk, start: number): number;
export declare function locateChunk(lines: string[], file: string, chunk: PatchChunk, start: number, cfg: ApplyPatchRuntimeOptions): ResolvedChunk;
export declare function applyHits(lines: string[], hits: MatchHit[], eol?: '\n' | '\r\n', hasFinalNewline?: boolean): string;
export declare function resolveUpdateChunks(file: string, chunks: PatchChunk[], cfg: ApplyPatchRuntimeOptions): Promise<{
    lines: string[];
    resolved: ResolvedChunk[];
    eol: '\n' | '\r\n';
    hasFinalNewline: boolean;
}>;
export declare function deriveNewContentFromText(file: string, text: string, chunks: PatchChunk[], cfg: ApplyPatchRuntimeOptions): string;
export declare function resolveUpdateChunksFromText(file: string, text: string, chunks: PatchChunk[], cfg: ApplyPatchRuntimeOptions): {
    lines: string[];
    resolved: ResolvedChunk[];
    eol: '\n' | '\r\n';
    hasFinalNewline: boolean;
};
export declare function deriveNewContent(file: string, chunks: PatchChunk[], cfg: ApplyPatchRuntimeOptions): Promise<string>;
