import type { PluginInput } from '@opencode-ai/plugin';
export declare function createDelegateTaskRetryHook(_ctx: PluginInput): {
    'tool.execute.after': (input: {
        tool: string;
    }, output: {
        output: unknown;
    }) => Promise<void>;
};
