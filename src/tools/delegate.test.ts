import { describe, expect, test } from 'bun:test';
import type { PluginConfig } from '../config';
import { createDelegateTools, resolveDelegatedAgentConfig } from './delegate';

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

describe('createDelegateTools agent normalization', () => {
  function createClient() {
    return {
      session: {
        create: async () => ({ data: { id: 'child-1' } }),
        prompt: async ({ body }: { body: { agent: string } }) => {
          return body.agent;
        },
        messages: async () => ({
          data: [
            {
              info: { role: 'assistant' },
              parts: [{ type: 'text', text: '<summary>done</summary>' }],
            },
          ],
        }),
        abort: async () => undefined,
      },
    };
  }

  function createArtifactStore() {
    return {
      formatForDelegation: () => '',
      seedArtifact: () => ({
        artifactPath: '.opencode-dux/designer/file.md',
        indexPath: '.opencode-dux/orchestrator/index.md',
      }),
      appendTurn: () => ({
        artifactPath: '.opencode-dux/designer/file.md',
        indexPath: '.opencode-dux/orchestrator/index.md',
      }),
      markStatus: () => undefined,
      getSessionInfo: () => undefined,
    };
  }

  test('normalizes @-prefixed agent names before delegation', async () => {
    const tools = createDelegateTools(
      {
        client: createClient() as never,
        directory: '/tmp/test',
      },
      {
        agents: {
          designer: { model: 'test/designer' },
        },
      },
      undefined,
      createArtifactStore() as never,
    );

    const result = await (
      tools.delegate_subagent as {
        execute: (
          args: Record<string, unknown>,
          context: { sessionID: string },
        ) => Promise<string>;
      }
    ).execute(
      {
        agent: '@designer',
        prompt: 'route ui work',
        variant: 'medium',
      },
      { sessionID: 'parent-1' },
    );

    expect(result).toContain('**designer**');
    expect(result).not.toContain('Unknown subagent');
  });

  test('resolves displayName aliases before delegation', async () => {
    const tools = createDelegateTools(
      {
        client: createClient() as never,
        directory: '/tmp/test',
      },
      {
        agents: {
          designer: { model: 'test/designer', displayName: 'build' },
        },
      },
      undefined,
      createArtifactStore() as never,
    );

    const result = await (
      tools.delegate_subagent as {
        execute: (
          args: Record<string, unknown>,
          context: { sessionID: string },
        ) => Promise<string>;
      }
    ).execute(
      {
        agent: '@build',
        prompt: 'route ui work',
        variant: 'medium',
      },
      { sessionID: 'parent-1' },
    );

    expect(result).toContain('**designer**');
    expect(result).not.toContain('Unknown subagent');
  });

  test('rejects new fixer delegations without implementation authorization', async () => {
    const tools = createDelegateTools(
      {
        client: createClient() as never,
        directory: '/tmp/test',
      },
      {
        agents: {
          fixer: { model: 'test/fixer' },
        },
      },
      undefined,
      createArtifactStore() as never,
    );

    const result = await (
      tools.delegate_subagent as {
        execute: (
          args: Record<string, unknown>,
          context: { sessionID: string },
        ) => Promise<string>;
      }
    ).execute(
      {
        agent: 'fixer',
        prompt: 'Apply the fix',
        variant: 'medium',
      },
      { sessionID: 'parent-1' },
    );

    expect(result).toContain(
      'New @fixer delegations require <implementation_authorization>',
    );
  });

  test('allows new fixer delegations with explicit implementation authorization', async () => {
    const tools = createDelegateTools(
      {
        client: createClient() as never,
        directory: '/tmp/test',
      },
      {
        agents: {
          fixer: { model: 'test/fixer' },
        },
      },
      undefined,
      createArtifactStore() as never,
    );

    const result = await (
      tools.delegate_subagent as {
        execute: (
          args: Record<string, unknown>,
          context: { sessionID: string },
        ) => Promise<string>;
      }
    ).execute(
      {
        agent: 'fixer',
        prompt:
          '<implementation_authorization>{"status":"approved","source":"latest_user_message","evidence":"User said go ahead."}</implementation_authorization>\n\nApply the fix',
        variant: 'medium',
      },
      { sessionID: 'parent-1' },
    );

    expect(result).toContain('**fixer**');
    expect(result).not.toContain('implementation_authorization');
  });
});
