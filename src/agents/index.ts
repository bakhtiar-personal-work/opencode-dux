import type { AgentConfig as SDKAgentConfig } from '@opencode-ai/sdk/v2';
import {
  ALL_AGENT_NAMES,
  DEFAULT_MODELS,
  getAgentOverride,
  getAgentTier,
  loadAgentPrompt,
  type PluginConfig,
  resolveAgentTier,
  SUBAGENT_NAMES,
} from '../config';
import { createDesignerAgent } from './designer';
import { createExplorerAgent } from './explorer';
import { createFixerAgent } from './fixer';
import { createInterpreterAgent } from './interpreter';
import { createLibrarianAgent } from './librarian';
import { createOracleAgent } from './oracle';
import {
  type AgentDefinition,
  createOrchestratorAgent,
  type SubagentModelRoster,
} from './orchestrator';
import { applyDefaultPermissions, applyOverrides } from './overrides';
import { createStewardAgent } from './steward';

export type { AgentDefinition } from './orchestrator';

type AgentFactory = (
  model: string,
  customPrompt?: string,
  customAppendPrompt?: string,
) => AgentDefinition;

function normalizeDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function injectDisplayNames(
  orchestrator: AgentDefinition,
  nameMap: Map<string, string>,
): void {
  if (nameMap.size === 0) return;
  let prompt = orchestrator.config.prompt;
  if (!prompt) return;

  for (const [internalName, displayName] of nameMap) {
    prompt = prompt.replace(
      new RegExp(`@${escapeRegExp(internalName)}\\b`, 'g'),
      `@${normalizeDisplayName(displayName)}`,
    );
  }

  orchestrator.config.prompt = prompt;
}

function prependCustomInstruction(
  agent: AgentDefinition,
  customInstruction?: string,
): void {
  if (!customInstruction || !agent.config.prompt) {
    return;
  }

  agent.config.prompt = `${customInstruction}\n\n${agent.config.prompt}`;
}

function formatTier(
  name: 'default' | 'smart',
  tier: ReturnType<typeof resolveAgentTier>,
): string {
  const thinking =
    tier.thinking === false
      ? 'thinking=off'
      : tier.variants?.length
        ? `variants=${tier.variants.join(' < ')}`
        : 'variant=provider-default';
  return `${name}=${tier.model} (${thinking})`;
}

function buildSubagentModelRoster(
  agents: AgentDefinition[],
  config?: PluginConfig,
): SubagentModelRoster {
  const roster: SubagentModelRoster = {};

  for (const agent of agents) {
    const configuredModels: string[] = [];
    const configuredDefault = getAgentTier(config, agent.name) ?? {
      model: agent.config.model as string,
    };
    if (configuredDefault.model) {
      configuredModels.push(
        formatTier('default', resolveAgentTier(configuredDefault)),
      );
    }

    const smart = getAgentTier(config, agent.name, 'smart');
    if (smart) {
      configuredModels.push(formatTier('smart', resolveAgentTier(smart)));
    }

    if (configuredModels.length > 0) {
      roster[agent.name] = configuredModels;
    }
  }

  return roster;
}

function resolveOracleSmartModel(config?: PluginConfig): string {
  return getAgentTier(config, 'oracle', 'smart')?.model ?? '';
}

// Agent Classification

export type SubagentName = (typeof SUBAGENT_NAMES)[number];

export function isSubagent(name: string): name is SubagentName {
  return (SUBAGENT_NAMES as readonly string[]).includes(name);
}

// Agent Factories

const SUBAGENT_FACTORIES = {
  explorer: createExplorerAgent,
  librarian: createLibrarianAgent,
  oracle: createOracleAgent,
  designer: createDesignerAgent,
  fixer: createFixerAgent,
  steward: createStewardAgent,
  interpreter: createInterpreterAgent,
} satisfies Record<SubagentName, AgentFactory>;

// Public API

/**
 * Create all agent definitions with optional configuration overrides.
 * Instantiates the orchestrator and all subagents, applying user config and defaults.
 *
 * @param config - Optional plugin configuration with agent overrides
 * @returns Array of agent definitions (orchestrator first, then subagents)
 */
