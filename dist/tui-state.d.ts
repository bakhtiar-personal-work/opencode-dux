import type { SubscriptionProvider, SubscriptionUsageEntry } from './subscriptions/types';
export type { SubscriptionUsageEntry };
/** Sidebar state for one OpenCode session (orchestrator or subagent). */
export interface SessionNode {
    title: string;
    agent: string;
    model: string;
    variant?: string;
    parentId?: string;
    childIds: string[];
    status: 'busy' | 'idle' | 'retry';
    mode?: 'blocking' | 'fire_forget';
    createdAt: number;
    finishedAt?: number;
    usage?: SessionUsageEntry;
}
export interface SessionUsageEntry {
    contextUsed: number;
    contextLimit: number;
    contextPct: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    updatedAt: number;
}
export interface OrchestrationSigmaAccum {
    contextUsed: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}
export interface SessionUsageDeltaBasis {
    contextUsed: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}
/** One OpenCode orchestration/session tree keyed by root session id. */
export interface TuiSessionBundle {
    rootSessionId: string;
    lastActivityAt: number;
    projectPath?: string;
    tree: Record<string, SessionNode>;
    orchestrationSigmaAccum?: OrchestrationSigmaAccum;
    orchestrationUsageLastSeen: Record<string, SessionUsageDeltaBasis>;
}
export interface TuiSnapshot {
    version: 6;
    updatedAt: number;
    sessions: Record<string, TuiSessionBundle>;
    subscriptionUsage: Record<string, SubscriptionUsageEntry>;
    activeSubscriptionByProvider: Partial<Record<SubscriptionProvider, string>>;
}
export declare const sessionTreeStore: Record<string, SessionNode>;
export declare const SESSION_BUNDLE_RETENTION_MS: number;
/** Normalized resolved directory for comparisons. */
export declare function normalizeProjectDirectory(raw: string): string;
export declare function mergedSessionTree(snapshot: TuiSnapshot): Record<string, SessionNode>;
/** 0-100, from current context used ÷ limit (single source of truth for CTX %). */
export declare function deriveSessionContextPct(used: number, limit: number): number;
/** Token / model telemetry merged from nodes (see {@link SessionNode.usage}). */
export declare function mergedSessionUsage(snapshot: TuiSnapshot): Record<string, SessionUsageEntry>;
export declare function mergedSessionModels(snapshot: TuiSnapshot): Record<string, string>;
export declare function mergedSessionVariants(snapshot: TuiSnapshot): Record<string, string>;
export declare function mergedOrchestrationUsageLastSeen(snapshot: TuiSnapshot): Record<string, SessionUsageDeltaBasis>;
export declare function mergedOrchestrationSigmaAccum(snapshot: TuiSnapshot): Record<string, OrchestrationSigmaAccum>;
export declare function mapOpenCodeStatusToTreeStatus(raw: string): 'busy' | 'idle' | 'retry';
export declare function syncOpenCodeStatusesIntoSessionTree(snapshot: TuiSnapshot, statuses: Record<string, {
    type: string;
}>): void;
export declare function expandMissingSessionCascade(mergedTree: Record<string, SessionNode>, seeds: Iterable<string>): Set<string>;
/**
 * Drop idle bundles (TTL, whole-tree gone from OpenCode) and soft-prune
 * sessions missing from {@link input.opencodeIds}. Soft-prune skips any id
 * still present in that set so incomplete polls cannot idle a busy child
 * whose parent row was omitted. Ancestors are skipped while any polled id is
 * still their descendant (avoids idling the orchestrator and clearing sigma
 * when the poll omits the root). If incomplete polls persist, callers may add
 * debouncing or skip soft-prune when poll cardinality collapses abruptly.
 */
export declare function pruneStaleTuiSessionBundles(snapshot: TuiSnapshot, input: {
    opencodeIds: ReadonlySet<string>;
    currentProjectDir: string;
    now: number;
}): Set<string>;
export declare function getTuiStatePath(): string;
export declare function readTuiSnapshot(): TuiSnapshot;
export declare function readTuiSnapshotAsync(): Promise<TuiSnapshot>;
export declare function updateSnapshot(mutator: (snapshot: TuiSnapshot) => void): void;
/**
 * Resolves after any pending synchronous `updateSnapshot` work on this thread
 * has finished (writes are synchronous today).
 */
export declare function flushTuiSnapshot(): Promise<void>;
export type RecordSessionUsageInput = {
    sessionID: string;
    contextUsed?: number;
    contextLimit?: number;
    contextPct?: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
};
export declare function recordSessionUsagesBatch(inputs: RecordSessionUsageInput[]): void;
/**
 * One persisted write for delegate-spawned subagent: tree node + parent
 * `childIds` + {@link sessionTreeStore} parent link.
 */
export declare function recordDelegatedSubagentSession(input: {
    sessionID: string;
    parentSessionId: string;
    agent: string;
    variant?: string;
    mode?: 'blocking' | 'fire_forget';
}): void;
/**
 * One persisted write for `session.created`: node, optional parent `childIds`,
 * optional project path.
 */
export declare function recordChildSessionSnapshot(input: {
    sessionID: string;
    title: string;
    parentSessionId?: string;
    projectPath?: string;
}): void;
export declare function patchSessionTreeStatusFromOpenCode(sessionID: string, rawType: string): void;
export declare function recordSessionEnd(sessionID: string): void;
export declare function recordSessionModel(input: {
    sessionID: string;
    model: string;
}): void;
export declare function recordSessionVariant(input: {
    sessionID: string;
    variant: string;
}): void;
export declare function recordSessionNode(input: {
    sessionID: string;
    /** Omit to keep the existing title (e.g. from `session.created`). Pass `''` to clear. */
    title?: string;
    agent: string;
    model?: string;
    variant?: string;
    parentId?: string;
    mode?: 'blocking' | 'fire_forget';
    status?: 'busy' | 'idle' | 'retry';
}): void;
/** Persist session title from OpenCode when the SDK reports a non-empty name. */
export declare function recordSessionTitle(input: {
    sessionID: string;
    title: string;
}): void;
export declare function recordSessionDone(sessionID: string): void;
export declare function recordSessionUsage(input: RecordSessionUsageInput): void;
export declare function subscriptionUsageKey(provider: SubscriptionProvider, accountName: string): string;
export declare function recordSubscriptionUsage(usage: SubscriptionUsageEntry[]): void;
export declare function removeSubscriptionUsageEntry(provider: SubscriptionProvider, name: string): void;
export declare function recordSessionProject(input: {
    sessionID: string;
    projectPath: string;
}): void;
export declare function deleteSessionEntries(sessionID: string): void;
export declare function recordActiveSubscriptionForProvider(provider: SubscriptionProvider, name: string | null): void;
