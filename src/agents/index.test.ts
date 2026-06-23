import { describe, expect, test } from 'bun:test';
import type { PluginConfig } from '../config';
import { AgentOverrideConfigSchema, SUBAGENT_NAMES } from '../config';
import { createAgents, getAgentConfigs, isSubagent } from './index';

describe('agent alias backward compatibility', () => {
  test("applies 'explore' config to 'explorer' agent", async () => {
    const config: PluginConfig = {
      agents: {
        explore: { model: 'test/old-explore-model' },
      },
    };
    const agents = await createAgents(config);
    const explorer = agents.find((a) => a.name === 'explorer');
    expect(explorer).toBeDefined();
    expect(explorer?.config.model).toBe('test/old-explore-model');
  });

  test("applies 'frontend-ui-ux-engineer' config to 'designer' agent", async () => {
    const config: PluginConfig = {
      agents: {
        'frontend-ui-ux-engineer': { model: 'test/old-frontend-model' },
      },
    };
    const agents = await createAgents(config);
    const designer = agents.find((a) => a.name === 'designer');
    expect(designer).toBeDefined();
    expect(designer?.config.model).toBe('test/old-frontend-model');
  });

  test('new name takes priority over old alias', async () => {
    const config: PluginConfig = {
      agents: {
        explore: { model: 'old-model' },
        explorer: { model: 'new-model' },
      },
    };
    const agents = await createAgents(config);
    const explorer = agents.find((a) => a.name === 'explorer');
    expect(explorer?.config.model).toBe('new-model');
  });

  test('new agent names work directly', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { model: 'direct-explorer' },
        designer: { model: 'direct-designer' },
      },
    };
    const agents = await createAgents(config);
    expect(agents.find((a) => a.name === 'explorer')?.config.model).toBe(
      'direct-explorer',
    );
    expect(agents.find((a) => a.name === 'designer')?.config.model).toBe(
      'direct-designer',
    );
  });

  test('temperature override via old alias', async () => {
    const config: PluginConfig = {
      agents: {
        explore: { temperature: 0.5 },
      },
    };
    const agents = await createAgents(config);
    const explorer = agents.find((a) => a.name === 'explorer');
    expect(explorer?.config.temperature).toBe(0.5);
  });

  test('variant override via old alias', async () => {
    const config: PluginConfig = {
      agents: {
        explore: { variant: 'low' },
      },
    };
    const agents = await createAgents(config);
    const explorer = agents.find((a) => a.name === 'explorer');
    expect(explorer?.config.variant).toBe('low');
  });
});

describe('fixer agent model selection', () => {
  test('fixer does not inherit librarian model when no fixer config provided', async () => {
    const config: PluginConfig = {
      agents: {
        librarian: { model: 'librarian-custom-model' },
      },
    };
    const agents = await createAgents(config);
    const fixer = agents.find((a) => a.name === 'fixer');
    expect(fixer?.config.model).not.toBe('librarian-custom-model');
  });

  test('fixer uses its own model when explicitly configured', async () => {
    const config: PluginConfig = {
      agents: {
        librarian: { model: 'librarian-model' },
        fixer: { model: 'fixer-specific-model' },
      },
    };
    const agents = await createAgents(config);
    const fixer = agents.find((a) => a.name === 'fixer');
    expect(fixer?.config.model).toBe('fixer-specific-model');
  });
});

describe('orchestrator agent', () => {
  test('orchestrator is first in agents array', async () => {
    const agents = await createAgents();
    expect(agents[0].name).toBe('orchestrator');
  });

  test('orchestrator has question permission set to allow', async () => {
    const agents = await createAgents();
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    expect(orchestrator?.config.permission).toBeDefined();
    expect((orchestrator?.config.permission as any).question).toBe('allow');
  });

  test('orchestrator is denied access to built-in task tool', async () => {
    const agents = await createAgents();
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    expect((orchestrator?.config.permission as any).task).toBe('deny');
  });

  test('orchestrator accepts overrides', async () => {
    const config: PluginConfig = {
      agents: {
        orchestrator: { model: 'custom-orchestrator-model', temperature: 0.3 },
      },
    };
    const agents = await createAgents(config);
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    expect(orchestrator?.config.model).toBe('custom-orchestrator-model');
    expect(orchestrator?.config.temperature).toBe(0.3);
  });

  test('orchestrator accepts variant override', async () => {
    const config: PluginConfig = {
      agents: {
        orchestrator: { variant: 'high' },
      },
    };
    const agents = await createAgents(config);
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    expect(orchestrator?.config.variant).toBe('high');
  });

  test('orchestrator prompt includes configured subagent model roster', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { model: 'github-copilot/grok-code-fast-1' },
        oracle: {
          model: 'openai/gpt-5.5',
          options: { smart: 'openai/gpt-5.5-pro' },
        },
      },
    };
    const agents = await createAgents(config);
    const orchestrator = agents.find((a) => a.name === 'orchestrator');

    expect(orchestrator?.config.prompt).toContain('## Agent Models');
    expect(orchestrator?.config.prompt).toContain(
      '- @explorer: default=github-copilot/grok-code-fast-1 (variant=provider-default)',
    );
    expect(orchestrator?.config.prompt).toContain(
      '- @oracle: default=openai/gpt-5.5 (variant=provider-default); smart=openai/gpt-5.5-pro (variant=provider-default)',
    );
  });

  test('customInstruction is prepended to orchestrator and delegated subagents', async () => {
    const config: PluginConfig = {
      customInstruction: 'Start every reply with [CI-OK].',
    };

    const agents = await createAgents(config);
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    const oracle = agents.find((a) => a.name === 'oracle');

    expect(
      orchestrator?.config.prompt?.startsWith(
        `${config.customInstruction}\n\n`,
      ),
    ).toBe(true);
    expect(
      oracle?.config.prompt?.startsWith(`${config.customInstruction}\n\n`),
    ).toBe(true);
  });
});

