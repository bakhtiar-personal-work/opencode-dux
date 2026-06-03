import { describe, expect, test } from 'bun:test';
import {
  buildStewardOrchestratorProtocolBlock,
  PLANNING_GATE_BLOCK,
} from '../agents/prompt-blocks';
import { createOrchestratorPromptSectionTool } from './prompt-sections';

describe('createOrchestratorPromptSectionTool', () => {
  test('returns the canonical section body with section metadata', async () => {
    const tool = createOrchestratorPromptSectionTool();
    const result = await tool.execute({ section: 'planning_gate' }, {} as any);

    expect(result).toContain('section: planning_gate');
    expect(result).toContain('use_when:');
    expect(result).toContain(PLANNING_GATE_BLOCK);
  });

  test('returns rendered dynamic oracle section with configured models', async () => {
    const tool = createOrchestratorPromptSectionTool({
      oracleDefaultModel: 'openai/gpt-5.5',
      oracleSmartModel: 'openai/gpt-5.5-pro',
    });
    const result = await tool.execute(
      { section: 'oracle_model_and_variant_selection' },
      {} as any,
    );

    expect(result).toContain('section: oracle_model_and_variant_selection');
    expect(result).toContain('openai/gpt-5.5');
    expect(result).toContain('openai/gpt-5.5-pro');
  });

  test('section enum stays aligned with registry-backed content', async () => {
    const tool = createOrchestratorPromptSectionTool();
    const result = await tool.execute(
      { section: 'steward_protocol' },
      {} as any,
    );

    expect(result).toContain('section: steward_protocol');
    expect(result).toContain(buildStewardOrchestratorProtocolBlock().trim());
  });

  test('tool description frames the lookup as exact policy retrieval', () => {
    const tool = createOrchestratorPromptSectionTool();

    expect(tool.description).toContain(
      'when the inline orchestrator prompt requires an exact policy block',
    );
  });
});
