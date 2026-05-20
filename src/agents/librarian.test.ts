import { describe, expect, test } from 'bun:test';
import { createLibrarianAgent } from './librarian';

describe('createLibrarianAgent', () => {
  test('creates agent with correct name', () => {
    const agent = createLibrarianAgent('test/librarian-model');
    expect(agent.name).toBe('librarian');
  });

  test('sets the provided model', () => {
    const agent = createLibrarianAgent('test/librarian-model');
    expect(agent.config.model).toBe('test/librarian-model');
  });

  test('prompt contains expected sections', () => {
    const agent = createLibrarianAgent('test/librarian-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('<tool_and_mcp_routing>');
    expect(prompt).toContain('<workflow>');
    expect(prompt).toContain('<conflict_resolution>');
    expect(prompt).toContain('Competing libraries');
    expect(prompt).toContain('<variant_policy>');
    expect(prompt).toContain('<constraints>');
    expect(prompt).toContain('<output_format>');
  });

  test('custom prompt overrides the base prompt', () => {
    const agent = createLibrarianAgent(
      'test/librarian-model',
      'Custom librarian prompt',
    );
    expect(agent.config.prompt).toBe('Custom librarian prompt');
  });

  test('custom append prompt is appended to base', () => {
    const agent = createLibrarianAgent(
      'test/librarian-model',
      undefined,
      'Extra instructions',
    );
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('Extra instructions');
    expect(prompt).toContain('<role>');
  });

  test('has description', () => {
    const agent = createLibrarianAgent('test/librarian-model');
    expect(agent.description).toBeTruthy();
    expect(agent.description?.length).toBeGreaterThan(10);
  });

  test('prompt contains all required sections (complete check)', () => {
    const agent = createLibrarianAgent('test/librarian-model');
    const prompt = agent.config.prompt ?? '';
    const requiredSections = [
      '<role>',
      '<tool_and_mcp_routing>',
      '<workflow>',
      '<conflict_resolution>',
      '<variant_policy>',
      '<constraints>',
      '<output_format>',
      '<answer>',
      '<sources>',
      '<notes>',
      '<blocked>',
    ];
    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createLibrarianAgent('test/librarian-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });
});
