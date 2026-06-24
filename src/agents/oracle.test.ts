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
    expect(prompt).toContain('concise markdown list inside XML tags, not JSON');
    expect(prompt).toContain('Code: optional exact snippet or diff hunk');
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
    expect(prompt).toContain('<risks>: include when concrete');
    expect(prompt).toContain(
      '<plan>: include ONLY when orchestrator delegates',
    );
    expect(prompt).toContain(
      '<execution_todo>: REQUIRED whenever your recommendation is meant to be implemented by @fixer',
    );
    expect(prompt).toContain(
      'Output concise markdown list matching execution todo contract',
    );
    expect(prompt).toContain(
      '<blocked>: include ONLY when analysis cannot be completed',
    );
  });

  test('variant policy stays model agnostic', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('Do not infer model tier from variant name');
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

  test('prompt explicitly forbids file mutation', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('STRICTLY PROHIBITED');
    expect(prompt).toContain('creating, editing, deleting, or patching');
    expect(prompt).toContain('NO write access');
    expect(prompt).toContain(
      'Never use edit, write, task, or any mutation tool',
    );
  });

  test('prompt routes all implementation through @fixer', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain(
      'all implementation goes through @fixer via <execution_todo>',
    );
    expect(prompt).toContain('NOT AVAILABLE');
    expect(prompt).toContain('edit, write, task, patch, or apply_patch');
  });

  test('prompt tells oracle to keep execution todo terse and include code when possible', () => {
    const agent = createOracleAgent('test/oracle-model');
    const prompt = agent.config.prompt ?? '';
    expect(prompt).toContain('include exact proposed code');
    expect(prompt).toContain('under `Code:` lines in <execution_todo>');
    expect(prompt).toContain('exact replacement/addition code safely');
    expect(prompt).toContain('For long tasks, keep list terse');
  });

  test('config denies edit, write, and task permissions', () => {
    const agent = createOracleAgent('test/oracle-model');
    const perm = agent.config.permission as Record<string, string>;
    expect(perm.edit).toBe('deny');
    expect(perm.write).toBe('deny');
    expect(perm.task).toBe('deny');
  });
});

describe('buildOraclePrompt', () => {
  test('does not make agent infer model tier from variant', () => {
    const prompt = buildOraclePrompt();
    expect(prompt).not.toContain('<model_tier>');
    expect(prompt).toContain('Do not infer model tier from variant name');
  });

  test('omits model_tier block when hasSmartModel is false', () => {
    const prompt = buildOraclePrompt();
    expect(prompt).not.toContain('<model_tier>');
    expect(prompt).not.toContain('default (flash)');
    expect(prompt).not.toContain('smart (pro)');
  });

  test('true output contains all essential sections', () => {
    const prompt = buildOraclePrompt();
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
    const prompt = buildOraclePrompt();
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
});
