import { describe, expect, test } from 'bun:test';
import {
  buildInterpreterOrchestratorProtocolBlock,
  buildStewardOrchestratorProtocolBlock,
  CRITICAL_INVARIANTS,
  DESIGNER_VARIANT_SCOPE_LINES,
  formatOrchestratorOracleVariantDepthSection,
  INTERPRETER_VARIANT_SCOPE_LINES,
  LIBRARIAN_VARIANT_SCOPE_LINES,
  ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK,
  PLANNING_GATE_BLOCK,
  STEWARD_PATH_GLOBS,
  STEWARD_VARIANT_SCOPE_LINES,
  SUBAGENT_NEEDS_USER_FORMAT,
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
});

describe('ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK', () => {
  test('defines nine invariants for question workflow', () => {
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      '<orchestrator_clarification>',
    );
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      'Nine invariants',
    );
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain('1) Subagent');
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain('2) After user');
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain('3) Never');
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain('4) Multiple');
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      '5) User follow-up',
    );
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      '6) Subagent-to-user relay',
    );
    expect(ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK).toContain(
      '7) Token discipline',
    );
  });
});

describe('SUBAGENT_NEEDS_USER_FORMAT', () => {
  test('contains QuestionInfo schema instructions', () => {
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('QuestionInfo JSON format');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"question"');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"header"');
    expect(SUBAGENT_NEEDS_USER_FORMAT).toContain('"options"');
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
    expect(block).toContain('delegate_subagent(agent: "interpreter", ...)');
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

  test('oracle variant depth section includes four depth tiers', () => {
    const section = formatOrchestratorOracleVariantDepthSection();
    expect(section).toContain('VARIANT (depth):');
    expect(
      section.split('\n').filter((l) => l.startsWith('- low:')).length,
    ).toBe(1);
  });
});
