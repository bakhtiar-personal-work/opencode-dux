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
    expect(prompt).toContain('<role>');
    expect(prompt).toContain('<capabilities>');
    expect(prompt).toContain('<handoff_artifacts>');
    expect(prompt).toContain('<tool_routing>');
    expect(prompt).toContain('<constraints>');
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
      '<critical_invariants>',
      '<capabilities>',
      '<tool_routing>',
      '<workflow>',
      '<constraints>',
      '<user_choice_policy>',
      '<variant_policy>',
      '<self_review>',
      '<output_format>',
      '<diagnosis>',
      '<recommendation>',
      '<confidence>',
      '<action_items>',
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
    // Oracle prompt should be well under 10k chars after compaction
    expect(prompt.length).toBeLessThan(10000);
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
      '<role>',
      '<capabilities>',
      '<tool_routing>',
      '<model_tier>',
      '<constraints>',
      '<variant_policy>',
      '<output_format>',
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
      '<role>',
      '<capabilities>',
      '<tool_routing>',
      '<constraints>',
      '<variant_policy>',
      '<output_format>',
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

    expect(promptTrue.startsWith('<role>')).toBe(true);
    expect(promptFalse.startsWith('<role>')).toBe(true);
    expect(promptTrue.endsWith('</model_tier>')).toBe(true);
  });
});
