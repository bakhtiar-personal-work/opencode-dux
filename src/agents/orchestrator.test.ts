import { describe, expect, test } from 'bun:test';
import { buildOrchestratorPrompt, resolvePrompt } from './orchestrator';

describe('resolvePrompt', () => {
  test('returns base when neither custom nor append provided', () => {
    const result = resolvePrompt('BASE PROMPT');
    expect(result).toBe('BASE PROMPT');
  });

  test('custom prompt replaces base entirely', () => {
    const result = resolvePrompt('BASE', 'CUSTOM');
    expect(result).toBe('CUSTOM');
  });

  test('append prompt is appended to base', () => {
    const result = resolvePrompt('BASE', undefined, 'APPEND');
    expect(result).toBe('BASE\n\nAPPEND');
  });

  test('custom prompt wins over append (both provided)', () => {
    const result = resolvePrompt('BASE', 'CUSTOM', 'APPEND');
    expect(result).toBe('CUSTOM');
  });

  test('empty string custom prompt replaces base with empty', () => {
    const result = resolvePrompt('BASE', '');
    expect(result).toBe('');
  });

  test('empty string append adds extra newline', () => {
    const result = resolvePrompt('BASE', undefined, '');
    expect(result).toBe('BASE\n\n');
  });

  test('base is undefined', () => {
    const result = resolvePrompt(undefined as unknown as string, 'CUSTOM');
    expect(result).toBe('CUSTOM');
  });
});

describe('buildOrchestratorPrompt', () => {
  test('includes all agent descriptions when no agents disabled', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('@explorer');
    expect(prompt).toContain('@librarian');
    expect(prompt).toContain('@oracle');
    expect(prompt).toContain('@designer');
    expect(prompt).toContain('@fixer');
    expect(prompt).toContain('@steward');
    expect(prompt).toContain('@interpreter');
  });

  test('includes routing priority, question tool, oracle matrix, steward/interpreter', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('<routing_priority>');
    expect(prompt).toContain('<first_gate>');
    expect(prompt).toContain('delegate_subagent(agent: "steward"');
    expect(prompt).toContain('delegate_subagent(agent: "designer"');
    expect(prompt).toContain('<orchestrator_clarification>');
    expect(prompt).toContain('<needs_user>');
    expect(prompt).toContain('`question`');
    expect(prompt).toContain('continue_session_id');
    expect(prompt).toContain('Nine invariants');
    expect(prompt).toContain('NEVER use default (flash) + low');
    expect(prompt).toContain('<steward_protocol>');
    expect(prompt).toContain('<interpreter_protocol>');
  });

  test('includes critical_invariants and procedural_invariants blocks', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('<critical_invariants>');
    expect(prompt).toContain('<procedural_invariants>');
    expect(prompt).toContain('NEVER edit, write, read');
    expect(prompt).toContain('Report verification before declaring success');
  });

  test('includes planning_gate block', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('<planning_gate>');
    expect(prompt).toContain('1) ANALYSIS');
    expect(prompt).toContain('4) IMPLEMENT');
    expect(prompt).toContain('Skip this gate ONLY when');
  });

  test('context_budget is near the start of the prompt (after <role>)', () => {
    const prompt = buildOrchestratorPrompt();
    const roleIndex = prompt.indexOf('<role>');
    const contextBudgetIndex = prompt.indexOf('<context_budget>');
    const criticalInvariantsIndex = prompt.indexOf('<critical_invariants>');
    expect(contextBudgetIndex).toBeGreaterThan(roleIndex);
    expect(contextBudgetIndex).toBeLessThan(criticalInvariantsIndex);
  });

  test('first_gate analysis gate references oracle when oracle enabled', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('Analysis: blocking @oracle');
    expect(prompt).not.toContain('Analysis gate (@oracle / thinker)');
  });

  test('injects oracle model names when provided', () => {
    const prompt = buildOrchestratorPrompt(
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
    );
    expect(prompt).toContain('openai/gpt-5.5-pro');
    expect(prompt).toContain('openai/gpt-5.5');
    expect(prompt).not.toContain('{{ORACLE_DEFAULT_MODEL}}');
    expect(prompt).not.toContain('{{ORACLE_SMART_MODEL_OR_FALLBACK}}');
  });

  test('empty model names do not break prompt', () => {
    const prompt = buildOrchestratorPrompt('', '');
    // Should still produce valid prompt without template placeholders
    expect(prompt).not.toContain('{{');
  });

  test('includes only enabled agent descriptions when set provided', () => {
    const prompt = buildOrchestratorPrompt(
      undefined,
      undefined,
      new Set(['oracle', 'fixer']),
    );
    // Included descriptions
    expect(prompt).toContain(
      'technical analysis and code review; uses orchestrator',
    );
    expect(prompt).toContain('implementation specialist');
    // Excluded descriptions - these unique strings only appear in their descriptions
    expect(prompt).not.toContain('codebase search specialist');
    expect(prompt).not.toContain('external docs and API reference specialist');
    expect(prompt).not.toContain('UI/UX specialist for ALL user-facing UI');
    expect(prompt).not.toContain('rules citation from steward_paths');
    expect(prompt).not.toContain('screenshot / attached-image analyst');
  });

  test('includes all agent descriptions when no set provided (backward compat)', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('codebase search specialist');
    expect(prompt).toContain('external docs and API reference specialist');
    expect(prompt).toContain(
      'technical analysis and code review; uses orchestrator',
    );
    expect(prompt).toContain('UI/UX specialist for ALL user-facing UI');
    expect(prompt).toContain('implementation specialist');
    expect(prompt).toContain('rules citation from steward_paths');
    expect(prompt).toContain('screenshot / attached-image analyst');
  });
});
