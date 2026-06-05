import { describe, expect, test } from 'bun:test';
import {
  buildInterpreterOrchestratorProtocolBlock,
  buildStewardOrchestratorProtocolBlock,
  CORE_CAPABILITY_AWARENESS_BLOCK,
  CRITICAL_INVARIANTS,
  DESIGNER_VARIANT_SCOPE_LINES,
  FIRST_GATE_BLOCK,
  INTERPRETER_VARIANT_SCOPE_LINES,
  LIBRARIAN_VARIANT_SCOPE_LINES,
  MECHANICAL_EDIT_EXCEPTION_BLOCK,
  ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK,
  PLANNING_GATE_BLOCK,
  SELF_REVIEW_BLOCK,
  STEWARD_PATH_GLOBS,
  STEWARD_VARIANT_SCOPE_LINES,
  SUBAGENT_NEEDS_USER_FORMAT,
  USER_CHOICE_POLICY_BLOCK,
} from './prompt-blocks';

describe('CRITICAL_INVARIANTS', () => {
  test('contains critical and procedural invariant blocks', () => {
    expect(CRITICAL_INVARIANTS).toContain('<critical_invariants>');
    expect(CRITICAL_INVARIANTS).toContain('<procedural_invariants>');
    expect(CRITICAL_INVARIANTS).toContain('NEVER edit, write, read');
    expect(CRITICAL_INVARIANTS).toContain(
      'ALWAYS delegate analysis to @oracle',
    );
    expect(CRITICAL_INVARIANTS).toContain('ALWAYS pass explicit');
    expect(CRITICAL_INVARIANTS).toContain(
      '@designer for UI, otherwise @oracle',
    );
    expect(CRITICAL_INVARIANTS).toContain(
      'context retrieval via @explorer/@librarian as needed',
    );
    expect(CRITICAL_INVARIANTS).toContain('<planning_gate>');
    expect(CRITICAL_INVARIANTS).toContain(
      'Report verification before declaring success',
    );
  });
});

describe('MECHANICAL_EDIT_EXCEPTION_BLOCK', () => {
  test('defines exact criteria for direct @fixer routing', () => {
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      '<mechanical_edit_exception>',
    );
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'Direct @fixer-first routing is allowed ONLY if ALL are true',
    );
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'If ANY condition is false or uncertain, the task is NOT mechanical.',
    );
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'When unsure, treat as non-mechanical and route to @oracle.',
    );
  });

  test('includes all seven criteria conditions', () => {
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'Exact file path is known',
    );
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain('Change is obvious');
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'No diagnosis or root-cause analysis needed',
    );
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'No tradeoff evaluation required',
    );
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'No UI/UX changes involved',
    );
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'No architecture or design decisions',
    );
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      'No multi-step reasoning required',
    );
  });
});

describe('FIRST_GATE_BLOCK', () => {
  test('centralizes first-pass routing gates for the orchestrator prompt', () => {
    expect(FIRST_GATE_BLOCK).toContain('<first_gate>');
    expect(FIRST_GATE_BLOCK).toContain('0) STEWARDSHIP GATE');
    expect(FIRST_GATE_BLOCK).toContain('1) CONTEXT RETRIEVAL GATE');
    expect(FIRST_GATE_BLOCK).toContain('ORACLE GATE');
    expect(FIRST_GATE_BLOCK).toContain('DESIGNER GATE');
    expect(FIRST_GATE_BLOCK).toContain('CAPABILITY DISCOVERY');
    expect(FIRST_GATE_BLOCK).toContain('LIFECYCLE: For code-affecting work');
    expect(FIRST_GATE_BLOCK).toContain(
      'explicit user confirmation on the plan/handoff',
    );
  });
});

