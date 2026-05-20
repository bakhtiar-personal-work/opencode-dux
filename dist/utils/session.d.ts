/**
 * Shared session utilities for background managers.
 */
import type { PluginInput } from '@opencode-ai/plugin';
type OpencodeClient = PluginInput['client'];
type SessionPromptBody = NonNullable<Parameters<OpencodeClient['session']['prompt']>[0]['body']>;
/** Multimodal / text parts accepted by `session.prompt` */
export type PromptBodyPart = SessionPromptBody['parts'][number];
/** Prompt body including optional variant (supported by the host at runtime). */
export type PromptBody = SessionPromptBody & {
    variant?: string;
};
/**
 * Extract the short model label from a "provider/model" string.
 * E.g. "openai/gpt-5.4-mini" → "gpt-5.4-mini"
 */
export declare function shortModelLabel(model: string): string;
/**
 * Parse a model reference string into provider and model IDs.
 * @param model - Model string in format "provider/model"
 * @returns Object with providerID and modelID, or null if invalid
 */
export declare function parseModelReference(model: string): {
    providerID: string;
    modelID: string;
} | null;
/**
 * OpenCode stores pasted / attached screenshots as {@link FilePart} (`type: "file"`,
 * `mime` starting with `image/`), not as `type: "image"`. Some stacks still emit
 * legacy `image` parts - accept both.
 *
 * @see https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/message-v2.ts
 */
export declare function isForwardableImagePart(part: Record<string, unknown>): boolean;
/**
 * Non-text parts (e.g. images) from the latest user message in a session.
 * Used when forwarding multimodal context to delegated agents such as @interpreter.
 */
export declare function extractLatestUserImageParts(client: OpencodeClient, sessionId: string, directory: string): Promise<PromptBodyPart[]>;
/**
 * Stored {@link FilePart} rows include `sessionID` / `messageID` / etc. Child
 * `session.prompt` expects {@link FilePartInput}-shaped drafts (`type`, `mime`,
 * `url`, optional `filename`). Some attachments omit `url` but provide
 * `source.path` - resolve that to a `file:` URL when possible.
 */
export declare function normalizeImagePartsForChildPrompt(parts: PromptBodyPart[], workspaceDirectory?: string): PromptBodyPart[];
/**
 * Send a prompt to a session with optional timeout.
 * If timeout is exceeded, the session is aborted and an error is thrown.
 * @param client - OpenCode client instance
 * @param args - Arguments for session.prompt()
 * @param timeoutMs - Timeout in milliseconds (0 = no timeout)
 * @throws Error if timeout is exceeded
 */
export declare function promptWithTimeout(client: OpencodeClient, args: Parameters<OpencodeClient['session']['prompt']>[0], timeoutMs: number): Promise<void>;
/**
 * Result of extracting session content.
 * `empty` is true when the assistant produced zero text content -
 * the provider returned an empty response (e.g. rate-limited silently).
 */
export interface SessionExtractionResult {
    text: string;
    empty: boolean;
}
/**
 * Extract the result text from a session.
 * Collects all assistant messages and concatenates their text parts.
 * @param client - OpenCode client instance
 * @param sessionId - Session ID to extract from
 * @param options - Optional: `includeReasoning` (default true) controls whether
 *                  reasoning/chain-of-thought parts are included;
 *                  `directory` scopes workspace for `session.messages` (child sessions).
 * @returns Object with extracted text and an `empty` flag for zero-content detection
 */
export declare function extractSessionResult(client: OpencodeClient, sessionId: string, options?: {
    includeReasoning?: boolean;
    directory?: string;
}): Promise<SessionExtractionResult>;
/**
 * After `session.prompt`, optionally wait for a terminal session status.
 * Returns immediately when per-session status is unavailable (common for some hosts),
 * so we never block the orchestrator on a mismatched status API.
 */
export declare function waitUntilSessionIdle(client: OpencodeClient, sessionId: string, workspaceDirectory: string): Promise<void>;
/**
 * After `session.prompt`, wait for idle then read assistant text. Retries if the
 * message store lags; falls back to including reasoning parts if text is still empty.
 */
export declare function extractAssistantTextAfterPrompt(client: OpencodeClient, sessionId: string, workspaceDirectory: string): Promise<SessionExtractionResult>;
export {};
