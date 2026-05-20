/**
 * Tracks subagent spawn depth to prevent excessive nesting.
 *
 * Depth 0 = root session (user's main conversation)
 * Depth 1 = agent spawned by root (e.g., explorer)
 * Depth 2 = agent spawned by depth-1 agent
 * Depth 3 = agent spawned by depth-2 agent (max depth by default)
 *
 * When max depth is exceeded, the spawn is blocked.
 */
export declare class SubagentDepthTracker {
    private depthBySession;
    private readonly _maxDepth;
    constructor(maxDepth?: number);
    /** Maximum allowed depth. */
    get maxDepth(): number;
    /**
     * Get the current depth of a session.
     * Root sessions (not tracked) have depth 0.
     */
    getDepth(sessionId: string): number;
    /**
     * Register a child session and check if the spawn is allowed.
     * @returns true if allowed, false if max depth exceeded
     */
    registerChild(parentSessionId: string, childSessionId: string): boolean;
    /**
     * Clean up session tracking when a session is deleted.
     */
    cleanup(sessionId: string): void;
    /**
     * Clean up all tracking data.
     */
    cleanupAll(): void;
}
