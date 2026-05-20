import type { PluginInput } from '@opencode-ai/plugin';
import type { PluginConfig } from '../config';
/**
 * Creates a preset manager for the /preset slash command.
 *
 * Uses the OpenCode SDK's client.config.update() to change agent models
 * and temperatures without restarting. The server invalidates its agent
 * cache and re-reads config on the next prompt.
 *
 * Note: activePreset is tracked in-memory only and resets on plugin reload.
 * If the user manually edits config or another mechanism changes agents,
 * this tracker may become stale until the next /preset call.
 */
export declare function createPresetManager(ctx: PluginInput, config: PluginConfig): {
    handleCommandExecuteBefore: (input: {
        command: string;
        sessionID: string;
        arguments: string;
    }, output: {
        parts: Array<{
            type: string;
            text?: string;
        }>;
    }) => Promise<void>;
    registerCommand: (opencodeConfig: Record<string, unknown>) => void;
};
export type PresetManager = ReturnType<typeof createPresetManager>;