export async function createAgents(
  config?: PluginConfig,
): Promise<AgentDefinition[]> {
  const oracleSmartModel = resolveOracleSmartModel(config);

  // 1. Gather all sub-agent definitions with custom prompts
  const protoSubAgents = (
    Object.entries(SUBAGENT_FACTORIES) as [SubagentName, AgentFactory][]
  ).map(([name, factory]) => {
    const customPrompts = loadAgentPrompt(name, config?.preset);
    if (name === 'oracle') {
      return createOracleAgent(
        DEFAULT_MODELS[name] as string,
        customPrompts.prompt,
        customPrompts.appendPrompt,
      );
    }
    return factory(
      DEFAULT_MODELS[name] as string,
      customPrompts.prompt,
      customPrompts.appendPrompt,
    );
  });

  // 2. Apply overrides and default permissions to built-in subagents
  const builtInSubAgents = await Promise.all(
    protoSubAgents.map(async (agent) => {
      prependCustomInstruction(agent, config?.customInstruction);
      const override = getAgentOverride(config, agent.name);
      if (override) {
        applyOverrides(agent, override);
      }
      await applyDefaultPermissions(agent);
      return agent;
    }),
  );

  const allSubAgents = [...builtInSubAgents];

  // 2a. Compute which subagents have model assignments (for filtering descriptions in orchestrator prompt)
  const enabledSubagentNames = new Set<string>();
  for (const agent of builtInSubAgents) {
    if (agent.config.model) {
      enabledSubagentNames.add(agent.name);
    }
  }

  // 3. Create Orchestrator (with its own overrides and custom prompts)
  // Model is resolved from DEFAULT_MODELS.orchestrator (or user override).
  // TUI /model selector overrides at runtime regardless.
  const orchestratorOverride = getAgentOverride(config, 'orchestrator');
  const orchestratorModel =
    orchestratorOverride?.model ?? DEFAULT_MODELS.orchestrator;
  const orchestratorPrompts = loadAgentPrompt('orchestrator', config?.preset);

  // 3a. Resolve oracle model names for prompt injection
  // (avoids hardcoding model IDs in the prompt text)
  const oracleDefaultModel =
    getAgentTier(config, 'oracle')?.model ?? DEFAULT_MODELS.oracle;
  const oracleSmartModelOrFallback =
    oracleSmartModel.length > 0 ? oracleSmartModel : (oracleDefaultModel ?? '');
  const subagentModelRoster = buildSubagentModelRoster(
    builtInSubAgents,
    config,
  );

  const orchestrator = createOrchestratorAgent(
    orchestratorModel,
    orchestratorPrompts.prompt,
    orchestratorPrompts.appendPrompt,
    oracleDefaultModel as string | undefined,
    oracleSmartModelOrFallback,
    enabledSubagentNames.size > 0 ? enabledSubagentNames : undefined,
    subagentModelRoster,
    config?.customInstruction,
  );
  if (orchestratorOverride) {
    applyOverrides(orchestrator, orchestratorOverride);
  }
  await applyDefaultPermissions(orchestrator);

  // Collect all display names from orchestrator and all subagents
  const displayNameMap = new Map<string, string>();
  if (orchestrator.displayName) {
    displayNameMap.set('orchestrator', orchestrator.displayName);
  }
  for (const agent of allSubAgents) {
    if (agent.displayName) {
      displayNameMap.set(agent.name, agent.displayName);
    }
  }

  // Validate display names
  const usedDisplayNames = new Set<string>();
  for (const [, displayName] of displayNameMap) {
    const normalizedDisplayName = normalizeDisplayName(displayName);
    if (usedDisplayNames.has(normalizedDisplayName)) {
      throw new Error(
        `Duplicate displayName '${normalizedDisplayName}' assigned to multiple agents`,
      );
    }
    usedDisplayNames.add(normalizedDisplayName);
  }
  for (const displayName of usedDisplayNames) {
    if ((ALL_AGENT_NAMES as readonly string[]).includes(displayName)) {
      throw new Error(
        `displayName '${displayName}' conflicts with an agent name`,
      );
    }
  }

  // Inject display names into orchestrator prompt (complete map)
  injectDisplayNames(orchestrator, displayNameMap);

  return [orchestrator, ...allSubAgents];
}

/**
 * Get agent configurations formatted for the OpenCode SDK.
 * Converts agent definitions to SDK config format and applies classification metadata.
 *
 * @param config - Optional plugin configuration with agent overrides
 * @returns Record mapping agent names to their SDK configurations
 */
export async function getAgentConfigs(
  config?: PluginConfig,
): Promise<Record<string, SDKAgentConfig>> {
  const agents = await createAgents(config);

  const applyClassification = (
    name: string,
    sdkConfig: SDKAgentConfig & {
      displayName?: string;
      hidden?: boolean;
    },
  ): void => {
    if (isSubagent(name)) {
      sdkConfig.mode = 'subagent';
    } else if (name === 'orchestrator') {
      sdkConfig.mode = 'primary';
    } else {
      sdkConfig.mode = 'subagent';
    }
  };

  const entries: Array<[string, SDKAgentConfig]> = [];

  for (const a of agents) {
    const sdkConfig: SDKAgentConfig & {
      displayName?: string;
      hidden?: boolean;
    } = {
      ...a.config,
      description: a.description,
    };

    if (a.displayName) {
      sdkConfig.displayName = a.displayName;
    }

    applyClassification(a.name, sdkConfig);

    const normalizedDisplayName = a.displayName
      ? normalizeDisplayName(a.displayName)
      : undefined;

    if (normalizedDisplayName) {
      entries.push([normalizedDisplayName, sdkConfig]);
      entries.push([a.name, { ...sdkConfig, hidden: true }]);
      continue;
    }

    entries.push([a.name, sdkConfig]);
  }

  return Object.fromEntries(entries);
}
