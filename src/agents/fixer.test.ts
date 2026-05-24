import { describe, expect, test } from 'bun:test';
import { createFixerAgent } from './fixer';

describe('createFixerAgent', () => {
  test('creates agent with correct name', () => {
    const agent = createFixerAgent('test/fixer-model');
    expect(agent.name).toBe('fixer');
  });

  test('sets the provided model', () => {
    const agent = createFixerAgent('test/fixer-model');
    expect(agent.config.model).toBe('test/fixer-model');
  });

  test('prompt contains expected sections', () => {
    const agent = createFixerAgent('test/fixer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('<workflow>');
    expect(prompt).toContain('<file_read_budget>');
    expect(prompt).toContain('<constraints>');
    expect(prompt).toContain('<user_choice_policy>');
    expect(prompt).toContain('<self_review>');
    expect(prompt).toContain('<build_recovery>');
    expect(prompt).toContain('<verification_hints>');
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('<variant_policy>');
  });

  test('custom prompt overrides the base prompt', () => {
    const agent = createFixerAgent('test/fixer-model', 'Custom fixer prompt');
    expect(agent.config.prompt).toBe('Custom fixer prompt');
  });

  test('custom append prompt is appended to base', () => {
    const agent = createFixerAgent(
      'test/fixer-model',
      undefined,
      'Extra instructions',
    );
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('Extra instructions');
    expect(prompt).toContain('<role>');
  });

  test('has description', () => {
    const agent = createFixerAgent('test/fixer-model');
    expect(agent.description).toBeTruthy();
    expect(agent.description?.length).toBeGreaterThan(10);
  });

  test('prompt contains all required sections (complete check)', () => {
    const agent = createFixerAgent('test/fixer-model');
    const prompt = agent.config.prompt ?? '';
    const requiredSections = [
      '<role>',
      '<workflow>',
      '<file_read_budget>',
      '<constraints>',
      '<user_choice_policy>',
      '<self_review>',
      '<variant_policy>',
      '<build_recovery>',
      '<verification_hints>',
      '<output_format>',
    ];
    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createFixerAgent('test/fixer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });
});
