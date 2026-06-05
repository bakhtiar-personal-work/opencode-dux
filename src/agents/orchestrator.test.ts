import { describe, expect, test } from 'bun:test';
import { buildOrchestratorPrompt, resolvePrompt } from './orchestrator';

describe('resolvePrompt', () => {
  test('returns base when neither custom nor append provided', () => {
    expect(resolvePrompt('BASE PROMPT')).toBe('BASE PROMPT');
  });

  test('custom prompt replaces base entirely', () => {
    expect(resolvePrompt('BASE', 'CUSTOM')).toBe('CUSTOM');
  });

  test('append prompt is appended to base', () => {
    expect(resolvePrompt('BASE', undefined, 'APPEND')).toBe('BASE\n\nAPPEND');
  });
});

describe('buildOrchestratorPrompt', () => {
  test('starts with an inline prompt map instead of a lookup tool', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt.startsWith('<prompt_map>')).toBe(true);
    expect(prompt).toContain(
      'Fast lookup index — use this to map the orchestrator policy blocks that are already embedded in this prompt:',
    );
    expect(prompt).toContain(
      '- planning_gate: approval boundary before implementation (inline below)',
    );
    expect(prompt).toContain(
      '- specialist_handoff_enforcement: canonical specialist-to-fixer handoff rules (inline below)',
    );
    expect(prompt).not.toContain('get_orchestrator_prompt_section');
    expect(prompt).not.toContain('<prompt_lookup>');
  });

  test('keeps inline routing discipline and agent roster near the top', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('<lookup_discipline>');
    expect(prompt).toContain(
      'The top-level prompt map is a navigation index for inline policy blocks already present in this prompt.',
    );
    expect(prompt).toContain('<first_gate>');
    expect(prompt).toContain('<agents>');
    expect(prompt).toContain('@oracle');
    expect(prompt).toContain('@fixer');
  });

  test('includes approval checkpoint that forbids self-approval', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('<approval_checkpoint>');
    expect(prompt).toContain(
      'Implementation approval must come from the user, never from your own reasoning.',
    );
    expect(prompt).toContain(
      'The same assistant turn may NOT both first present the implementation plan and then delegate to @fixer unless the latest user message already contains explicit approval.',
    );
  });

  test('inlines planning, routing, handoff, and verification policy blocks', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('<planning_gate>');
    expect(prompt).toContain('EXPLICIT APPROVAL required before step 4:');
    expect(prompt).toContain('<routing_enforcement>');
    expect(prompt).toContain('Good routing examples:');
    expect(prompt).toContain('<specialist_handoff_enforcement>');
    expect(prompt).toContain(
      'Do not route an underspecified specialist handoff to @fixer.',
    );
    expect(prompt).toContain('<verification>');
    expect(prompt).toContain(
      "Prioritize evidence from delegated agents' <verification> output",
    );
  });

  test('inlines steward, interpreter, discovery, recovery, output, and communication blocks', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('<steward_protocol>');
    expect(prompt).toContain('STEWARDSHIP REQUIRED (MUST RUN FIRST):');
    expect(prompt).toContain('<interpreter_protocol>');
    expect(prompt).toContain(
      'User message includes images and task is not explicitly UI redesign/polish:',
    );
    expect(prompt).toContain('<early_discovery>');
    expect(prompt).toContain(
      'BEFORE delegating to any specialist subagent (@oracle, @designer, @librarian)',
    );
    expect(prompt).toContain('<subagent_recovery>');
    expect(prompt).toContain(
      'Preserve session context: use `session_id` from <delegate_session_continue> tag',
    );
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('When reporting final results to the user:');
    expect(prompt).toContain('<communication>');
    expect(prompt).toContain(
      'Lead with the answer, not the process (unless user asked for process).',
    );
  });

  test('inlines the oracle model matrix with configured models', () => {
    const prompt = buildOrchestratorPrompt(
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
    );

    expect(prompt).toContain('<oracle_model_and_variant_selection>');
    expect(prompt).toContain('INLINE POLICY RULE:');
    expect(prompt).toContain('openai/gpt-5.5');
    expect(prompt).toContain('openai/gpt-5.5-pro');
    expect(prompt).toContain('Scenario -> model+variant:');
  });

  test('execution flow references inline policy blocks instead of fetched sections', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain(
      '2) STEWARD BRIEF: For code-affecting work, use <steward_protocol> before deciding whether the steward gate applies',
    );
    expect(prompt).toContain(
      '3) CAPABILITY DISCOVERY (BLOCKING): For non-trivial tasks, use <early_discovery> before deciding whether to skip discovery.',
    );
    expect(prompt).toContain(
      '4) REQUIRED FIRST SPECIALIST: @designer for ANY user-facing UI work.',
    );
    expect(prompt).toContain(
      'Use <oracle_model_and_variant_selection> immediately before every new @oracle delegation.',
    );
    expect(prompt).toContain(
      '5) PLAN PRESENTATION: Use <planning_gate> before presenting any implementation plan or deciding whether approval is required.',
    );
    expect(prompt).toContain(
      '6) IMPLEMENTATION: Before any @fixer delegation, use <routing_enforcement> and <specialist_handoff_enforcement>',
    );
    expect(prompt).toContain(
      '8) VERIFICATION AND REPORTING: Use <verification> before declaring success. Use <output_format> and <communication> immediately before the final user-facing response.',
    );
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
  });

  test('prompt size stays bounded after inlining sections', () => {
    const prompt = buildOrchestratorPrompt('openai/gpt-5', 'openai/gpt-5-pro');

    expect(prompt.length).toBeLessThan(50000);
  });
});
