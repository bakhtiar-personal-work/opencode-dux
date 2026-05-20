import type { PluginInput, ProviderContext } from '@opencode-ai/plugin';
import type { Model, UserMessage } from '@opencode-ai/sdk';
interface ChatHeadersInput {
    sessionID: string;
    model: Model;
    provider: ProviderContext;
    message: UserMessage;
}
interface ChatHeadersOutput {
    headers: Record<string, string>;
}
export declare function __resetInternalMarkerCacheForTesting(): void;
export declare function createChatHeadersHook(ctx: PluginInput): {
    'chat.headers': (input: ChatHeadersInput, output: ChatHeadersOutput) => Promise<void>;
};
export {};
