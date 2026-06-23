import type { InstallConfig } from './types';

const SCHEMA_URL =
  'https://unpkg.com/opencode-dux@latest/opencode-dux.schema.json';

export const GENERATED_PRESETS = ['openai', 'opencode-go'] as const;

// Model mappings by provider/preset.
export const MODEL_MAPPINGS = {
  openai: {
    orchestrator: { model: 'openai/gpt-5.5' },
    oracle: { model: 'openai/gpt-5.5', variants: ['high'] },
    librarian: { model: 'openai/gpt-5.4-mini', variants: ['low'] },
    explorer: { model: 'openai/gpt-5.4-mini', variants: ['low'] },
    designer: { model: 'openai/gpt-5.4-mini', variants: ['medium'] },
    fixer: { model: 'openai/gpt-5.4-mini', variants: ['low'] },
  },
  kimi: {
    orchestrator: { model: 'kimi-for-coding/k2p5' },
    oracle: { model: 'kimi-for-coding/k2p5', variants: ['high'] },
    librarian: { model: 'kimi-for-coding/k2p5', variants: ['low'] },
    explorer: { model: 'kimi-for-coding/k2p5', variants: ['low'] },
    designer: { model: 'kimi-for-coding/k2p5', variants: ['medium'] },
    fixer: { model: 'kimi-for-coding/k2p5', variants: ['low'] },
  },
  copilot: {
    orchestrator: { model: 'github-copilot/claude-opus-4.6' },
    oracle: { model: 'github-copilot/claude-opus-4.6', variants: ['high'] },
    librarian: { model: 'github-copilot/grok-code-fast-1', variants: ['low'] },
    explorer: { model: 'github-copilot/grok-code-fast-1', variants: ['low'] },
    designer: {
      model: 'github-copilot/gemini-3.1-pro-preview',
      variants: ['medium'],
    },
    fixer: { model: 'github-copilot/claude-sonnet-4.6', variants: ['low'] },
  },
  'zai-plan': {
    orchestrator: { model: 'zai-coding-plan/glm-5' },
    oracle: { model: 'zai-coding-plan/glm-5', variants: ['high'] },
    librarian: { model: 'zai-coding-plan/glm-5', variants: ['low'] },
    explorer: { model: 'zai-coding-plan/glm-5', variants: ['low'] },
    designer: { model: 'zai-coding-plan/glm-5', variants: ['medium'] },
    fixer: { model: 'zai-coding-plan/glm-5', variants: ['low'] },
  },
  'opencode-go': {
    orchestrator: {
      model: 'neuralwatt/zai-org/GLM-5.1-FP8',
      variants: ['medium'],
    },
    oracle: { model: 'opencode-go/deepseek-v4-flash', variants: ['medium'] },
    librarian: { model: 'opencode-go/deepseek-v4-flash', variants: ['low'] },
    explorer: { model: 'neuralwatt/qwen3.5-397b-fast', variants: ['low'] },
    designer: { model: 'opencode-go/mimo-v2.5-pro', variants: ['medium'] },
    fixer: { model: 'opencode-go/deepseek-v4-flash', variants: ['low'] },
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
    modelInfo: { model: string; variants?: string[] },
  ) => {
    return {
      model: modelInfo.model,
      variants: modelInfo.variants,
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

  return config;
}