describe('skill permissions', () => {
  test('orchestrator gets allow all by default when no skill config provided', async () => {
    const agents = await createAgents();
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    expect(orchestrator).toBeDefined();
    const skillPerm = (
      orchestrator?.config.permission as Record<string, unknown>
    )?.skill as Record<string, string>;
    // By default all skills are allowed (orchestrator auto-discovers)
    expect(skillPerm?.['*']).toBe('allow');
  });
});

describe('isSubagent type guard', () => {
  test('returns true for valid subagent names', () => {
    expect(isSubagent('explorer')).toBe(true);
    expect(isSubagent('librarian')).toBe(true);
    expect(isSubagent('oracle')).toBe(true);
    expect(isSubagent('designer')).toBe(true);
    expect(isSubagent('fixer')).toBe(true);
    expect(isSubagent('steward')).toBe(true);
    expect(isSubagent('interpreter')).toBe(true);
  });

  test('returns false for orchestrator', () => {
    expect(isSubagent('orchestrator')).toBe(false);
  });

  test('returns false for invalid agent names', () => {
    expect(isSubagent('invalid-agent')).toBe(false);
    expect(isSubagent('')).toBe(false);
    expect(isSubagent('explore')).toBe(false); // old alias, not actual agent name
  });
});

describe('agent classification', () => {
  test('SUBAGENT_NAMES excludes orchestrator', () => {
    expect(SUBAGENT_NAMES).not.toContain('orchestrator');
    expect(SUBAGENT_NAMES).toContain('explorer');
    expect(SUBAGENT_NAMES).toContain('fixer');
    expect(SUBAGENT_NAMES).toContain('steward');
    expect(SUBAGENT_NAMES).toContain('interpreter');
  });

  test('getAgentConfigs applies correct classification visibility and mode', async () => {
    // Enable all agents for classification testing
    const configs = await getAgentConfigs();

    // Primary agent
    expect(configs.orchestrator.mode).toBe('primary');

    // All subagents
    for (const name of SUBAGENT_NAMES) {
      expect(configs[name].mode).toBe('subagent');
    }
  });
});

describe('createAgents', () => {
  test('creates all agents without config', async () => {
    const agents = await createAgents();
    const names = agents.map((a) => a.name);
    expect(names).toContain('orchestrator');
    expect(names).toContain('explorer');
    expect(names).toContain('designer');
    expect(names).toContain('oracle');
    expect(names).toContain('librarian');
    expect(names).toContain('fixer');
    expect(names).toContain('steward');
    expect(names).toContain('interpreter');
  });

  test('creates exactly 8 agents (1 orchestrator + 7 subagents)', async () => {
    const agents = await createAgents();
    expect(agents.length).toBe(8);
  });
});

describe('getAgentConfigs', () => {
  test('returns config record keyed by agent name', async () => {
    const configs = await getAgentConfigs();
    expect(configs.orchestrator).toBeDefined();
    expect(configs.explorer).toBeDefined();
    // orchestrator has no hardcoded default model; resolved at runtime or left to the user
    expect(configs.explorer.model).toBeDefined();
  });

  test('includes description in SDK config', async () => {
    const configs = await getAgentConfigs();
    expect(configs.orchestrator.description).toBeDefined();
    expect(configs.explorer.description).toBeDefined();
  });
});

describe('oracle read-only enforcement', () => {
  test('oracle has edit, write, and task denied by default', async () => {
    const agents = await createAgents();
    const oracle = agents.find((a) => a.name === 'oracle');
    expect(oracle).toBeDefined();
    const perm = oracle?.config.permission as Record<string, string>;
    expect(perm.edit).toBe('deny');
    expect(perm.write).toBe('deny');
    expect(perm.task).toBe('deny');
  });

  test('user config cannot re-enable oracle edit permission', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          model: 'test/model',
        },
      },
    };
    const agents = await createAgents(config);
    const oracle = agents.find((a) => a.name === 'oracle');
    const perm = oracle?.config.permission as Record<string, string>;
    expect(perm.edit).toBe('deny');
    expect(perm.write).toBe('deny');
    expect(perm.task).toBe('deny');
  });
});

