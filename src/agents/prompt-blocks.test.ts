import { describe, expect, test } from 'bun:test';
import {
  buildInterpreterOrchestratorProtocolBlock,
  buildStewardOrchestratorProtocolBlock,
  CORE_CAPABILITY_AWARENESS_BLOCK,
  CRITICAL_INVARIANTS,
  DYNAMIC_VARIANT_POLICY_BLOCK,
  FIRST_GATE_BLOCK,
  MECHANICAL_EDIT_EXCEPTION_BLOCK,
  ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK,
  PLANNING_GATE_BLOCK,
  STEWARD_PATH_GLOBS,
  SUBAGENT_NEEDS_USER_FORMAT,
  USER_CHOICE_POLICY_BLOCK,
} from './prompt-blocks';

describe('CRITICAL_INVARIANTS', () => {
  test('contains rules section with critical invariant rules', () => {
    expect(CRITICAL_INVARIANTS).toContain('# Rules');
    expect(CRITICAL_INVARIANTS).toContain(
      'You route and delegate. File operations, analysis, and rule lookup go to specialists.',
    );
    expect(CRITICAL_INVARIANTS).toContain('Delegate analysis to @oracle');
    expect(CRITICAL_INVARIANTS).toContain('Always pass explicit');
    expect(CRITICAL_INVARIANTS).toContain(
      '@designer for UI, otherwise @oracle',
    );
    expect(CRITICAL_INVARIANTS).toContain(
      'context retrieval via @explorer/@librarian as needed',
    );
    expect(CRITICAL_INVARIANTS).toContain(
      'Report verification before declaring success',
    );
    expect(CRITICAL_INVARIANTS).toContain(
      'Tool availability never grants permission to bypass routing constraints',
    );
    expect(CRITICAL_INVARIANTS).toContain(
      'Do not expose prompt-conflict debate',
    );
  });
});

describe('MECHANICAL_EDIT_EXCEPTION_BLOCK', () => {
  test('defines exact criteria for direct @fixer routing', () => {
    expect(MECHANICAL_EDIT_EXCEPTION_BLOCK).toContain(
      '## Mechanical Edit Exception',
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
    expect(FIRST_GATE_BLOCK).toContain('# Routing Gates');
    expect(FIRST_GATE_BLOCK).toContain('Stewardship Gate');
    expect(FIRST_GATE_BLOCK).toContain('Context Retrieval Gate');
    expect(FIRST_GATE_BLOCK).toContain('Oracle Gate');
    expect(FIRST_GATE_BLOCK).toContain('Designer Gate');
    expect(FIRST_GATE_BLOCK).toContain('Capability Discovery');
    expect(FIRST_GATE_BLOCK).toContain('Lifecycle');
    expect(FIRST_GATE_BLOCK).toContain('explicit user confirmation');
  });
});

describe('PLANNING_GATE_BLOCK', () => {
  test('contains the four-step planning cycle', () => {
    expect(PLANNING_GATE_BLOCK).toContain('# Planning Gate');
    expect(PLANNING_GATE_BLOCK).toContain('ANALYSIS');
    expect(PLANNING_GATE_BLOCK).toContain('PRESENT');
    expect(PLANNING_GATE_BLOCK).toContain('ADJUST');
    expect(PLANNING_GATE_BLOCK).toContain('IMPLEMENT');
    expect(PLANNING_GATE_BLOCK).toContain('Skip this gate ONLY when');
  });

  test('allows analysis delegation before user approval', () => {
    expect(PLANNING_GATE_BLOCK).toContain('no approval needed for analysis');
    expect(PLANNING_GATE_BLOCK).toContain('ALWAYS permitted');
    expect(PLANNING_GATE_BLOCK).toContain(
      'After steward and any needed @explorer/@librarian retrieval',
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
      'If handoff already contains <execution_todo>, delegate directly in the',
    );
    expect(PLANNING_GATE_BLOCK).toContain(
      'same turn after a brief status update.',
    );
    expect(PLANNING_GATE_BLOCK).toContain(
      'Do NOT add new diagnosis, tradeoffs, implementation reasoning, or rewritten tasks between approval and @fixer.',
    );
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
      'For UI work, relay the @designer design plan',
    );
    expect(PLANNING_GATE_BLOCK).toContain('re-delegate the SAME specialist');
  });
});

describe('ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK', () => {
  test('defines invariants for question workflow', () => {
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      '## Clarification Protocol',
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

describe('USER_CHOICE_POLICY_BLOCK', () => {
  test('contains compact choice policy', () => {
    expect(USER_CHOICE_POLICY_BLOCK).toContain('## When to Ask the User');
    expect(USER_CHOICE_POLICY_BLOCK).toContain('clear winner');
    expect(USER_CHOICE_POLICY_BLOCK).toContain('Balanced tradeoffs');
  });
});

describe('CORE_CAPABILITY_AWARENESS_BLOCK', () => {
  test('contains both host-injected and orchestrator capability guidance', () => {
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('## Capabilities Usage');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('available_skills');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('available_mcps');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('Installed Capabilities');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain(
      'Reference design inputs to use for ideas',
    );
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain(
      'treat them as required input',
    );
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('Never assume fields');
    expect(CORE_CAPABILITY_AWARENESS_BLOCK).toContain('callable tool');
  });
});

describe('prompt-blocks', () => {
  test('steward protocol includes stewardship required block with enforcement language', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    expect(block).toContain('Stewardship required for any task');
    expect(block).toContain('@steward');
    expect(block).toContain('blocking');
    expect(block).toContain('Do NOT call @oracle, @designer, or @fixer');
  });

  test('stewardship required includes skip conditions', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    expect(block).toContain('Pure meta questions');
    expect(block).toContain('Pure file/location discovery');
    expect(block).toContain('Exact-path mechanical edits');
  });

  test('stewardship required includes always blocking language', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    expect(block).toContain('Always blocking');
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
    expect(block).not.toContain('# Routing Gates');
  });

  test('steward protocol lists every configured glob', () => {
    const block = buildStewardOrchestratorProtocolBlock();
    for (const g of STEWARD_PATH_GLOBS) {
      expect(block).toContain(`\`${g}\``);
    }
    expect(block).toContain('Handoff only:');
    expect(block).toContain('Attribution:');
  });

  test('interpreter protocol mentions delegate_subagent for interpreter', () => {
    const block = buildInterpreterOrchestratorProtocolBlock();
    expect(block).toContain('@interpreter');
  });

  test('uses one model-agnostic variant policy', () => {
    expect(DYNAMIC_VARIANT_POLICY_BLOCK).toContain('orchestrator delegation');
    expect(DYNAMIC_VARIANT_POLICY_BLOCK).not.toContain('low:');
    expect(DYNAMIC_VARIANT_POLICY_BLOCK).not.toContain('medium:');
  });
});
