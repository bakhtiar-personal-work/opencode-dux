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
  test('starts with role and rules sections', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt.startsWith('# Role')).toBe(true);
    expect(prompt).toContain('# Rules');
    expect(prompt).toContain(
      'You route and delegate.',
    );
  });

  test('keeps routing gates and agent roster near the top', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('# Routing Gates');
    expect(prompt).toContain('# Agents');
    expect(prompt).toContain('@oracle');
    expect(prompt).toContain('@fixer');
  });

  test('includes approval checkpoint that forbids self-approval', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('## Approval Checkpoint');
    expect(prompt).toContain(
      'Implementation approval must come from the user, never from your own reasoning.',
    );
    expect(prompt).toContain(
      'The same assistant turn may NOT both first present the implementation plan and then delegate to @fixer unless the latest user message already contains explicit approval.',
    );
  });

  test('inlines planning, routing, handoff, and verification policy blocks', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('# Planning Gate');
    expect(prompt).toContain('**Explicit approval required before step 4:**');
    expect(prompt).toContain('## Routing Enforcement');
    expect(prompt).toContain('**Good routing:**');
    expect(prompt).toContain('## Specialist Handoff');
    expect(prompt).toContain(
      'Do not route underspecified handoffs to @fixer.',
    );
    expect(prompt).toContain('## Verification');
    expect(prompt).toContain(
      "Prioritize evidence from delegated agents'",
    );
  });

  test('inlines steward, interpreter, discovery, recovery, output, and communication blocks', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('# Steward Protocol');
    expect(prompt).toContain('Stewardship required for any task');
    expect(prompt).toContain('## Interpreter Protocol');
    expect(prompt).toContain(
      'User message includes images and task is not explicitly UI redesign/polish:',
    );
    expect(prompt).toContain('# Capability Discovery');
    expect(prompt).toContain(
      'BEFORE delegating to any specialist subagent (@oracle, @designer, @librarian)',
    );
    expect(prompt).toContain('## Recovery');
    expect(prompt).toContain(
      'Preserve session context',
    );
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('When reporting final results to the user:');
    expect(prompt).toContain('# Communication');
    expect(prompt).toContain(
      'Lead with the answer or status, not the process',
    );
  });

  test('inlines the oracle model matrix with configured models', () => {
    const prompt = buildOrchestratorPrompt(
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
    );

    expect(prompt).toContain('# Oracle Model Selection');
    expect(prompt).toContain('openai/gpt-5.5');
    expect(prompt).toContain('openai/gpt-5.5-pro');
    expect(prompt).toContain('Scenario -> model+variant:');
  });

  test('execution flow references inline policy blocks', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain(
      '2) **STEWARD BRIEF:**',
    );
    expect(prompt).toContain(
      '3) **CONTEXT RETRIEVAL:**',
    );
    expect(prompt).toContain(
      '4) **DISCOVERY:**',
    );
    expect(prompt).toContain(
      '5) **FIRST SPECIALIST:**',
    );
    expect(prompt).toContain(
      '6) **PLAN PRESENTATION:**',
    );
    expect(prompt).toContain(
      '7) **IMPLEMENTATION:**',
    );
    expect(prompt).toContain(
      '9) **VERIFICATION:**',
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

    expect(prompt).toContain('## Agent Models');
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
