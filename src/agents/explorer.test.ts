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
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('<tool_routing>');
    expect(prompt).toContain('<workflow>');
    expect(prompt).toContain('<constraints>');
    expect(prompt).toContain('<user_choice_policy>');
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('<variant_policy>');
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
    expect(prompt).toContain('<role>');
  });

  test('has description', () => {
    const agent = createExplorerAgent('test/explorer-model');
    expect(agent.description).toBeTruthy();
    expect(agent.description?.length).toBeGreaterThan(10);
  });

  test('prompt contains all required sections (complete check)', () => {
    const agent = createExplorerAgent('test/explorer-model');
    const prompt = agent.config.prompt ?? '';
    const requiredSections = [
      '<role>',
      '<tool_routing>',
      '<workflow>',
      '<big_repo_strategy>',
      '<constraints>',
      '<user_choice_policy>',
      '<variant_policy>',
      '<stale_codemap>',
      '<output_format>',
      '<results>',
      '<no_results>',
    ];
    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createExplorerAgent('test/explorer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });
});
