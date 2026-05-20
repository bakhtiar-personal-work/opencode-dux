/**
 * Post-tool nudge - queues a delegation reminder after file reads/writes.
 * Catches the "inspect/edit files → implement myself" anti-pattern.
 */
interface ToolExecuteAfterInput {
    tool: string;
    sessionID?: string;
    callID?: string;
}
interface ToolExecuteAfterOutput {
    output?: unknown;
}
interface PostFileToolNudgeOptions {
    shouldInject?: (sessionID: string) => boolean;
}
export declare function createPostFileToolNudgeHook(options?: PostFileToolNudgeOptions): {
    'tool.execute.after': (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => Promise<void>;
};
export {};
