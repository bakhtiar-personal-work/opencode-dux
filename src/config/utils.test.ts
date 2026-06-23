import { describe, expect, test } from 'bun:test';
import type { PluginConfig } from './schema';
import { getAgentOverride, getAgentTier, resolveAgentTier } from './utils';

describe('getAgentOverride', () => {
  test('reads override by explicit custom agent key', () => {
    const config = {
      agents: {
        'custom-reviewer': { model: 'openai/gpt-5.4-mini' },
      },
    } as PluginConfig;

    const override = getAgentOverride(config, 'custom-reviewer');

    expect(override).toBeDefined();
    expect(override?.model).toBe('openai/gpt-5.4-mini');
  });

  test('reads override from legacy alias when mapped', () => {
    const config = {
      agents: {
        explore: { model: 'openai/gpt-5.4-mini' },
      },
    } as PluginConfig;

    const override = getAgentOverride(config, 'explorer');

    expect(override).toBeDefined();
    expect(override?.model).toBe('openai/gpt-5.4-mini');
  });

  test('returns undefined when no override exists', () => {
    const config = {
      agents: {
        explorer: { model: 'openai/gpt-5.4-mini' },
      },
    } as PluginConfig;

    expect(getAgentOverride(config, 'no-such-agent')).toBeUndefined();
  });
});

describe('resolveAgentTier', () => {
  test('keeps configured variants as-is', () => {
    expect(
      resolveAgentTier({
        model: 'test/model',
        variants: ['high', 'max'],
      }),
    ).toEqual({
      model: 'test/model',
      variants: ['high', 'max'],
    });
  });

  test('leaves variants undefined when config omits them', () => {
    expect(resolveAgentTier({ model: 'test/model' })).toEqual({
      model: 'test/model',
    });
  });

  test('drops variants when thinking is false', () => {
    expect(
      resolveAgentTier({
        model: 'test/model',
        thinking: false,
        variants: ['high'],
      }),
    ).toEqual({
      model: 'test/model',
      thinking: false,
      variants: undefined,
    });
  });
});

describe('getAgentTier', () => {
  test('reads simple top-level thinking and variants for non-oracle agents', () => {
    const config = {
      agents: {
        explorer: {
          model: 'test/explorer',
          thinking: true,
          variants: ['low', 'high'],
        },
      },
    } as PluginConfig;

    expect(getAgentTier(config, 'explorer')).toEqual({
      model: 'test/explorer',
      thinking: true,
      variants: ['low', 'high'],
    });
  });

  test('reads oracle top-level fields as default tier while keeping smart nested', () => {
    const config = {
      agents: {
        oracle: {
          model: 'neuralwatt/glm-5.2',
          thinking: true,
          variants: ['high', 'max'],
          smart: {
            model: 'openai/gpt-5.4',
            thinking: true,
            variants: ['high', 'xhigh'],
          },
        },
      },
    } as PluginConfig;

    expect(getAgentTier(config, 'oracle')).toEqual({
      model: 'neuralwatt/glm-5.2',
      thinking: true,
      variants: ['high', 'max'],
    });
    expect(getAgentTier(config, 'oracle', 'smart')).toEqual({
      model: 'openai/gpt-5.4',
      thinking: true,
      variants: ['high', 'xhigh'],
    });
  });
});
