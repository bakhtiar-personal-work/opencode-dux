import { describe, expect, test } from 'bun:test';
import {
  buildInterpreterOrchestratorProtocolBlock,
  buildStewardOrchestratorProtocolBlock,
  CORE_CAPABILITY_AWARENESS_BLOCK,
  CRITICAL_INVARIANTS,
  DESIGNER_VARIANT_SCOPE_LINES,
  INTERPRETER_VARIANT_SCOPE_LINES,
  LIBRARIAN_VARIANT_SCOPE_LINES,
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
    expect(CRITICAL_INVARIANTS).toContain('Run <first_gate> item 1');
    expect(CRITICAL_INVARIANTS).toContain('Run <planning_gate>');
    expect(CRITICAL_INVARIANTS).toContain(
      'Report verification before declaring success',
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
  });

  test('narrows the mechanical-edit skip to no-diagnosis cases', () => {
    expect(PLANNING_GATE_BLOCK).toContain('no diagnosis needed');
    expect(PLANNING_GATE_BLOCK).toContain(
      'no design or architecture choice remains',
    );
  });

  test('requires approval before implementation but allows discovery', () => {
    expect(PLANNING_GATE_BLOCK).toContain('Only after explicit user approval');
    // Discovery is now allowed before approval (capability check, not implementation)
    expect(PLANNING_GATE_BLOCK).toContain('DO NOT proceed to implementation');
    expect(PLANNING_GATE_BLOCK).not.toContain(
      'DO NOT proceed to skill discovery',
    );
  });

  test('does not contain blanket no-delegation language', () => {
    // Must NOT say "never delegate before approval" — only block implementation
    expect(PLANNING_GATE_BLOCK).not.toContain('NEVER delegate before approval');
    expect(PLANNING_GATE_BLOCK.toLowerCase()).not.toContain(
      'never delegate to any subagent before approval',
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
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"question"');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"header"');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"options"');
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
