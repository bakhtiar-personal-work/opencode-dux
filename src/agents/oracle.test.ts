import { describe, expect, test } from 'bun:test';
import { buildOraclePrompt, createOracleAgent } from './oracle';

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
    expect(prompt).toContain('# Role');
    expect(prompt).toContain('## Handoff Artifacts');
    expect(prompt).toContain('## Tool Routing');
    expect(prompt).toContain('# Rules');
    expect(prompt).toContain('## Variant Policy');
    expect(prompt).toContain('# Output Format');
  });

  test('prompt includes specialist execution handoff contract', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('## Execution Todo Contract');
    expect(prompt).toContain('<execution_todo>');
    expect(prompt).toContain('canonical implementation spec');
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
    expect(prompt).toContain('# Role');
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
      '# Role',
      '# Rules',
      '## Tool Routing',
      '# Workflow',
      '# Variant Policy',
      '# Output Format',
      '<diagnosis>',
      '<recommendation>',
      '<confidence>',
      '<action_items>',
      '<execution_todo>',
      '<blocked>',
      '<needs_user>',
    ];
    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
  });

  test('prompt enforces strict required vs conditional output sections', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('Required sections');
    expect(prompt).toContain('Conditional sections');
    expect(prompt).toContain('<risks>: REQUIRED for variant high/max');
    expect(prompt).toContain(
      '<plan>: include ONLY when orchestrator delegates',
    );
    expect(prompt).toContain(
      '<execution_todo>: REQUIRED whenever your recommendation is meant to be implemented by @fixer',
    );
    expect(prompt).toContain(
      '<blocked>: include ONLY when analysis cannot be completed',
    );
  });

  test('variant_policy requires risks for high/max', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('REQUIRED with severity labels');
  });

  test('prompt does not contain resolver boilerplate', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).not.toContain('if (customPrompt)');
    expect(prompt).not.toContain('else if (customAppendPrompt)');
  });

  test('prompt is materially shorter than the old verbose version', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt.length).toBeLessThan(11000);
  });
});

describe('buildOraclePrompt', () => {
  test('includes model_tier block when hasSmartModel is true', () => {
    const prompt = buildOraclePrompt(true);
    expect(prompt).toContain('<model_tier>');
    expect(prompt).toContain('default (flash)');
    expect(prompt).toContain('smart (pro)');
  });

  test('omits model_tier block when hasSmartModel is false', () => {
    const prompt = buildOraclePrompt(false);
    expect(prompt).not.toContain('<model_tier>');
    expect(prompt).not.toContain('default (flash)');
    expect(prompt).not.toContain('smart (pro)');
  });

  test('true output contains all essential sections', () => {
    const prompt = buildOraclePrompt(true);
    const requiredSections = [
      '# Role',
      '## Tool Routing',
      '# Rules',
      '# Variant Policy',
      '# Output Format',
      '<diagnosis>',
      '<recommendation>',
      '<confidence>',
      '<action_items>',
      '<blocked>',
    ];
    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
  });

  test('false output contains all sections except model_tier', () => {
    const prompt = buildOraclePrompt(false);
    const requiredSections = [
      '# Role',
      '## Tool Routing',
      '# Rules',
      '# Variant Policy',
      '# Output Format',
      '<diagnosis>',
      '<recommendation>',
      '<confidence>',
      '<action_items>',
      '<blocked>',
    ];
    for (const section of requiredSections) {
      expect(prompt).toContain(section);
    }
    expect(prompt).not.toContain('<model_tier>');
  });

  test('true and false outputs are structurally identical except for model_tier block', () => {
    const promptTrue = buildOraclePrompt(true);
    const promptFalse = buildOraclePrompt(false);

    expect(promptTrue.startsWith('# Role')).toBe(true);
    expect(promptFalse.startsWith('# Role')).toBe(true);
    expect(promptTrue.endsWith('</model_tier>')).toBe(true);
  });
});
