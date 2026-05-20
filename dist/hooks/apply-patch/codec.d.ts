import type { ParsedPatch } from './types';
export declare function normalizeUnicode(text: string): string;
export declare function stripHeredoc(input: string): string;
export declare function normalizePatchText(patchText: string): string;
export declare function parsePatch(patchText: string): ParsedPatch;
export declare function parsePatchStrict(patchText: string): ParsedPatch;
export declare function formatPatch(patch: ParsedPatch): string;
