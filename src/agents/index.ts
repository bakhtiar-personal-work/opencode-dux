import type { AgentConfig as SDKAgentConfig } from '@opencode-ai/sdk/v2';
import {
  ALL_AGENT_NAMES,
  DEFAULT_MODELS,
  getAgentOverride,
  loadAgentPrompt,
  type PluginConfig,
  SUBAGENT_NAMES,
} from '../config';
import { createDesignerAgent } from './designer';
import { createExplorerAgent } from './explorer';
import { createFixerAgent } from './fixer';
import { createInterpreterAgent } from './interpreter';
import { createLibrarianAgent } from './librarian';
import { buildOraclePrompt, createOracleAgent } from './oracle';
import { type AgentDefinition, createOrchestratorAgent } from './orchestrator';
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
  // 0. Resolve oracle smart model for conditional prompt injection
  const oracleOverride = getAgentOverride(config, 'oracle');
  const oracleOptions = oracleOverride?.options as
    | Record<string, unknown>
    | undefined;
  const hasSmartModel =
    typeof oracleOptions?.smart === 'string' &&
    (oracleOptions.smart as string).length > 0;

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
        hasSmartModel,
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
      const override = getAgentOverride(config, agent.name);
      if (override) {
        applyOverrides(agent, override);
      }
      // Pass both skills AND mcps from the override
      await applyDefaultPermissions(agent, override?.skills, override?.mcps);
      return agent;
    }),
  );

  const allSubAgents = [...builtInSubAgents];

  // 2a. Compute which subagents have model assignments (for filtering descriptions in orchestrator prompt)
  const enabledSubagentNames = new Set<string>();
  for (const agent of builtInSubAgents) {
    if (
      agent.config.model ||
      (agent._modelArray && agent._modelArray.length > 0)
    ) {
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
  // oracleOverride and oracleOptions are already resolved in step 0 above
  const oracleDefaultModel =
    typeof oracleOverride?.model === 'string'
      ? oracleOverride.model
      : DEFAULT_MODELS.oracle;
  const oracleSmartModel =
    typeof oracleOptions?.smart === 'string' ? oracleOptions.smart : '';
  const oracleSmartModelOrFallback =
    oracleSmartModel.length > 0 ? oracleSmartModel : (oracleDefaultModel ?? '');

  const orchestrator = createOrchestratorAgent(
    orchestratorModel,
    orchestratorPrompts.prompt,
    orchestratorPrompts.appendPrompt,
    oracleDefaultModel as string | undefined,
    oracleSmartModelOrFallback,
    enabledSubagentNames.size > 0 ? enabledSubagentNames : undefined,
  );
  if (orchestratorOverride) {
    applyOverrides(orchestrator, orchestratorOverride);
  }
  await applyDefaultPermissions(
    orchestrator,
    orchestratorOverride?.skills,
    orchestratorOverride?.mcps,
  );

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
