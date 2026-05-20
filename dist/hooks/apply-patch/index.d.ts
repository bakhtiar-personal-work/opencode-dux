import type { PluginInput } from '@opencode-ai/plugin';
interface ToolExecuteBeforeInput {
    tool: string;
    directory?: string;
}
interface ToolExecuteBeforeOutput {
    args?: {
        patchText?: unknown;
        [key: string]: unknown;
    };
}
export declare function createApplyPatchHook(ctx: PluginInput): {
    'tool.execute.before': (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>;
};
export {};
