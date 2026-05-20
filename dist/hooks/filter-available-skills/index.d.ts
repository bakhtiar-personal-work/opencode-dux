/**
 * Filter available_skills block based on the current agent's permission.skill rules.
 * OpenCode core injects `<available_skills>` globally, so this hook rewrites that
 * block before the prompt is sent.
 */
import type { PluginInput } from '@opencode-ai/plugin';
import { type PluginConfig } from '../../config';
interface MessageInfo {
    role: string;
    agent?: string;
}
interface MessagePart {
    type: string;
    text?: string;
    [key: string]: unknown;
}
interface MessageWithParts {
    info: MessageInfo;
    parts: MessagePart[];
}
type SkillRule = 'allow' | 'ask' | 'deny';
declare function filterAvailableSkillsText(text: string, permissionRules: Record<string, SkillRule>): string;
/**
 * Creates the experimental.chat.messages.transform hook for filtering available skills.
 * This hook runs right before sending to API, so it doesn't affect UI display.
 */
export declare function createFilterAvailableSkillsHook(ctx: PluginInput, config: PluginConfig): {
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export { filterAvailableSkillsText };
