import { describe, expect, test } from 'bun:test';
import type { PluginConfig } from '../config';
import { createDelegateTools, resolveDelegatedAgentConfig } from './delegate';

describe('resolveDelegatedAgentConfig', () => {
  test('uses explicit requested model over config', () => {
    const config: PluginConfig = {
      agents: {
        explorer: { model: 'config/explorer-model', variants: ['high'] },
      },
    };

    const resolved = resolveDelegatedAgentConfig(config, 'explorer', {
      model: 'requested/explorer-model',
      variant: 'low',
    });

    expect(resolved.model).toBe('requested/explorer-model');
    expect(resolved.variant).toBe('low');
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

  test('falls back to built-in default model when config has no agent override', () => {
    const resolved = resolveDelegatedAgentConfig(undefined, 'explorer', {
      variant: 'medium',
    });

    expect(resolved.model).toBe('neuralwatt/qwen3.5-397b-fast');
    expect(resolved.variant).toBe('medium');
  });

  test('uses configured tier variants in declared order', () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          default: {
            model: 'test/glm',
            thinking: true,
            variants: ['high', 'max'],
          },
        },
      },
    };
    expect(
      resolveDelegatedAgentConfig(config, 'oracle', { variant: 'max' }),
    ).toMatchObject({
      model: 'test/glm',
      variant: 'max',
      allowedVariants: ['high', 'max'],
    });
  });

  test('selects default tier variant when smart tier shares model id', () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          default: { model: 'test/glm', variants: ['high', 'max'] },
          smart: { model: 'test/glm', variants: ['max'] },
        },
      },
    };

    expect(
      resolveDelegatedAgentConfig(config, 'oracle', { variant: 'high' }),
    ).toMatchObject({ variant: 'high', allowedVariants: ['high', 'max'] });
  });

  test('omits variant when thinking is disabled', () => {
    const config: PluginConfig = {
      agents: {
        explorer: {
          default: { model: 'test/plain', thinking: false },
        },
      },
    };

    expect(
      resolveDelegatedAgentConfig(config, 'explorer', { variant: 'turbo' }),
    ).toMatchObject({ model: 'test/plain', variant: undefined });
  });

  test('reports requested variant outside configured capability', () => {
    const config: PluginConfig = {
      agents: {
        oracle: {
          default: { model: 'test/glm', variants: ['high', 'max'] },
        },
      },
    };

    expect(
      resolveDelegatedAgentConfig(config, 'oracle', { variant: 'medium' }),
    ).toMatchObject({
      variant: undefined,
      variantError:
        'Variant "medium" is not allowed for oracle model "test/glm". Allowed: high, max',
    });
  });
});

describe('createDelegateTools agent normalization', () => {
  function createClient() {
    const promptCounts = new Map<string, number>();
    return {
      session: {
        create: async () => ({ data: { id: 'child-1' } }),
        prompt: async ({
          path,
          body,
        }: {
          path: { id: string };
          body: { agent: string };
        }) => {
          const previous = promptCounts.get(path.id) ?? 0;
          promptCounts.set(path.id, previous + 1);
          return body.agent;
        },
        messages: async ({ path }: { path: { id: string } }) => ({
          data:
            (promptCounts.get(path.id) ?? 0) > 0
              ? [
                  {
                    info: { role: 'assistant' },
                    parts: [{ type: 'text', text: '<summary>done</summary>' }],
                  },
                ]
              : [],
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

  test('allows new fixer delegations without implementation authorization hard-stop', async () => {
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

    expect(result).toContain('**fixer**');
  });

  test('still allows fixer prompts that include implementation authorization markup', async () => {
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
