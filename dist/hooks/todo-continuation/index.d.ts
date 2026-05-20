import type { PluginInput } from '@opencode-ai/plugin';
interface MessagePart {
    type?: string;
    text?: string;
    [key: string]: unknown;
}
interface ChatTransformMessage {
    info: {
        id?: string;
        role?: string;
        agent?: string;
        sessionID?: string;
    };
    parts: MessagePart[];
}
export declare function createTodoContinuationHook(ctx: PluginInput, config?: {
    maxContinuations?: number;
    cooldownMs?: number;
    autoEnable?: boolean;
    autoEnableThreshold?: number;
}): {
    tool: Record<string, unknown>;
    handleToolExecuteAfter: (input: {
        tool: string;
        sessionID?: string;
    }, output?: {
        output?: unknown;
    }) => Promise<void>;
    handleMessagesTransform: (output: {
        messages: ChatTransformMessage[];
    }) => Promise<void>;
    handleEvent: (input: {
        event: {
            type: string;
            properties?: Record<string, unknown>;
        };
    }) => Promise<void>;
    handleChatMessage: (input: {
        sessionID: string;
        agent?: string;
    }) => void;
    handleCommandExecuteBefore: (input: {
        command: string;
        sessionID: string;
        arguments: string;
    }, output: {
        parts: Array<{
            type: string;
            text?: string;
        }>;
    }) => Promise<void>;
};
export {};
