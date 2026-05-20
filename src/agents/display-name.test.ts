import { describe, expect, test } from 'bun:test';
import type { PluginConfig } from '../config';
import { createAgents, getAgentConfigs } from './index';

describe('displayName', () => {
  test('stores displayName on agent when configured', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { displayName: 'researcher' },
      },
    };

    const agents = await createAgents(config);
    const explorer = agents.find((a) => a.name === 'explorer');
    expect(explorer?.displayName).toBe('researcher');

    const sdkConfigs = await getAgentConfigs(config);
    expect((sdkConfigs.explorer as { displayName?: string }).displayName).toBe(
      'researcher',
    );
  });

  test('injects configured displayName into orchestrator prompt mentions', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { displayName: 'researcher' },
      },
    };

    const agents = await createAgents(config);
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    const prompt = orchestrator?.config.prompt ?? '';

    expect(prompt).toContain('@researcher');
    expect(prompt).not.toMatch(/@explorer\b/);
  });

  test('normalizes @-prefixed displayName in prompt injection', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { displayName: '@researcher' },
      },
    };

    const agents = await createAgents(config);
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    const prompt = orchestrator?.config.prompt ?? '';

    expect(prompt).toContain('@researcher');
    expect(prompt).not.toContain('@@researcher');
    expect(prompt).not.toMatch(/@explorer\b/);
  });

  test('normalizes whitespace-padded displayName in prompt injection', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { displayName: '  researcher  ' },
      },
    };

    const agents = await createAgents(config);
    const orchestrator = agents.find((a) => a.name === 'orchestrator');
    const prompt = orchestrator?.config.prompt ?? '';

    expect(prompt).toContain('@researcher');
    expect(prompt).not.toContain('@ researcher ');
    expect(prompt).not.toMatch(/@explorer\b/);
  });

  test('throws when duplicate displayName is assigned', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { displayName: 'helper' },
        librarian: { displayName: 'helper' },
      },
    };

    await expect(createAgents(config)).rejects.toThrow(
      "Duplicate displayName 'helper' assigned to multiple agents",
    );
  });

  test('throws when normalized duplicate displayName is assigned', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { displayName: 'advisor' },
        librarian: { displayName: ' @advisor ' },
      },
    };

    await expect(createAgents(config)).rejects.toThrow(
      "Duplicate displayName 'advisor' assigned to multiple agents",
    );
  });

  test('throws when displayName conflicts with internal agent name', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { displayName: 'oracle' },
      },
    };

    await expect(createAgents(config)).rejects.toThrow(
      "displayName 'oracle' conflicts with an agent name",
    );
  });

  test('throws when normalized displayName conflicts with internal agent name', async () => {
    const config: PluginConfig = {
      agents: {
        explorer: { displayName: ' @oracle ' },
      },
    };

    await expect(createAgents(config)).rejects.toThrow(
      "displayName 'oracle' conflicts with an agent name",
    );
  });

  test('throws when orchestrator displayName conflicts with internal agent name', async () => {
    const config: PluginConfig = {
      agents: {
        orchestrator: { displayName: 'oracle' },
      },
    };

    await expect(createAgents(config)).rejects.toThrow(
      /displayName.*conflicts with an agent name/,
    );
  });

  test('resolves legacy alias for explorer displayName override', async () => {
    const config: PluginConfig = {
      agents: {
        explore: { displayName: 'researcher' },
      },
    };

    const agents = await createAgents(config);
    const explorer = agents.find((a) => a.name === 'explorer');

    expect(explorer?.displayName).toBe('researcher');
  });

  test('uses displayName as host-facing registry key with hidden internal alias', async () => {
    const config: PluginConfig = {
      agents: {
        oracle: { displayName: 'advisor' },
      },
    };

    const sdkConfigs = (await getAgentConfigs(config)) as Record<
      string,
      { hidden?: boolean; mode?: string }
    >;

    expect(sdkConfigs.advisor).toBeDefined();
    expect(sdkConfigs.advisor.mode).toBe('subagent');
    expect(sdkConfigs.advisor.hidden).toBeUndefined();

    expect(sdkConfigs.oracle).toBeDefined();
    expect(sdkConfigs.oracle.mode).toBe('subagent');
    expect(sdkConfigs.oracle.hidden).toBe(true);
  });

  test('uses orchestrator displayName as host-facing key with hidden internal alias', async () => {
    const config: PluginConfig = {
      agents: {
        orchestrator: { displayName: 'engineer' },
      },
    };

    const sdkConfigs = (await getAgentConfigs(config)) as Record<
      string,
      { hidden?: boolean; mode?: string }
    >;

    expect(sdkConfigs.engineer).toBeDefined();
    expect(sdkConfigs.engineer.mode).toBe('primary');
    expect(sdkConfigs.engineer.hidden).toBeUndefined();

    expect(sdkConfigs.orchestrator).toBeDefined();
    expect(sdkConfigs.orchestrator.mode).toBe('primary');
    expect(sdkConfigs.orchestrator.hidden).toBe(true);
  });
});
