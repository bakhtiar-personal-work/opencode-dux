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
  test('starts with prompt_map so routing categories are indexed up front', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt.startsWith('<prompt_map>')).toBe(true);
    expect(prompt).toContain(
      '- first_gate: first-pass routing gates and precedence for initial specialist selection (inline in this prompt)',
    );
    expect(prompt).toContain(
      '- agents: currently available subagents and delegate-when guidance; only use agents listed there (inline in this prompt)',
    );
    expect(prompt).toContain(
      'get_orchestrator_prompt_section(section: "planning_gate")',
    );
  });

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

  test('includes routing priority, lookup tool, and clarification workflow', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('<prompt_lookup>');
    expect(prompt).toContain('<lookup_discipline>');
    expect(prompt).toContain('<routing_priority>');
    expect(prompt).toContain('<first_gate>');
    expect(prompt).toContain('<handoff_artifacts_routing>');
    expect(prompt).toContain('delegate_subagent');
    expect(prompt).toContain('delegate_subagents');
    expect(prompt).toContain('delegate_collect');
    expect(prompt).toContain('get_orchestrator_prompt_section');
    expect(prompt).toContain('<orchestrator_clarification>');
    expect(prompt).toContain('<needs_user>');
    expect(prompt).toContain('continue_session_id');
    expect(prompt).toContain('Nine invariants');
  });

  test('includes critical_invariants and procedural_invariants blocks', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('<critical_invariants>');
    expect(prompt).toContain('<procedural_invariants>');
    expect(prompt).toContain('NEVER edit, write, read');
    expect(prompt).toContain(
      'Tool availability never overrides this invariant',
    );
    expect(prompt).toContain('Report verification before declaring success');
  });

  test('lookup discipline makes fetched sections mandatory and forbids self-justified bypasses', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'When the inline prompt says Fetch `section_name`, that lookup call is REQUIRED before you act on that step.',
    );
    expect(prompt).toContain(
      'Tool availability never grants permission to bypass routing constraints.',
    );
    expect(prompt).toContain(
      'If a rule says @explorer / @fixer / @steward only, obey it even if you personally have read, grep, glob, or similar tools available.',
    );
  });

  test('references planning_gate lookup without inlining the full block', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'get_orchestrator_prompt_section(section: "planning_gate")',
    );
    expect(prompt).toContain(
      'Fetch `planning_gate` for the exact approval protocol and plan-adjustment loop.',
    );
    expect(prompt).not.toContain('1) ANALYSIS: After steward brief');
    expect(prompt).not.toContain(
      '4) IMPLEMENT: Only after explicit user approval',
    );
  });

  test('context_budget is near the start of the prompt (after <role>)', () => {
    const prompt = buildOrchestratorPrompt();
    const roleIndex = prompt.indexOf('<role>');
    const contextBudgetIndex = prompt.indexOf('<context_budget>');
    const criticalInvariantsIndex = prompt.indexOf('<critical_invariants>');
    expect(contextBudgetIndex).toBeGreaterThan(roleIndex);
    expect(contextBudgetIndex).toBeLessThan(criticalInvariantsIndex);
  });

  test('first_gate includes STEWARDSHIP GATE as gate 0 before ORACLE GATE', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('0) STEWARDSHIP GATE');
    expect(prompt).toContain('run blocking @steward FIRST');
    expect(prompt).toContain('Do NOT proceed to ORACLE GATE or DESIGNER GATE');
    expect(prompt).toContain('This gate takes precedence over all other gates');
    // STEWARDSHIP GATE must appear before ORACLE GATE
    const stewardGateIndex = prompt.indexOf('0) STEWARDSHIP GATE');
    const oracleGateIndex = prompt.indexOf('ORACLE GATE');
    expect(stewardGateIndex).toBeLessThan(oracleGateIndex);
  });

  test('prompt keeps a direct inline steward-first routing instruction', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('run blocking @steward FIRST');
    expect(prompt).toContain('Fetch `steward_protocol` for the full protocol');
  });

  test('prompt contains streaming/output requirements', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('Use `output_format` and `communication`');
    expect(prompt).not.toContain(
      'Output your reasoning and delegation decisions BEFORE waiting for subagent results.',
    );
  });

  test('execution section contains terse OUTPUT ROUTING STATUS as step 1', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('1) OUTPUT ROUTING STATUS');
    expect(prompt).toContain(
      'Before any delegation, output only a brief routing status update',
    );
    expect(prompt).toContain(
      'Do NOT narrate internal debate, quote prompt rules back to the user, or explain alternative routes you rejected.',
    );
    expect(prompt).not.toContain('0) OUTPUT REASONING');
  });

  test('execution section uses clean sequential numbering', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('1) OUTPUT ROUTING STATUS');
    expect(prompt).toContain('2) STEWARD BRIEF');
    expect(prompt).toContain('3) CAPABILITY DISCOVERY (BLOCKING)');
    expect(prompt).toContain('4) REQUIRED FIRST SPECIALIST');
    expect(prompt).toContain('5) PLAN PRESENTATION');
    expect(prompt).toContain('6) IMPLEMENTATION');
    expect(prompt).toContain('7) PARALLEL WORK');
    expect(prompt).toContain('8) VERIFICATION AND REPORTING');
    expect(prompt).not.toContain('1.5) CAPABILITY DISCOVERY');
    expect(prompt).not.toContain('2.5) PLAN PRESENTATION');
  });

  test('parallel delegation guidance uses fire_forget and keeps final validation with orchestrator', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'For actual parallel fan-out that must all finish before the next step, use `delegate_subagents(..., mode: "blocking")`.',
    );
    expect(prompt).toContain(
      'For actual parallel fan-out that can continue in the background, use `delegate_subagent` or `delegate_subagents` with `mode: "fire_forget"`.',
    );
    expect(prompt).toContain('delegate_subagents');
    expect(prompt).toContain(
      'After all fire_forget fixers are collected, run the integrated validation pass yourself.',
    );
  });

  test('forbids separate blocking delegate_subagent calls for intended concurrent work', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'Separate blocking calls are host-sequenced; use one `delegate_subagents` call instead.',
    );
    expect(prompt).toContain(
      'When you need multiple independent read-only searches or analyses and all must finish before synthesis, batch them in one blocking `delegate_subagents` call.',
    );
    expect(prompt).toContain(
      'The default behavior already waits once for completion; use `wait: false` only for a deliberate non-blocking probe.',
    );
  });

  test('explorer overlap rule allows independent read-only searches on the same files', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'Read-only @explorer searches may overlap on the same files when the questions are independent.',
    );
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

  test('prompt references routing enforcement lookup instead of inlining it', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'fetch `routing_enforcement` unless the task is obviously within the full mechanical edit exception',
    );
    expect(prompt).toContain('Fetch `routing_enforcement` before @fixer');
    expect(prompt).not.toContain('Good routing examples:');
  });

  test('prompt keeps direct routing summary for first specialist selection', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'Fix request with any ambiguity, diagnosis, regression, or root-cause work: @oracle first',
    );
    expect(prompt).toContain(
      'UI work detected: route to @designer FIRST per DESIGNER GATE in <first_gate>.',
    );
  });

  test('prompt does NOT contain stale <first_gate> item references', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).not.toContain('Run <first_gate> item 1');
    expect(prompt).not.toContain('<first_gate> 2');
  });

  test('prompt references mechanical_edit_exception lookup instead of inlining criteria', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('Fetch `mechanical_edit_exception`');
    expect(prompt).not.toContain(
      'Direct @fixer-first routing is allowed ONLY if ALL are true',
    );
  });

  test('execution references the mechanical edit exception through lookup guidance', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain('or the full mechanical edit exception');
    expect(prompt).toContain(
      'Fetch `mechanical_edit_exception` or `interpreter_protocol`',
    );
  });

  test('constraints include strengthened routing prohibitions', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'NEVER route planning, architecture, debugging, or regressions directly to @fixer',
    );
    expect(prompt).toContain('NEVER route UI work directly to @fixer');
    expect(prompt).toContain(
      'If a task could be mechanical or diagnostic, treat it as diagnostic',
    );
  });

  test('fix routing makes oracle the reasoning step before fixer', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).toContain(
      'Fix request with any ambiguity, diagnosis, regression, or root-cause work: @oracle first',
    );
    expect(prompt).toContain('Fetch `routing_enforcement` before @fixer');
  });

  test('does not inline oracle model matrix even when models are provided', () => {
    const prompt = buildOrchestratorPrompt(
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
    );
    expect(prompt).toContain(
      'get_orchestrator_prompt_section(section: "oracle_model_and_variant_selection")',
    );
    expect(prompt).not.toContain('Scenario -> model+variant:');
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

  test('does not inline detailed policy blocks that moved behind the lookup tool', () => {
    const prompt = buildOrchestratorPrompt();
    expect(prompt).not.toContain('STEWARDSHIP REQUIRED (MUST RUN FIRST):');
    expect(prompt).not.toContain(
      'User message includes images and task is not explicitly UI redesign/polish:',
    );
    expect(prompt).not.toContain(
      'BEFORE delegating to any specialist subagent (@oracle, @designer, @librarian)',
    );
    expect(prompt).not.toContain('Preserve session context: use `session_id`');
    expect(prompt).not.toContain(
      "Prioritize evidence from delegated agents' <verification> output",
    );
    expect(prompt).not.toContain('Scenario -> model+variant:');
    expect(prompt).not.toContain('When reporting final results to the user:');
    expect(prompt).not.toContain(
      'Lead with the answer, not the process (unless user asked for process).',
    );
  });
});
