import type { AgentName } from '../config';
export interface ContextFile {
    path: string;
    lineCount: number;
    lineNumbers?: number[];
    lastReadAt: number;
}
export interface RememberedTaskSession {
    alias: string;
    taskId: string;
    agentType: AgentName;
    label: string;
    contextFiles: ContextFile[];
    createdAt: number;
    lastUsedAt: number;
}
interface SessionManagerOptions {
    readContextMinLines?: number;
    readContextMaxFiles?: number;
}
export declare function deriveTaskSessionLabel(input: {
    description?: string;
    prompt?: string;
    agentType: AgentName;
}): string;
export declare class SessionManager {
    private readonly maxSessionsPerAgent;
    private readonly readContextMinLines;
    private readonly readContextMaxFiles;
    private readonly sessionsByParent;
    private readonly nextAliasIndexByParent;
    private orderCounter;
    constructor(maxSessionsPerAgent: number, options?: SessionManagerOptions);
    remember(input: {
        parentSessionId: string;
        taskId: string;
        agentType: AgentName;
        label: string;
    }): RememberedTaskSession;
    markUsed(parentSessionId: string, agentType: AgentName, key: string): void;
    resolve(parentSessionId: string, agentType: AgentName, key: string): RememberedTaskSession | undefined;
    drop(parentSessionId: string, agentType: AgentName, key: string): void;
    dropTask(taskId: string): void;
    taskIds(): Set<string>;
    addContext(taskId: string, files: ContextFile[]): void;
    clearParent(parentSessionId: string): void;
    formatForPrompt(parentSessionId: string): string | undefined;
    private getAgentGroup;
    private setAgentGroup;
    private nextAlias;
    private trimGroup;
    private trimContextFiles;
    private nextOrder;
}
export {};
