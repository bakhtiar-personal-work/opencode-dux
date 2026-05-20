import type { ApplyPatchErrorCode, ApplyPatchErrorKind } from './types';
export declare class ApplyPatchError extends Error {
    readonly kind: ApplyPatchErrorKind;
    readonly code: ApplyPatchErrorCode;
    readonly cause?: unknown;
    constructor(kind: ApplyPatchErrorKind, code: ApplyPatchErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
export declare function getErrorMessage(error: unknown): string;
export declare function createApplyPatchBlockedError(message: string, cause?: unknown): ApplyPatchError;
export declare function createApplyPatchValidationError(message: string, cause?: unknown): ApplyPatchError;
export declare function createApplyPatchVerificationError(message: string, cause?: unknown): ApplyPatchError;
export declare function createApplyPatchInternalError(message: string, cause?: unknown): ApplyPatchError;
export declare function isApplyPatchError(error: unknown): error is ApplyPatchError;
export declare function isApplyPatchBlockedError(error: unknown): boolean;
export declare function isApplyPatchValidationError(error: unknown): boolean;
export declare function isApplyPatchVerificationError(error: unknown): boolean;
export declare function isApplyPatchInternalError(error: unknown): boolean;
export declare function getApplyPatchErrorDetails(error: unknown): {
    kind: ApplyPatchErrorKind;
    code: ApplyPatchErrorCode;
    message: string;
} | undefined;
export declare function ensureApplyPatchError(error: unknown, context: string): ApplyPatchError;
