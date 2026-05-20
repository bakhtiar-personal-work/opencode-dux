export declare const TODO_HYGIENE_REMINDER = "If the active task changed or finished, update the todo list to match the current work state.";
export declare const TODO_FINAL_ACTIVE_REMINDER = "If you are finishing now, do not leave the active todo in_progress. Mark it completed, or move unfinished work back to pending.";
interface ToolInput {
    tool: string;
    sessionID?: string;
}
interface EventInput {
    type: string;
    properties?: {
        info?: {
            id?: string;
        };
        sessionID?: string;
    };
}
interface RequestStartInput {
    sessionID: string;
}
interface Options {
    getTodoState: (sessionID: string) => Promise<{
        hasOpenTodos: boolean;
        openCount: number;
        inProgressCount: number;
        pendingCount: number;
    }>;
    shouldInject?: (sessionID: string) => boolean;
    log?: (message: string, meta?: Record<string, unknown>) => void;
}
export declare function createTodoHygiene(options: Options): {
    handleRequestStart(input: RequestStartInput): void;
    handleToolExecuteAfter(input: ToolInput, _output?: unknown): Promise<void>;
    getPendingReminder(sessionID: string): string | null;
    handleEvent(event: EventInput): void;
};
export {};
