import type { PluginInput } from '@opencode-ai/plugin';
interface ChatMessagePart {
    type: string;
    text?: string;
    [key: string]: unknown;
}
interface ChatMessage {
    info: {
        role: string;
        agent?: string;
        sessionID?: string;
    };
    parts: ChatMessagePart[];
}
export declare function createTaskSessionManagerHook(_ctx: PluginInput, options: {
    maxSessionsPerAgent: number;
    readContextMinLines?: number;
    readContextMaxFiles?: number;
    shouldManageSession: (sessionID: string) => boolean;
}): {
    'tool.execute.before': (input: {
        tool: string;
        sessionID?: string;
        callID?: string;
    }, output: {
        args?: unknown;
    }) => Promise<void>;
    'tool.execute.after': (input: {
        tool: string;
        sessionID?: string;
        callID?: string;
    }, output: {
        output: unknown;
        metadata?: unknown;
    }) => Promise<void>;
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: ChatMessage[];
    }) => Promise<void>;
    event: (input: {
        event: {
            type: string;
            properties?: {
                info?: {
                    id?: string;
                    parentID?: string;
                };
                sessionID?: string;
            };
        };
    }) => Promise<void>;
};
export {};