describe('PLANNING_GATE_BLOCK', () => {
  test('contains the four-step planning cycle', () => {
    expect(PLANNING_GATE_BLOCK).toContain('<planning_gate>');
    expect(PLANNING_GATE_BLOCK).toContain('1) ANALYSIS');
    expect(PLANNING_GATE_BLOCK).toContain('2) PRESENT');
    expect(PLANNING_GATE_BLOCK).toContain('3) ADJUST');
    expect(PLANNING_GATE_BLOCK).toContain('4) IMPLEMENT');
    expect(PLANNING_GATE_BLOCK).toContain('Skip this gate ONLY when');
  });

  test('allows analysis delegation before user approval', () => {
    expect(PLANNING_GATE_BLOCK).toContain('no approval needed for analysis');
    expect(PLANNING_GATE_BLOCK).toContain('ALWAYS permitted');
    expect(PLANNING_GATE_BLOCK).toContain(
      'After steward brief and any needed @explorer/@librarian retrieval',
    );
  });

  test('narrows the mechanical-edit skip to no-diagnosis cases', () => {
    expect(PLANNING_GATE_BLOCK).toContain('no diagnosis needed');
    expect(PLANNING_GATE_BLOCK).toContain(
      'no design or architecture choice remains',
    );
  });

  test('requires approval before implementation but allows discovery', () => {
    expect(PLANNING_GATE_BLOCK).toContain('Only after explicit user approval');
    expect(PLANNING_GATE_BLOCK).toContain(
      'If the handoff already contains <execution_todo>, delegate directly in the',
    );
    expect(PLANNING_GATE_BLOCK).toContain(
      'same turn after a brief status update. Do NOT add new diagnosis, tradeoffs,',
    );
    expect(PLANNING_GATE_BLOCK).toContain(
      'implementation reasoning, or rewritten tasks between approval and @fixer.',
    );
    // Discovery is now allowed before approval (capability check, not implementation)
    expect(PLANNING_GATE_BLOCK).toContain('DO NOT proceed to implementation');
    expect(PLANNING_GATE_BLOCK).not.toContain(
      'DO NOT proceed to skill discovery',
    );
  });

  test('planning gate skip criteria say they do not override UI/oracle gates', () => {
    expect(PLANNING_GATE_BLOCK).toContain(
      'NEVER override the UI hard gate or the oracle diagnosis gate',
    );
    expect(PLANNING_GATE_BLOCK).toContain(
      'User-provided exact implementation alone does NOT make a task mechanical',
    );
    expect(PLANNING_GATE_BLOCK).toContain(
      'When unsure, treat as non-mechanical',
    );
  });

  test('does not contain blanket no-delegation language', () => {
    // Must NOT say "never delegate before approval" — only block implementation
    expect(PLANNING_GATE_BLOCK).not.toContain('NEVER delegate before approval');
    expect(PLANNING_GATE_BLOCK.toLowerCase()).not.toContain(
      'never delegate to any subagent before approval',
    );
  });

  test('generalizes presentation and adjustment to the first specialist', () => {
    expect(PLANNING_GATE_BLOCK).toContain(
      'Always present the specialist handoff to the user for confirmation',
    );
    expect(PLANNING_GATE_BLOCK).toContain(
      'For UI work, relay the @designer design plan / implementation notes',
    );
    expect(PLANNING_GATE_BLOCK).toContain(
      're-delegate the SAME specialist',
    );
  });
});

describe('ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK', () => {
  test('defines invariants for question workflow', () => {
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      '<orchestrator_clarification>',
    );
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      'Nine invariants',
    );
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain('1) Subagent');
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain('2) After user');
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      '3) Never substitute',
    );
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      '4) Multiple subagents',
    );
  });
});

describe('SUBAGENT_NEEDS_USER_FORMAT', () => {
  test('contains QuestionInfo schema instructions', () => {
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('QuestionInfo JSON');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('raw JSON only');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"question"');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"header"');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"options"');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('Optional per question');
  });
});

describe('SELF_REVIEW_BLOCK', () => {
  test('contains 3-item compact self review', () => {
    expect(SELF_REVIEW_BLOCK).toContain('<self_review>');
    expect(SELF_REVIEW_BLOCK).toContain('invariants followed');
    expect(SELF_REVIEW_BLOCK).toContain('Output matches');
    expect(SELF_REVIEW_BLOCK).toContain('Facts vs assumptions');
  });

  test('is materially shorter than the old 5-item version', () => {
    expect(SELF_REVIEW_BLOCK.length).toBeLessThan(400);
  });
});

