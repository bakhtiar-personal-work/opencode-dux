/**
 * Injects a /compact heads-up into the orchestrator's latest user turn when
 * sidebar-style context telemetry shows the session is near the model window.
 */
import { type TuiSnapshot } from '../../tui-state';
/** Marker in the injected block; keep in sync with orchestrator prompt guidance. */
export declare const CONTEXT_PRESSURE_HEADING = "### Context budget (plugin telemetry)";
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
export interface ContextPressureReminderOptions {
    enabled: boolean;
    warnThresholdPct: number;
}
/** @internal Exported for tests */
export declare function applyContextPressureReminder(messages: MessageWithParts[], snapshot: TuiSnapshot, options: ContextPressureReminderOptions): void;
export declare function createContextPressureReminderHook(options: ContextPressureReminderOptions): {
    'experimental.chat.messages.transform': (_input: Record<string, never>, output: {
        messages: MessageWithParts[];
    }) => Promise<void>;
};
export {};
