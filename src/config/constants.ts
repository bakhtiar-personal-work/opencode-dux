// Agent names
export const AGENT_ALIASES: Record<string, string> = {
  explore: 'explorer',
  'frontend-ui-ux-engineer': 'designer',
};

export const SUBAGENT_NAMES = [
  'explorer',
  'librarian',
  'oracle',
  'designer',
  'fixer',
  'steward',
  'interpreter',
] as const;

export const ORCHESTRATOR_NAME = 'orchestrator' as const;

export const ALL_AGENT_NAMES = [ORCHESTRATOR_NAME, ...SUBAGENT_NAMES] as const;

// Agent name type (for use in DEFAULT_MODELS)
export type AgentName = (typeof ALL_AGENT_NAMES)[number];

// Default models for each agent
// Hybrid NeuralWatt + OpenCode-Go strategy:
// - Orchestrator on NeuralWatt GLM-5.1 (energy-efficient, strong routing)
// - Explorer on NeuralWatt Qwen3.5-397B-Fast (cheap MoE, tool-calling, no reasoning overhead)
// - Oracle, Librarian, Designer, Fixer on OpenCode-Go (proven reliability)
export const DEFAULT_MODELS: Record<AgentName, string | undefined> = {
  orchestrator: 'neuralwatt/zai-org/GLM-5.1-FP8',
  oracle: 'opencode-go/deepseek-v4-flash',
  librarian: 'opencode-go/deepseek-v4-flash',
  explorer: 'neuralwatt/qwen3.5-397b-fast',
  designer: 'opencode-go/mimo-v2.5-pro',
  fixer: 'opencode-go/deepseek-v4-flash',
  steward: 'opencode-go/deepseek-v4-flash',
  interpreter: 'opencode-go/mimo-v2.5-pro',
};

// Polling configuration
export const POLL_INTERVAL_MS = 500;

// Timeouts
export const MAX_POLL_TIME_MS = 5 * 60 * 1000; // 5 minutes

// Subagent depth limits
export const DEFAULT_MAX_SUBAGENT_DEPTH = 10;

// Workflow reminders
export const PHASE_REMINDER_TEXT = `!IMPORTANT! Follow <first_gate> order in system prompt; delegate_subagent in the same turn you name the agent. !END!`;

// Polling stability
export const STABLE_POLLS_THRESHOLD = 3;

// SDK discovery timeout for local MCP/skill scans (milliseconds).
// Prevents plugin init from hanging when the SDK is not ready.
// Adjustable via config override at build/runtime.
export const SDK_DISCOVERY_TIMEOUT_MS = 10_000; // 10 seconds