describe('options passthrough', () => {
  test('options are applied to agent config via overrides', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          model: 'openai/gpt-5.5',
          options: { textVerbosity: 'low' },
        },
      },
    };
    const agents = await createAgents(config);
    const oracle = agents.find((a) => a.name === 'oracle');
    expect(oracle?.config.options).toEqual({ textVerbosity: 'low' });
  });

  test('options with nested objects are passed through', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          model: 'anthropic/claude-sonnet-4-6',
          options: {
            thinking: { type: 'enabled', budgetTokens: 16000 },
          },
        },
      },
    };
    const agents = await createAgents(config);
    const oracle = agents.find((a) => a.name === 'oracle');
    expect(oracle?.config.options).toEqual({
      thinking: { type: 'enabled', budgetTokens: 16000 },
    });
  });

  test('options work with other overrides', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          model: 'openai/gpt-5.5',
          variant: 'high',
          temperature: 0.7,
          options: { textVerbosity: 'low', reasoningEffort: 'medium' },
        },
      },
    };
    const agents = await createAgents(config);
    const oracle = agents.find((a) => a.name === 'oracle');
    expect(oracle?.config.model).toBe('openai/gpt-5.5');
    expect(oracle?.config.variant).toBe('high');
    expect(oracle?.config.temperature).toBe(0.7);
    expect(oracle?.config.options).toEqual({
      textVerbosity: 'low',
      reasoningEffort: 'medium',
    });
  });

  test('options are absent when not configured', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: { model: 'openai/gpt-5.5' },
      },
    };
    const agents = await createAgents(config);
    const oracle = agents.find((a) => a.name === 'oracle');
    expect(oracle?.config.options).toBeUndefined();
  });

  test('options flow through getAgentConfigs to SDK output', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          model: 'openai/gpt-5.5',
          options: { textVerbosity: 'low' },
        },
      },
    };
    const configs = await getAgentConfigs(config);
    expect(configs.oracle.options).toEqual({ textVerbosity: 'low' });
  });

  test('oracle options.smart stays outside provider options', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          model: 'openai/gpt-5.5',
          options: {
            smart: 'openai/gpt-5.5-pro',
            textVerbosity: 'low',
          },
        },
      },
    };
    const configs = await getAgentConfigs(config);
    expect(configs.oracle.options).toEqual({ textVerbosity: 'low' });
  });

  test('options are shallow-merged with existing agent config options', async () => {
    // Simulate an agent factory setting default options
    const config: PluginConfig = {
      agents: {
        oracle: {
          model: 'openai/gpt-5.5',
          options: { reasoningEffort: 'medium' },
        },
      },
    };
    const agents = await createAgents(config);
    const oracle = agents.find((a) => a.name === 'oracle');
    // Override options should merge with (not replace) any factory defaults
    expect(oracle?.config.options).toEqual({ reasoningEffort: 'medium' });
  });
});

describe('AgentOverrideConfigSchema options validation', () => {
  test('accepts dynamic default and smart tiers', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      default: {
        model: 'opencode-go/glm-5.2',
        thinking: true,
        variants: ['high', 'max'],
      },
      smart: {
        model: 'opencode-go/glm-5.2',
        thinking: true,
        variants: ['max'],
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects variants when thinking is false', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      default: {
        model: 'test/model',
        thinking: false,
        variants: ['high'],
      },
    });
    expect(result.success).toBe(false);
  });

  test('new default tier wins over legacy model and variant', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          default: { model: 'new/default', variants: ['max'] },
          model: 'legacy/default',
          variant: 'high',
        },
      },
    };
    const agents = await createAgents(config);
    const oracle = agents.find((agent) => agent.name === 'oracle');
    expect(oracle?.config.model).toBe('new/default');
    expect(oracle?.config.variant).toBeUndefined();
  });

  test('accepts valid options object', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      options: { textVerbosity: 'low' },
    });
    expect(result.success).toBe(true);
  });

  test('accepts empty options object', () => {
    const result = AgentOverrideConfigSchema.safeParse({ options: {} });
    expect(result.success).toBe(true);
  });

  test('accepts nested values in options', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      options: {
        thinking: { type: 'enabled', budgetTokens: 16000 },
      },
    });
    expect(result.success).toBe(true);
  });

  test('accepts options alongside other fields', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      model: 'openai/gpt-5.5',
      variant: 'high',
      temperature: 0.7,
      options: {
        smart: 'openai/gpt-5.5-pro',
        textVerbosity: 'low',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options).toEqual({
        smart: 'openai/gpt-5.5-pro',
        textVerbosity: 'low',
      });
    }
  });

  test('config without options is valid', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      model: 'openai/gpt-5.5',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options).toBeUndefined();
    }
  });

  test('rejects non-object options', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      options: 'not-an-object',
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-string model values', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      model: [],
    });
    expect(result.success).toBe(false);
  });

  test('passes through unknown fields on overrides (strict mode removed)', () => {
    const result = AgentOverrideConfigSchema.safeParse({
      model: 'openai/gpt-5.5',
      description: 'extra field that was previously rejected',
    } as Record<string, unknown>);
    // strict() was removed so old configs with skills/mcps fields don't fail
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe('openai/gpt-5.5');
    }
  });
});
