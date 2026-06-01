import { describe, expect, test } from 'bun:test';
import type { PluginConfig } from '../config';
import { resolveDelegatedAgentConfig } from './delegate';

describe('resolveDelegatedAgentConfig', () => {
  test('uses explicit requested model over config', () => {
    const config: PluginConfig = {
      agents: {
        explorer: { model: 'config/explorer-model', variant: 'high' },
      },
    };

    const resolved = resolveDelegatedAgentConfig(config, 'explorer', {
      model: 'requested/explorer-model',
      variant: 'low',
    });

    expect(resolved.model).toBe('requested/explorer-model');
    expect(resolved.variant).toBe('high');
  });

  test('uses configured model for direct agent key when no explicit model is passed', () => {
    const config: PluginConfig = {
      agents: {
        explorer: { model: 'config/explorer-model' },
      },
    };

    const resolved = resolveDelegatedAgentConfig(config, 'explorer', {
      variant: 'medium',
    });

    expect(resolved.model).toBe('config/explorer-model');
    expect(resolved.variant).toBe('medium');
  });

  test('uses configured model from legacy alias when delegating by runtime agent name', () => {
    const config: PluginConfig = {
      agents: {
        explore: { model: 'alias/explorer-model' },
      },
    };

    const resolved = resolveDelegatedAgentConfig(config, 'explorer', {
      variant: 'medium',
    });

    expect(resolved.model).toBe('alias/explorer-model');
    expect(resolved.variant).toBe('medium');
  });
});
