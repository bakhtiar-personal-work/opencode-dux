import { describe, expect, test } from 'bun:test';
import { createDesignerAgent } from './designer';

describe('createDesignerAgent', () => {
  test('creates agent with correct name', () => {
    const agent = createDesignerAgent('test/designer-model');
    expect(agent.name).toBe('designer');
  });

  test('sets the provided model', () => {
    const agent = createDesignerAgent('test/designer-model');
    expect(agent.config.model).toBe('test/designer-model');
  });

  test('prompt contains expected sections', () => {
    const agent = createDesignerAgent('test/designer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('<discovery_first>');
    expect(prompt).toContain('<design_principles>');
    expect(prompt).toContain('<vision_and_evidence>');
    expect(prompt).toContain('<user_choice_policy>');
    expect(prompt).toContain('<constraints>');
    expect(prompt).toContain('<variant_policy>');
    expect(prompt).toContain('<output_format>');
  });

  test('has temperature 0.3', () => {
    const agent = createDesignerAgent('test/designer-model');
    expect(agent.config.temperature).toBe(0.3);
  });

  test('custom prompt overrides the base prompt', () => {
    const agent = createDesignerAgent(
      'test/designer-model',
      'Custom designer prompt',
    );
    expect(agent.config.prompt).toBe('Custom designer prompt');
  });

  test('custom append prompt is appended to base', () => {
    const agent = createDesignerAgent(
      'test/designer-model',
      undefined,
      'Extra instructions',
    );
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('Extra instructions');
    expect(prompt).toContain('<role>');
  });

  test('has description', () => {
    const agent = createDesignerAgent('test/designer-model');
    expect(agent.description).toBeTruthy();
    expect(agent.description?.length).toBeGreaterThan(10);
  });

  test('prompt contains all required sections (complete check)', () => {
    const agent = createDesignerAgent('test/designer-model');
    const prompt = agent.config.prompt ?? '';
    const requiredSections = [
      '<role>',
      '<discovery_first>',
      '<design_principles>',
      '<vision_and_evidence>',
      '<user_choice_policy>',
      '<constraints>',
      '<variant_policy>',
      '<output_format>',
      '<design_plan>',
      '<accessibility_check>',
      '<implementation_notes>',
      '<blocked>',
    ];
    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createDesignerAgent('test/designer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });
});
