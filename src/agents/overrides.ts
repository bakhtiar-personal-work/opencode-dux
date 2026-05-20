import type { AgentConfig as SDKAgentConfig } from '@opencode-ai/sdk/v2';
import { getMcpPermissionsForAgent } from '../cli/mcps';
import { getSkillPermissionsForAgent } from '../cli/skills';
import type { AgentOverrideConfig, SkillOrMcpConfig } from '../config';
import type { AgentDefinition } from './orchestrator';

/**
 * Apply user-provided overrides to an agent's configuration.
 * Supports overriding model (string or priority array), variant, and temperature.
 * When model is an array, stores it as _modelArray for runtime fallback resolution
 * and clears config.model so OpenCode does not pre-resolve a stale value.
 */
export function applyOverrides(
  agent: AgentDefinition,
  override: AgentOverrideConfig,
): void {
  if (override.model) {
    if (Array.isArray(override.model)) {
      agent._modelArray = override.model.map((m) =>
        typeof m === 'string' ? { id: m } : m,
      );
      agent.config.model = undefined; // cleared; runtime hook resolves from _modelArray
    } else {
      agent.config.model = override.model;
    }
  }
  if (override.variant) agent.config.variant = override.variant;
  if (override.temperature !== undefined)
    agent.config.temperature = override.temperature;
  if (override.options) {
    agent.config.options = {
      ...agent.config.options,
      ...override.options,
    };
  }
  if (override.displayName) {
    agent.displayName = override.displayName;
  }
}

/**
 * Apply default permissions to an agent.
 * Sets 'question' permission to 'allow' and includes skill permission presets.
 * If configuredSkills is provided, it honors that list instead of defaults.
 *
 * Note: If the agent already explicitly sets question to 'deny', that is
 * respected (e.g., an agent may explicitly deny question permission).
 */
export async function applyDefaultPermissions(
  agent: AgentDefinition,
  configuredSkills?: SkillOrMcpConfig,
  configuredMcps?: SkillOrMcpConfig,
): Promise<void> {
  const existing = (agent.config.permission ?? {}) as Record<
    string,
    'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>
  >;

  // Get skill-specific permissions for this agent
  const skillPermissions = await getSkillPermissionsForAgent(
    agent.name,
    configuredSkills,
  );

  // Get MCP-specific permissions
  const mcpPermissions = await getMcpPermissionsForAgent(
    agent.name,
    configuredMcps,
  );

  const questionPerm = existing.question === 'deny' ? 'deny' : 'allow';

  // Orchestrator: block built-in Task tool (uses delegate_subagent instead)
  const taskPerm = agent.name === 'orchestrator' ? 'deny' : undefined;
  const editPerm = agent.name === 'orchestrator' ? 'deny' : undefined;
  const writePerm = agent.name === 'orchestrator' ? 'deny' : undefined;

  agent.config.permission = {
    ...existing,
    question: questionPerm,
    ...(taskPerm ? { task: taskPerm } : {}),
    ...(editPerm ? { edit: editPerm } : {}),
    ...(writePerm ? { write: writePerm } : {}),
    // Apply skill permissions as nested object under 'skill' key
    skill: {
      ...(typeof existing.skill === 'object' ? existing.skill : {}),
      ...skillPermissions,
    },
    // Store MCP permissions for delegate tool consumption
    mcp: {
      ...(typeof existing.mcp === 'object' ? existing.mcp : {}),
      ...mcpPermissions,
    },
  } as SDKAgentConfig['permission'];
}
