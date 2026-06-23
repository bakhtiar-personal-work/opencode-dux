import { describe, expect, test } from 'bun:test';
import {
  buildOrchestratorPrompt,
  createOrchestratorAgent,
  resolvePrompt,
} from './orchestrator';

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
    expect(prompt).toContain('You route and delegate.');
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
    expect(prompt).toContain('Do not route underspecified handoffs to @fixer.');
    expect(prompt).toContain('## Verification');
    expect(prompt).toContain("Prioritize evidence from delegated agents'");
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
    expect(prompt).toContain('Preserve session context');
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('When reporting final results to the user:');
    expect(prompt).toContain('# Communication');
    expect(prompt).toContain('Lead with the answer or status, not the process');
  });

  test('inlines dynamic oracle model guidance with configured models', () => {
    const prompt = buildOrchestratorPrompt(
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
    );

    expect(prompt).toContain('# Oracle Model Selection');
    expect(prompt).toContain('openai/gpt-5.5');
    expect(prompt).toContain('openai/gpt-5.5-pro');
    expect(prompt).toContain('Read allowed variants from **Agent Models**');
    expect(prompt).not.toContain('Scenario -> model+variant:');
  });

  test('execution flow references inline policy blocks', () => {
    const prompt = buildOrchestratorPrompt();

    expect(prompt).toContain('2) **STEWARD BRIEF:**');
    expect(prompt).toContain('3) **CONTEXT RETRIEVAL:**');
    expect(prompt).toContain('4) **DISCOVERY:**');
    expect(prompt).toContain('5) **FIRST SPECIALIST:**');
    expect(prompt).toContain('6) **PLAN PRESENTATION:**');
    expect(prompt).toContain('7) **IMPLEMENTATION:**');
    expect(prompt).toContain('9) **VERIFICATION:**');
  });

  test('includes subagent model roster when provided', () => {
    const prompt = buildOrchestratorPrompt(
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
      undefined,
      {
        explorer: ['default=github-copilot/grok-code-fast-1 (thinking=off)'],
        oracle: [
          'default=openai/gpt-5.5 (variants=high < max)',
          'smart=openai/gpt-5.5-pro (variants=max)',
        ],
      },
    );

    expect(prompt).toContain('## Agent Models');
    expect(prompt).toContain('thinking=off');
    expect(prompt).toContain(
      'default=openai/gpt-5.5 (variants=high < max); smart=openai/gpt-5.5-pro (variants=max)',
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

describe('createOrchestratorAgent - customInstruction', () => {
  test('prepends multiline customInstruction to resolved prompt', () => {
    const instruction = 'Line 1\nLine 2';
    const agent = createOrchestratorAgent(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      instruction,
    );

    expect(agent.config.prompt).toBe(
      `${instruction}\n\n${buildOrchestratorPrompt()}`,
    );
  });

  test('omitting customInstruction leaves prompt byte-for-byte equivalent', () => {
    const withUndefined = createOrchestratorAgent(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const withoutParam = createOrchestratorAgent();

    expect(withUndefined.config.prompt).toBe(withoutParam.config.prompt);
    expect(withUndefined.config.prompt).toBe(buildOrchestratorPrompt());
  });

  test('customInstruction applies before custom prompt override', () => {
    const instruction = 'PREFIX';
    const agent = createOrchestratorAgent(
      undefined,
      'CUSTOM PROMPT',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      instruction,
    );

    expect(agent.config.prompt).toBe(`${instruction}\n\nCUSTOM PROMPT`);
  });
});
