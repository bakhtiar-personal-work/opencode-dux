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
    expect(prompt).toContain('# Role');
    expect(prompt).toContain('# Discovery');
    expect(prompt).toContain('# Design Principles');
    expect(prompt).toContain('# Rules');
    expect(prompt).toContain('## Variant Policy');
    expect(prompt).toContain('# Output Format');
  });

  test('prompt includes execution todo handoff for fixer', () => {
    const agent = createDesignerAgent('test/designer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('## Execution Todo Contract');
    expect(prompt).toContain('<execution_todo>');
    expect(prompt).toContain('atomic and fixer-ready');
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
    expect(prompt).toContain('# Role');
  });

  test('has description', () => {
    const agent = createDesignerAgent('test/designer-model');
    expect(agent.description).toBeTruthy();
    expect(agent.description?.length).toBeGreaterThan(10);
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createDesignerAgent('test/designer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });
});
