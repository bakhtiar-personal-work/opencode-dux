import type { AgentDefinition } from './orchestrator';
export { STEWARD_PATH_GLOBS } from './prompt-blocks';
export declare function createStewardAgent(model: string, customPrompt?: string, customAppendPrompt?: string): AgentDefinition;
