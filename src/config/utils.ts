import { AGENT_ALIASES } from './constants';
import type {
  AgentOverrideConfig,
  AgentTierConfig,
  PluginConfig,
  Preset,
} from './schema';

export type ResolvedAgentTier = AgentTierConfig & {
  variants?: string[];
};

/**
 * Get agent override config by name, supporting backward-compatible aliases.
 * Checks both the current name and any legacy alias names.
 *
 * @param config - The plugin configuration
 * @param name - The current agent name
 * @returns The agent-specific override configuration if found
 */
export function getAgentOverride(
  config: PluginConfig | undefined,
  name: string,
): AgentOverrideConfig | undefined {
  const overrides = config?.agents ?? {};
  return (
    overrides[name] ??
    overrides[
      Object.keys(AGENT_ALIASES).find((k) => AGENT_ALIASES[k] === name) ?? ''
    ]
  );
}

export function getAgentTier(
  config: PluginConfig | undefined,
  name: string,
  tier: 'default' | 'smart' = 'default',
): AgentTierConfig | undefined {
  if (tier === 'smart' && name !== 'oracle') return undefined;
  const override = getAgentOverride(config, name);
  const configured = override?.[tier];
  if (configured) return configured;

  if (tier === 'default' && override?.model) {
    return {
      model: override.model,
      thinking: override.thinking,
      variants: override.variants,
    };
  }

  const legacySmart = override?.options?.smart;
  return tier === 'smart' && typeof legacySmart === 'string'
    ? { model: legacySmart }
    : undefined;
}

export function resolveAgentTier(tier: AgentTierConfig): ResolvedAgentTier {
  if (tier.thinking === false) return { ...tier, variants: undefined };
  return tier;
}

export function getPresetAgentOverrides(
  preset: Preset | undefined,
): Record<string, AgentOverrideConfig> {
  if (!preset) {
    return {};
  }

  const overrides: Record<string, AgentOverrideConfig> = {};
  for (const [key, value] of Object.entries(preset)) {
    if (key === 'customInstruction') {
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    overrides[key] = value as AgentOverrideConfig;
  }

  return overrides;
}
