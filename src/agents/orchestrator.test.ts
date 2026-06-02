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
    expect(prompt).toContain('<handoff_artifacts_routing>');
    expect(prompt).toContain('delegate_subagent');
    expect(prompt).toContain('<orchestrator_clarification>');
    expect(prompt).toContain('<needs_user>');
    expect(prompt).toContain('continue_session_id');
    expect(prompt).toContain('Nine invariants');
    expect(prompt).toContain('NEVER: default + low');
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

  test('includes planning_gate block with analysis-allowed fix', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('<planning_gate>');
    expect(prompt).toContain('1) ANALYSIS');
    expect(prompt).toContain('4) IMPLEMENT');
    expect(prompt).toContain('Skip this gate ONLY when');
    // Planning gate must allow analysis before approval
    expect(prompt).toContain('no approval needed for analysis');
    expect(prompt).toContain('no diagnosis needed');
  });

  test('context_budget is near the start of the prompt (after <role>)', () => {
    const prompt = buildOrchestratorPrompt();
    const roleIndex = prompt.indexOf('<role>');
    const contextBudgetIndex = prompt.indexOf('<context_budget>');
    const criticalInvariantsIndex = prompt.indexOf('<critical_invariants>');
    expect(contextBudgetIndex).toBeGreaterThan(roleIndex);
    expect(contextBudgetIndex).toBeLessThan(criticalInvariantsIndex);
  });

  test('first_gate analysis gate references oracle', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('ORACLE GATE');
    expect(prompt).toContain('Direct @fixer here is incorrect');
    expect(prompt).not.toContain('Analysis gate (@oracle / thinker)');
  });

  test('first_gate designer gate references designer with hard gate language', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('DESIGNER GATE');
    expect(prompt).toContain('@designer FIRST, blocking');
  });

  test('first_gate fixer exception references mechanical_edit_exception', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('FIXER EXCEPTION');
    expect(prompt).toContain('<mechanical_edit_exception>');
  });

  test('prompt contains routing enforcement block with citations requirement', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('<routing_enforcement>');
    expect(prompt).toContain('MUST be able to cite one of');
    expect(prompt).toContain('NEVER delegate @fixer for: debugging, architecture');
  });

  test('prompt contains good routing examples showing correct first specialist', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('"Fix why retry counter drifts" -> @oracle');
    expect(prompt).toContain('"Restyle settings modal" -> @designer');
    expect(prompt).toContain('"Rename getCwd to getCurrentWorkingDirectory in known file" -> @fixer');
  });

  test('prompt contains bad routing examples showing INCORRECT patterns', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('INCORRECT - DO NOT DO');
    expect(prompt).toContain('"Fix why retry counter drifts" -> @fixer');
    expect(prompt).toContain('"Design new plugin architecture" -> @fixer');
    expect(prompt).toContain('"Restyle settings modal" -> @fixer');
  });

  test('prompt does NOT contain stale <first_gate> item references', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).not.toContain('Run <first_gate> item 1');
    expect(prompt).not.toContain('<first_gate> 2');
  });

  test('prompt contains mechanical_edit_exception block with all criteria', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('<mechanical_edit_exception>');
    expect(prompt).toContain('Direct @fixer-first routing is allowed ONLY if ALL are true');
    expect(prompt).toContain('When unsure, treat as non-mechanical and route to @oracle');
  });

  test('execution step 2 references mechanical_edit_exception not user-provided bypass', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('and only if <mechanical_edit_exception> fully applies');
    expect(prompt).not.toContain('or user-provided exact implementation');
  });

  test('execution mechanical edits paragraph references mechanical_edit_exception', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('@fixer low only when <mechanical_edit_exception> fully applies');
    expect(prompt).toContain('User-provided exact implementation alone does NOT make a task mechanical');
  });

  test('constraints include strengthened routing prohibitions', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('NEVER route planning, architecture, debugging, or regressions directly to @fixer');
    expect(prompt).toContain('NEVER route UI work directly to @fixer');
    expect(prompt).toContain('If a task could be mechanical or diagnostic, treat it as diagnostic');
  });

  test('fix routing makes oracle the reasoning step before fixer', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'Fix request with any ambiguity, diagnosis, regression, or root-cause work: @oracle first',
    );
    expect(prompt).toContain(
      "@fixer receives oracle's plan/artifact and implements; it is not the primary reasoning agent.",
    );
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

  test('includes subagent model roster when provided', () => {
    const prompt = buildOrchestratorPrompt(
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
      undefined,
      {
        explorer: ['github-copilot/grok-code-fast-1'],
        oracle: ['default=openai/gpt-5.5', 'smart=openai/gpt-5.5-pro'],
      },
    );

    expect(prompt).toContain('<subagent_model_roster>');
    expect(prompt).toContain('- @explorer: github-copilot/grok-code-fast-1');
    expect(prompt).toContain(
      '- @oracle: default=openai/gpt-5.5; smart=openai/gpt-5.5-pro',
    );
  });

  test('filters subagent model roster to enabled agents', () => {
    const prompt = buildOrchestratorPrompt(
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
      new Set(['oracle']),
      {
        explorer: ['github-copilot/grok-code-fast-1'],
        oracle: ['default=openai/gpt-5.5', 'smart=openai/gpt-5.5-pro'],
      },
    );

    expect(prompt).toContain(
      '- @oracle: default=openai/gpt-5.5; smart=openai/gpt-5.5-pro',
    );
    expect(prompt).not.toContain(
      '- @explorer: github-copilot/grok-code-fast-1',
    );
  });

  test('empty model names do not break prompt', () => {
    const prompt = buildOrchestratorPrompt('', '');
    expect(prompt).not.toContain('{{');
  });

  test('includes only enabled agent descriptions when set provided', () => {
    const prompt = buildOrchestratorPrompt(
      undefined,
      undefined,
      new Set(['oracle', 'fixer']),
    );
    expect(prompt).toContain('technical analysis and code review');
    expect(prompt).toContain('implementation specialist');
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
    expect(prompt).toContain('technical analysis and code review');
    expect(prompt).toContain('UI/UX specialist for ALL user-facing UI');
    expect(prompt).toContain('implementation specialist');
    expect(prompt).toContain('rules citation from steward_paths');
    expect(prompt).toContain('screenshot / attached-image analyst');
  });

  test('orchestrator prompt is reasonably sized after compaction', () => {
    const prompt = buildOrchestratorPrompt('openai/gpt-5', 'openai/gpt-5-pro');
    // Should be well under the ~10k token old size
    expect(prompt.length).toBeLessThan(36000);
  });
});
