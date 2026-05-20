/**
 * Runtime model fallback for foreground (interactive) agent sessions.
 *
 * When OpenCode fires a session.error, message.updated, or session.status
 * event containing a rate-limit signal, this manager:
 *   1. Looks up the next untried model in the agent's configured chain
 *   2. Aborts the rate-limited prompt via client.session.abort()
 *   3. Re-queues the last user message via client.session.promptAsync()
 *      with the new model - promptAsync returns immediately so we never
 *      block the event handler waiting for a full LLM response.
 *
 * This mirrors the same fallback loop used for delegated sessions, but operates
 * reactively through the event system instead of wrapping prompt() in a
 * try/catch, which is not possible for interactive (foreground) sessions.
 */
import type { PluginInput } from '@opencode-ai/plugin';
type OpencodeClient = PluginInput['client'];
export declare function isRateLimitError(error: unknown): boolean;
/**
 * Manages runtime model fallback for foreground agent sessions.
 *
 * Constructed at plugin init with the ordered fallback chains for each agent
 * (built from _modelArray entries merged with fallback.chains config).
 */
export declare class ForegroundFallbackManager {
    private readonly client;
    /**
     * Ordered fallback chains per agent.
     * e.g. { orchestrator: ['anthropic/claude-opus-4-5', 'openai/gpt-4o'] }
     * The first model that hasn't been tried yet is selected on each fallback.
     */
    private readonly chains;
    private readonly enabled;
    /** sessionID → last observed model string ("providerID/modelID") */
    private readonly sessionModel;
    /** sessionID → agent name (populated from message.updated info.agent field) */
    private readonly sessionAgent;
    /** sessionID → set of models already attempted this session */
    private readonly sessionTried;
    /** Sessions with an active fallback switch in flight */
    private readonly inProgress;
    /** sessionID → timestamp of last trigger (for deduplication) */
    private readonly lastTrigger;
    constructor(client: OpencodeClient, 
    /**
     * Ordered fallback chains per agent.
     * e.g. { orchestrator: ['anthropic/claude-opus-4-5', 'openai/gpt-4o'] }
     * The first model that hasn't been tried yet is selected on each fallback.
     */
    chains: Record<string, string[]>, enabled: boolean);
    /**
     * Process an OpenCode plugin event.
     * Call this from the plugin's `event` hook for every event received.
     */
    handleEvent(rawEvent: unknown): Promise<void>;
    private tryFallback;
    /**
     * Determine the fallback chain to use for a session.
     *
     * Priority:
     * 1. Agent name known AND has a configured chain → return it directly
     * 2. Agent name known but NO chain configured → return [] (no fallback;
     *    do NOT bleed into other agents' chains which would re-prompt the
     *    session with a model belonging to a completely different agent)
     * 3. Agent name unknown, current model known → search all chains for
     *    the model to infer which chain to use
     * 4. Nothing matches → flatten all chains as a last resort (only
     *    reached when both agent name and current model are unavailable)
     */
    private resolveChain;
}
export {};
