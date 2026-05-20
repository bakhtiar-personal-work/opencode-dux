export declare const SLIM_INTERNAL_INITIATOR_MARKER = "<!-- SLIM_INTERNAL_INITIATOR -->";
export declare function createInternalAgentTextPart(text: string): {
    type: 'text';
    text: string;
};
export declare function hasInternalInitiatorMarker(part: unknown): boolean;