describe('USER_CHOICE_POLICY_BLOCK', () => {
  test('contains compact choice policy', () => {
    expect(USER_CHOICE_POLICY_BLOCK).toContain('<user_choice_policy>');
    expect(USER_CHOICE_POLICY_BLOCK).toContain('clear winner');
    expect(USER_CHOICE_POLICY_BLOCK).toContain('Balanced tradeoffs');
  });
});

describe('CORE_CAPABILITY_AWARENESS_BLOCK', () => {
  test('contains both host-injected and orchestrator capability guidance', () => {
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('<capabilities_usage>');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('available_skills');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('available_mcps');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('Installed Capabilities');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('Never assume fields');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('callable tool');
  });
});

describe('prompt-blocks', () => {
  test('steward protocol includes STEWARDSHIP REQUIRED block with enforcement language', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    expect(block).toContain('STEWARDSHIP REQUIRED (MUST RUN FIRST):');
    expect(block).toContain('MUST call');
    expect(block).toContain('@steward in blocking mode FIRST');
    expect(block).toContain('Do NOT call @oracle, @designer, or @fixer');
  });

  test('stewardship required includes skip conditions', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    expect(block).toContain('Pure meta questions');
    expect(block).toContain('Pure file/location discovery');
    expect(block).toContain('Exact-path mechanical edits');
  });

  test('stewardship required includes ALWAYS BLOCKING language', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    expect(block).toContain('STEWARDSHIP IS ALWAYS BLOCKING:');
    expect(block).toContain('NEVER delegate @steward with mode: "fire_forget"');
    expect(block).toContain('Steward citations are MANDATORY input');
    expect(block).toContain(
      'Copy steward citations verbatim into ALL downstream prompts',
    );
    expect(block).toContain('### Repo Rules (from @steward)');
  });

  test('steward protocol no longer references <first_gate> item 1', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    expect(block).not.toContain('same triggers as');
    expect(block).not.toContain('<first_gate>');
    expect(block).toContain('Steward brief runs before');
  });

  test('steward protocol lists every configured glob', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    for (const g of STEWARD_PATH_GLOBS) {
      expect(block).toContain(`\`${g}\``);
    }
    expect(block).toContain('Handoff only:');
    expect(block).toContain('Steward prompt:');
    expect(block).toContain('Attribution:');
  });

  test('interpreter protocol mentions delegate_subagent for interpreter', () => {
    const block = buildInterpreterOrchestratorProtocolBlock();
    expect(block).toContain('@interpreter');
  });

  test('librarian and designer variant lines stay aligned with orchestrator use', () => {
    expect(LIBRARIAN_VARIANT_SCOPE_LINES.length).toBe(4);
    expect(DESIGNER_VARIANT_SCOPE_LINES.length).toBe(4);
  });

  test('interpreter variant scope lines define low/medium/high', () => {
    expect(INTERPRETER_VARIANT_SCOPE_LINES.length).toBe(3);
    expect(INTERPRETER_VARIANT_SCOPE_LINES[0]).toMatch(/^low:/);
    expect(INTERPRETER_VARIANT_SCOPE_LINES[1]).toMatch(/^medium:/);
    expect(INTERPRETER_VARIANT_SCOPE_LINES[2]).toMatch(/^high:/);
  });

  test('steward variant scope lines define low/medium/high', () => {
    expect(STEWARD_VARIANT_SCOPE_LINES.length).toBe(3);
    expect(STEWARD_VARIANT_SCOPE_LINES[0]).toMatch(/^low:/);
    expect(STEWARD_VARIANT_SCOPE_LINES[1]).toMatch(/^medium:/);
    expect(STEWARD_VARIANT_SCOPE_LINES[2]).toMatch(/^high:/);
  });
});
