import type { AgentConfig as SDKAgentConfig } from '@opencode-ai/sdk/v2';
import type { AgentOverrideConfig } from '../config';
import type { AgentDefinition } from './orchestrator';

/**
 * Apply user-provided overrides to an agent's configuration.
 * Supports overriding model, variant, and temperature.
 */
export function applyOverrides(
  agent: AgentDefinition,
  override: AgentOverrideConfig,
): void {
  const model = override.default?.model ?? override.model;
  if (model) {
    agent.config.model = model;
  }
  if (override.default) {
    agent.config.variant = undefined;
  } else if (override.variant) agent.config.variant = override.variant;
  if (override.temperature !== undefined)
    agent.config.temperature = override.temperature;
  if (override.options) {
    const options =
      agent.name === 'oracle' && 'smart' in override.options
        ? Object.fromEntries(
            Object.entries(override.options).filter(([key]) => key !== 'smart'),
          )
        : override.options;
    agent.config.options = {
      ...agent.config.options,
      ...options,
    };
  }
  if (override.displayName) {
    agent.displayName = override.displayName;
  }
}

/**
 * Apply default permissions to an agent.
 * Sets 'question' permission to 'allow' and allows all skills and MCPs by default.
 *
 * Note: If the agent already explicitly sets question to 'deny', that is
 * respected (e.g., an agent may explicitly deny question permission).
 */
export async function applyDefaultPermissions(
  agent: AgentDefinition,
): Promise<void> {
  const existing = (agent.config.permission ?? {}) as Record<
    string,
    'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>
  >;

  const questionPerm = existing.question === 'deny' ? 'deny' : 'allow';

  // Permission hardening: only fixer may use edit/write/task tools.
  // All other agents are denied these mutation tools by default.
  const isImplementationAgent = agent.name === 'fixer';
  const taskPerm = isImplementationAgent ? undefined : 'deny';
  const editPerm = isImplementationAgent ? undefined : 'deny';
  const writePerm = isImplementationAgent ? undefined : 'deny';

  agent.config.permission = {
    ...existing,
    question: questionPerm,
    ...(taskPerm ? { task: taskPerm } : {}),
    ...(editPerm ? { edit: editPerm } : {}),
    ...(writePerm ? { write: writePerm } : {}),
    // Allow all skills by default
    skill: {
      ...(typeof existing.skill === 'object' ? existing.skill : {}),
      '*': 'allow',
    },
    // Allow all MCPs by default
    mcp: {
      ...(typeof existing.mcp === 'object' ? existing.mcp : {}),
      '*': 'allow',
    },
  } as SDKAgentConfig['permission'];
}
