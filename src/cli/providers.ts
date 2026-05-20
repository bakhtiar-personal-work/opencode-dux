import type { InstallConfig } from './types';

const SCHEMA_URL =
  'https://unpkg.com/opencode-dux@latest/opencode-dux.schema.json';

export const GENERATED_PRESETS = ['openai', 'opencode-go'] as const;

// Model mappings by provider/preset.
export const MODEL_MAPPINGS = {
  openai: {
    orchestrator: { model: 'openai/gpt-5.5' },
    oracle: { model: 'openai/gpt-5.5', variant: 'high' },
    librarian: { model: 'openai/gpt-5.4-mini', variant: 'low' },
    explorer: { model: 'openai/gpt-5.4-mini', variant: 'low' },
    designer: { model: 'openai/gpt-5.4-mini', variant: 'medium' },
    fixer: { model: 'openai/gpt-5.4-mini', variant: 'low' },
  },
  kimi: {
    orchestrator: { model: 'kimi-for-coding/k2p5' },
    oracle: { model: 'kimi-for-coding/k2p5', variant: 'high' },
    librarian: { model: 'kimi-for-coding/k2p5', variant: 'low' },
    explorer: { model: 'kimi-for-coding/k2p5', variant: 'low' },
    designer: { model: 'kimi-for-coding/k2p5', variant: 'medium' },
    fixer: { model: 'kimi-for-coding/k2p5', variant: 'low' },
  },
  copilot: {
    orchestrator: { model: 'github-copilot/claude-opus-4.6' },
    oracle: { model: 'github-copilot/claude-opus-4.6', variant: 'high' },
    librarian: { model: 'github-copilot/grok-code-fast-1', variant: 'low' },
    explorer: { model: 'github-copilot/grok-code-fast-1', variant: 'low' },
    designer: {
      model: 'github-copilot/gemini-3.1-pro-preview',
      variant: 'medium',
    },
    fixer: { model: 'github-copilot/claude-sonnet-4.6', variant: 'low' },
  },
  'zai-plan': {
    orchestrator: { model: 'zai-coding-plan/glm-5' },
    oracle: { model: 'zai-coding-plan/glm-5', variant: 'high' },
    librarian: { model: 'zai-coding-plan/glm-5', variant: 'low' },
    explorer: { model: 'zai-coding-plan/glm-5', variant: 'low' },
    designer: { model: 'zai-coding-plan/glm-5', variant: 'medium' },
    fixer: { model: 'zai-coding-plan/glm-5', variant: 'low' },
  },
  'opencode-go': {
    orchestrator: {
      model: 'neuralwatt/zai-org/GLM-5.1-FP8',
      variant: 'medium',
    },
    oracle: { model: 'opencode-go/deepseek-v4-flash', variant: 'medium' },
    librarian: { model: 'opencode-go/deepseek-v4-flash', variant: 'low' },
    explorer: { model: 'neuralwatt/qwen3.5-397b-fast', variant: 'low' },
    designer: { model: 'opencode-go/mimo-v2.5-pro', variant: 'medium' },
    fixer: { model: 'opencode-go/deepseek-v4-flash', variant: 'low' },
  },
} as const;

export type PresetName = keyof typeof MODEL_MAPPINGS;
export type GeneratedPresetName = (typeof GENERATED_PRESETS)[number];

export function isPresetName(value: string): value is PresetName {
  return Object.hasOwn(MODEL_MAPPINGS, value);
}

export function getPresetNames(): PresetName[] {
  return Object.keys(MODEL_MAPPINGS) as PresetName[];
}

export function isGeneratedPresetName(
  value: string,
): value is GeneratedPresetName {
  return GENERATED_PRESETS.includes(value as GeneratedPresetName);
}

export function getGeneratedPresetNames(): GeneratedPresetName[] {
  return [...GENERATED_PRESETS];
}

export function generateLiteConfig(
  installConfig: InstallConfig,
): Record<string, unknown> {
  const preset = installConfig.preset ?? 'openai';
  if (!isGeneratedPresetName(preset)) {
    throw new Error(
      `Unsupported preset "${preset}". Available generated presets: ${getGeneratedPresetNames().join(', ')}`,
    );
  }

  const config: Record<string, unknown> = {
    $schema: SCHEMA_URL,
    preset,
    presets: {},
  };

  const createAgentConfig = (
    agentName: string,
    modelInfo: { model: string; variant?: string },
  ) => {
    return {
      model: modelInfo.model,
      variant: modelInfo.variant,
    };
  };

  const buildPreset = (mappingName: PresetName) => {
    const mapping = MODEL_MAPPINGS[mappingName];
    return Object.fromEntries(
      Object.entries(mapping).map(([agentName, modelInfo]) => [
        agentName,
        createAgentConfig(agentName, modelInfo),
      ]),
    );
  };

  const presets = config.presets as Record<string, unknown>;
  for (const presetName of GENERATED_PRESETS) {
    presets[presetName] = buildPreset(presetName);
  }

  // Pre-populate skills section so new installs don't hit the fallback path.
  // Permissions are controlled via always-load + wildcard per agent.
  config.agents = {
    orchestrator: {
      skills: { 'always-load': ['find-skills'], wildcard: true },
    },
    designer: {
      skills: {
        'always-load': ['agent-browser', 'web-design-guidelines'],
        wildcard: false,
      },
    },
    oracle: {
      skills: { 'always-load': ['requesting-code-review'], wildcard: false },
    },
    librarian: {
      skills: { 'always-load': ['find-skills'], wildcard: false },
    },
  };

  return config;
}
