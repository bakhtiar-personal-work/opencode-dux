import type { ApplyPatchRuntimeOptions, PreparedChange } from './types';
export declare function preparePatchChanges(root: string, patchText: string, cfg: ApplyPatchRuntimeOptions, worktree?: string): Promise<PreparedChange[]>;
/**
 * Internal best-effort helper that applies the output of
 * `preparePatchChanges()`: it snapshots all touched paths first and uses
 * temp + rename for writes to regular files. It is not a universal multi-file
 * transaction and is not perfect against concurrent external interference,
 * but it avoids leaving silent partial states on normal apply failures.
 *
 * Contract: although it is exported for local tests/helpers, its expected
 * input is the already prepared output of `preparePatchChanges()`. If it
 * receives manual arrays, it revalidates the basic shape
 * (types/text/normalized absolute paths) and filesystem invariants: it
 * rejects updates/deletes/moves whose source does not exist, and add/move
 * operations whose destination is already occupied.
 */
export declare function applyPreparedChanges(changes: PreparedChange[]): Promise<void>;
