/**
 * Collapse a system message array into a single element by joining all
 * entries with double-newline separators. Mutates the array in-place so
 * that callers holding a reference to the original array see the change.
 */
export declare function collapseSystemInPlace(system: string[]): void;
