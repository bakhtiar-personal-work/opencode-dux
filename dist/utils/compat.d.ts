import type { ChildProcess } from 'node:child_process';
export declare const isBun: boolean;
export interface CrossSpawnResult {
    proc: ChildProcess;
    /** Collects all stdout into a string */
    stdout: () => Promise<string>;
    /** Collects all stderr into a string */
    stderr: () => Promise<string>;
    /** Resolves when process exits with exit code */
    exited: Promise<number>;
    /** Kill the process */
    kill: (signal?: NodeJS.Signals | number) => boolean;
    /** Current exit code or null if running */
    get exitCode(): number | null;
}
/**
 * Cross-runtime spawn that works in both Bun and Node.js.
 * API mimics Bun.spawn but uses node:child_process internally.
 */
export declare function crossSpawn(command: string[], options?: {
    stdout?: 'pipe' | 'inherit' | 'ignore';
    stderr?: 'pipe' | 'inherit' | 'ignore';
    stdin?: 'pipe' | 'inherit' | 'ignore';
    cwd?: string;
    env?: Record<string, string | undefined>;
}): CrossSpawnResult;
/**
 * Cross-runtime file write that works in both Bun and Node.js.
 */
export declare function crossWrite(path: string, data: ArrayBuffer | Buffer | string): Promise<void>;
