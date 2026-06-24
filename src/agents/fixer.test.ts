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
    expect(prompt).toContain('# Role');
    expect(prompt).toContain('# Workflow');
    expect(prompt).toContain('# Rules');
    expect(prompt).toContain('## Variant Policy');
    expect(prompt).toContain('# Output Format');
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
    expect(prompt).toContain('# Role');
  });

  test('has description', () => {
    const agent = createFixerAgent('test/fixer-model');
    expect(agent.description).toBeTruthy();
    expect(agent.description?.length).toBeGreaterThan(10);
  });

  test('prompt treats specialist execution todo as authoritative', () => {
    const agent = createFixerAgent('test/fixer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain(
      'Treat specialist-provided <execution_todo> as the authoritative implementation spec when present.',
    );
    expect(prompt).toContain('If a task includes `code`');
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createFixerAgent('test/fixer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });

  test('prompt keeps diagnosis work out of fixer', () => {
    const agent = createFixerAgent('test/fixer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain(
      'Never act as the primary diagnosis or strategy agent',
    );
    expect(prompt).toContain('route through @oracle');
  });

  test('verification output is constrained to a JSON object', () => {
    const agent = createFixerAgent('test/fixer-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('<verification>');
    expect(prompt).toContain('Output ONE raw JSON object');
    expect(prompt).toContain('"tests":"passed|failed|skipped"');
    expect(prompt).toContain('"validation":"passed|failed|skipped"');
  });
});
