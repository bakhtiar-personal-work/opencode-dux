export declare const PHASE_REMINDER = "<internal_reminder>!IMPORTANT! Follow <first_gate> order in system prompt; delegate_subagent in the same turn you name the agent. !END!</internal_reminder>";
interface MessageInfo {
    role: string;
    agent?: string;
    sessionID?: string;
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
/**
 * Creates the experimental.chat.messages.transform hook for phase reminder injection.
 * This hook runs right before sending to API, so it doesn't affect UI display.
 * Only injects for the orchestrator agent.
 */
export declare function createPhaseReminderHook(): {
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export {};
