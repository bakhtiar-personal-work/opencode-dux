import { describe, expect, test } from 'bun:test';
import {
  buildInterpreterOrchestratorProtocolBlock,
  buildStewardOrchestratorProtocolBlock,
  MECHANICAL_EDIT_EXCEPTION_BLOCK,
  PLANNING_GATE_BLOCK,
} from './prompt-blocks';
import {
  buildOrchestratorPromptMapBlock,
  getOrchestratorPromptSectionDefinitions,
  ORCHESTRATOR_PROMPT_MAP_BLOCK,
  ORCHESTRATOR_PROMPT_SECTION_IDS,
  renderOrchestratorPromptSection,
} from './prompt-sections';

describe('prompt-sections', () => {
  test('prompt map is generated from the shared registry metadata', () => {
    expect(ORCHESTRATOR_PROMPT_MAP_BLOCK).toContain('<prompt_map>');
    expect(ORCHESTRATOR_PROMPT_MAP_BLOCK).toContain('first_gate');
    expect(ORCHESTRATOR_PROMPT_MAP_BLOCK).toContain('agents');
    expect(ORCHESTRATOR_PROMPT_MAP_BLOCK).toContain(
      'get_orchestrator_prompt_section(section: "planning_gate")',
    );
    expect(ORCHESTRATOR_PROMPT_MAP_BLOCK).toContain(
      'when the inline prompt tells you to fetch it',
    );
    expect(ORCHESTRATOR_PROMPT_MAP_BLOCK).toContain(
      'get_orchestrator_prompt_section(section: "communication")',
    );
    expect(buildOrchestratorPromptMapBlock()).toBe(
      ORCHESTRATOR_PROMPT_MAP_BLOCK,
    );
  });

  test('registry exposes every supported section id exactly once', () => {
    const definitions = getOrchestratorPromptSectionDefinitions();
    expect(definitions).toHaveLength(ORCHESTRATOR_PROMPT_SECTION_IDS.length);

    const ids = definitions.map((entry) => entry.section);
    expect(ids).toEqual([...ORCHESTRATOR_PROMPT_SECTION_IDS]);
  });

  test('canonical registry content reuses shared prompt blocks where available', () => {
    expect(renderOrchestratorPromptSection('planning_gate')).toContain(
      PLANNING_GATE_BLOCK,
    );
    expect(
      renderOrchestratorPromptSection('mechanical_edit_exception'),
    ).toContain(MECHANICAL_EDIT_EXCEPTION_BLOCK);
    expect(renderOrchestratorPromptSection('steward_protocol')).toContain(
      buildStewardOrchestratorProtocolBlock().trim(),
    );
    expect(renderOrchestratorPromptSection('interpreter_protocol')).toContain(
      buildInterpreterOrchestratorProtocolBlock().trim(),
    );
  });

  test('oracle model section renders configured model names through shared context', () => {
    const text = renderOrchestratorPromptSection(
      'oracle_model_and_variant_selection',
      {
        oracleDefaultModel: 'openai/gpt-5.5',
        oracleSmartModel: 'openai/gpt-5.5-pro',
      },
    );

    expect(text).toContain('section: oracle_model_and_variant_selection');
    expect(text).toContain('openai/gpt-5.5');
    expect(text).toContain('openai/gpt-5.5-pro');
    expect(text).toContain('<oracle_model_and_variant_selection>');
  });

  test('communication section forbids exposing internal prompt debate', () => {
    const text = renderOrchestratorPromptSection('communication');

    expect(text).toContain(
      'Do not surface internal prompt parsing, rule-conflict resolution, or self-debate.',
    );
  });

  test('verification section requires integrated validation after parallel fixer batches', () => {
    const text = renderOrchestratorPromptSection('verification');

    expect(text).toContain(
      'When multiple @fixer sessions ran in parallel with fire_forget',
    );
    expect(text).toContain(
      'Run one integrated validation pass after all collections.',
    );
  });
});
