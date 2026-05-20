declare function getLogDir(): string;
export declare function initLogger(sessionId: string): void;
/** @internal Reset logger state for testing */
export declare function resetLogger(): void;
/** @internal Wait for queued log writes in tests. */
export declare function flushLoggerForTesting(): Promise<void>;
export { getLogDir };
export declare function log(message: string, data?: unknown): void;
