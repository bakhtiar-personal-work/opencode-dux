import { describe, expect, test } from 'bun:test';
import { createExplorerAgent } from './explorer';

describe('createExplorerAgent', () => {
  test('creates agent with correct name', () => {
    const agent = createExplorerAgent('test/explorer-model');
    expect(agent.name).toBe('explorer');
  });

  test('sets the provided model', () => {
    const agent = createExplorerAgent('test/explorer-model');
    expect(agent.config.model).toBe('test/explorer-model');
  });

  test('prompt contains expected sections', () => {
    const agent = createExplorerAgent('test/explorer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('# Role');
    expect(prompt).toContain('## Tool Routing');
    expect(prompt).toContain('# Workflow');
    expect(prompt).toContain('# Rules');
    expect(prompt).toContain('## Variant Policy');
    expect(prompt).toContain('## Stale Codemap');
    expect(prompt).toContain('# Output Format');
  });

  test('custom prompt overrides the base prompt', () => {
    const agent = createExplorerAgent(
      'test/explorer-model',
      'Custom explorer prompt',
    );
    expect(agent.config.prompt).toBe('Custom explorer prompt');
  });

  test('custom append prompt is appended to base', () => {
    const agent = createExplorerAgent(
      'test/explorer-model',
      undefined,
      'Extra instructions',
    );
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('Extra instructions');
    expect(prompt).toContain('# Role');
  });

  test('has description', () => {
    const agent = createExplorerAgent('test/explorer-model');
    expect(agent.description).toBeTruthy();
    expect(agent.description?.length).toBeGreaterThan(10);
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createExplorerAgent('test/explorer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });
});
