import type { TuiPluginModule } from '@opencode-ai/plugin/tui';
import { type TuiSnapshot } from './tui-state';
export declare function formatTokenAbbrev(value: number): string;
export declare function formatTokenAbbrevDecimal(value: number): string;
export declare function formatSidebarModelName(model: string): string;
/**
 * Show `provider/model-id` compactly: shorten long basenames on hyphen
 * boundaries, then append the OpenCode `variant` in full (`model… - High`).
 */
export declare function formatSidebarModelAndVariant(rawModel: string | undefined, variant: string | undefined, maxModelDisplayLen?: number): string;
export declare function formatAgentName(name: string): string;
export declare function formatDuration(ms: number): string;
export declare function formatSessionUsageRows(snapshot: TuiSnapshot, sessionID: string, options?: {
    abbreviateLeft?: boolean;
}): {
    contextPct: number;
    ctxLabel: string;
    ctxValue: string;
    ioInputAbbrev: string;
    ioOutputAbbrev: string;
    cacheLabel: string;
    cacheValue: string;
    cacheReadAbbrev: string;
    cacheWriteAbbrev: string;
};
export declare function aggregateOrchestrationUsage(snapshot: TuiSnapshot, rootSessionID: string): {
    inputTotal: number;
    outputTotal: number;
    cacheRead: number;
    cacheWrite: number;
    contextUsed: number;
};
export declare function getSidebarAgentNames(snapshot: TuiSnapshot): string[];
declare const plugin: TuiPluginModule & {
    id: string;
};
export default plugin;
