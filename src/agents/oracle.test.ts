import { describe, expect, test } from 'bun:test';
import { createOracleAgent } from './oracle';

describe('createOracleAgent', () => {
  test('creates agent with correct name', () => {
    const agent = createOracleAgent('test/oracle-model');
    expect(agent.name).toBe('oracle');
  });

  test('sets the provided model', () => {
    const agent = createOracleAgent('test/oracle-model');
    expect(agent.config.model).toBe('test/oracle-model');
  });

  test('prompt contains expected sections', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('<capabilities>');
    expect(prompt).toContain('<tool_routing>');
    expect(prompt).toContain('<constraints>');
    expect(prompt).toContain('<user_choice_policy>');
    expect(prompt).toContain('<variant_policy>');
    expect(prompt).toContain('<output_format>');
  });

  test('has temperature 0.15', () => {
    const agent = createOracleAgent('test/oracle-model');
    expect(agent.config.temperature).toBe(0.15);
  });

  test('custom prompt overrides the base prompt', () => {
    const agent = createOracleAgent(
      'test/oracle-model',
      'Custom oracle prompt',
    );
    expect(agent.config.prompt).toBe('Custom oracle prompt');
  });

  test('custom append prompt is appended to base', () => {
    const agent = createOracleAgent(
      'test/oracle-model',
      undefined,
      'Extra instructions',
    );
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('Extra instructions');
    expect(prompt).toContain('<role>');
  });

  test('has description', () => {
    const agent = createOracleAgent('test/oracle-model');
    expect(agent.description).toBeTruthy();
    expect(agent.description?.length).toBeGreaterThan(10);
  });

  test('prompt contains all required sections (complete check)', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    const requiredSections = [
      '<role>',
      '<capabilities>',
      '<tool_routing>',
      '<constraints>',
      '<user_choice_policy>',
      '<variant_policy>',
      '<output_format>',
      '<diagnosis>',
      '<recommendation>',
      '<tradeoffs>',
      '<risks>',
      '<confidence>',
      '<action_items>',
      '<blocked>',
      '<good_example>',
      '<bad_example>',
    ];
    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });
});
