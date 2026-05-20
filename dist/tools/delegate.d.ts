import type { ToolDefinition } from '@opencode-ai/plugin';
import type { PluginConfig } from '../config';
import type { SubagentDepthTracker } from '../utils/subagent-depth';
/**
 * When true, blocking `delegate_subagent` keeps the child session open and
 * appends `<delegate_session_continue .../>` for `continue_session_id` flows.
 */
export declare function subagentOutputRequestsUserHandoff(text: string): boolean;
type OpencodeClient = import('@opencode-ai/plugin').PluginInput['client'];
export declare function createDelegateTools(ctx: {
    client: OpencodeClient;
    directory: string;
}, config: PluginConfig | undefined, depthTracker: SubagentDepthTracker | undefined): Record<string, ToolDefinition>;
export {};
