/**
 * Module-level runtime preset state.
 *
 * Survives plugin re-inits triggered by client.config.update() →
 * Instance.dispose(). The plugin function re-runs but this module-level
 * variable persists within the same Node.js process.
 */
export declare function setActiveRuntimePreset(name: string | null): void;
export declare function getActiveRuntimePreset(): string | null;
export declare function getPreviousRuntimePreset(): string | null;
export declare function setActiveRuntimePresetWithPrevious(name: string | null): void;
export declare function rollbackRuntimePreset(previous: string | null): void;
