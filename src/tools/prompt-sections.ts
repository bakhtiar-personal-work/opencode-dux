import type { ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import {
  ORCHESTRATOR_PROMPT_SECTION_IDS,
  type OrchestratorPromptSectionId,
  renderOrchestratorPromptSection,
} from '../agents/prompt-sections';

interface PromptSectionToolOptions {
  oracleDefaultModel?: string;
  oracleSmartModel?: string;
}

export function createOrchestratorPromptSectionTool(
  options?: PromptSectionToolOptions,
): ToolDefinition {
  return tool({
    description:
      'Returns the canonical orchestrator prompt policy block for one named section. ' +
      'Use it when the inline orchestrator prompt requires an exact policy block for routing, approval, recovery, verification, or communication rules.',
    args: {
      section: tool.schema
        .enum(ORCHESTRATOR_PROMPT_SECTION_IDS)
        .describe('The orchestrator policy section to retrieve'),
    },
    execute: async (args) =>
      renderOrchestratorPromptSection(
        args.section as OrchestratorPromptSectionId,
        {
          oracleDefaultModel: options?.oracleDefaultModel,
          oracleSmartModel: options?.oracleSmartModel,
        },
      ),
  });
}
