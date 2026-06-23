import { describe, expect, test } from 'bun:test';
import type { PluginConfig } from './schema';
import { getAgentOverride, resolveAgentTier } from './utils';

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
