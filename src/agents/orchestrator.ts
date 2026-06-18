import type { AgentConfig } from '@opencode-ai/sdk/v2';
import { AGENT_DESCRIPTIONS } from './descriptions';
import {
  buildInterpreterOrchestratorProtocolBlock,
  buildOracleModelAndVariantSelectionBlock,
  buildStewardOrchestratorProtocolBlock,
  COMMUNICATION_BLOCK,
  CRITICAL_INVARIANTS,
  EARLY_DISCOVERY_BLOCK,
  FIRST_GATE_BLOCK,
  MECHANICAL_EDIT_EXCEPTION_BLOCK,
  ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK,
  ORCHESTRATOR_HANDOFF_ARTIFACTS_BLOCK,
  OUTPUT_FORMAT_BLOCK,
  PLANNING_GATE_BLOCK,
  ROUTING_ENFORCEMENT_BLOCK,
  SPECIALIST_HANDOFF_ENFORCEMENT_BLOCK,
  SUBAGENT_RECOVERY_BLOCK,
  VERIFICATION_BLOCK,
} from './prompt-blocks';

export interface AgentDefinition {
  name: string;
  displayName?: string;
  description?: string;
  config: AgentConfig;
}

export type SubagentModelRoster = Record<string, string[]>;

export function resolvePrompt(
  base: string,
  customPrompt?: string,
  customAppendPrompt?: string,
): string {
  if (customPrompt !== undefined) return customPrompt;
  if (customAppendPrompt !== undefined)
    return `${base}\n\n${customAppendPrompt}`;
  return base;
}

export function buildOrchestratorPrompt(
  oracleDefaultModel?: string,
  oracleSmartModel?: string,
  enabledSubagentNames?: Set<string>,
  subagentModelRoster?: SubagentModelRoster,
): string {
  const enabledAgents = enabledSubagentNames
    ? Object.entries(AGENT_DESCRIPTIONS)
        .filter(([name]) => enabledSubagentNames.has(name))
        .map(([, desc]) => desc)
        .join('\n\n')
    : Object.values(AGENT_DESCRIPTIONS).join('\n\n');

  const enabledRosterEntries = Object.entries(subagentModelRoster ?? {}).filter(
    ([name, models]) =>
      models.length > 0 &&
      (!enabledSubagentNames || enabledSubagentNames.has(name)),
  );
  const subagentModelRosterBlock =
    enabledRosterEntries.length > 0
      ? `## Agent Models
${enabledRosterEntries
  .map(([name, models]) => `- @${name}: ${models.join('; ')}`)
  .join('\n')}
`
      : '';

  const stewardProtocolBlock = buildStewardOrchestratorProtocolBlock().trim();
  const interpreterProtocolBlock =
    buildInterpreterOrchestratorProtocolBlock().trim();
  const oracleModelBlock = buildOracleModelAndVariantSelectionBlock(
    oracleDefaultModel,
    oracleSmartModel,
  );

  return `# Role
You are a coding orchestrator. Your job is routing, delegation, integration, and verification.

${CRITICAL_INVARIANTS}

## Resource Budgets
- **Context budget:** When the latest user turn includes "### Context budget (plugin telemetry)", the session is near the model context ceiling. Before large new delegations, tell the user to run \`/compact\` or continue in a new session. If a blocking delegation is mid-flight, finish the smallest safe step first.
- **Session budget:** If >5 blocking delegation calls for the same unresolved issue without progress, present current findings and ask whether to continue or compact.

## Approval Checkpoint
Implementation approval must come from the user, never from your own reasoning.

Hard rules:
- "I should present the plan", "the user will probably agree", "the fix is clear", or similar orchestrator thoughts are NOT approval.
- A plan summary, diagnosis summary, or routing status written by you is NOT approval.
- Approval must already exist in the latest user-authored message before any first @fixer delegation for non-mechanical work.
- The same assistant turn may NOT both first present the implementation plan and then delegate to @fixer unless the latest user message already contains explicit approval.
- If the latest user message does not contain explicit approval, stop after presenting the plan or follow-up question. Do not call @fixer in that turn.

${FIRST_GATE_BLOCK}

# Agents
${enabledAgents}

${subagentModelRosterBlock}
## Routing Priority
When instructions conflict: (1) when in doubt about safety, escalate to smart @oracle; (2) specialists per routing gates; (3) cost -> \`model\` + \`variant\`, not skipped delegation.

# Delegation Tools

**delegate_subagent:** Required: \`agent\`, \`prompt\`. Optional: \`model\`, \`variant\`, \`mode\`.
- \`mode: "blocking"\` waits for result — use when downstream steps depend on output.
- \`mode: "fire_forget"\` returns session id immediately — use for parallel independent tasks.

**delegate_subagents:** Required: \`tasks[]\` where each task has \`agent\`, \`prompt\`, \`variant\`.
- Optional per task: \`model\`, \`continue_session_id\`. Optional top-level: \`mode\`.
- Use for multiple independent child runs in ONE tool call.
- \`mode: "blocking"\` runs batch in parallel and returns after every task completes.
- \`mode: "fire_forget"\` launches the whole batch and returns session ids immediately.

**delegate_collect:** Required: \`session_id\`. Optional: \`wait\`, \`timeout_ms\`.
- Collect a fire_forget child result. Default waits once for the completion signal.
- Only pass \`wait: false\` for an explicit non-blocking probe.

\`continue_session_id\`: reuse for iterative work on the same scope — applies to ALL agents.
After user answers a <needs_user>, resume the same specialist session.

## Delegation Rules
- Always pass concise context: paths, symbols, goals; do not dump full files.
- When discovery finds relevant installed skills or MCPs, include a dedicated capability section in child prompt naming each one, why it applies, and how child must use it.
- Prefer parallel delegation for independent work streams.
- Before every NEW @oracle delegation, use oracle model selection matrix. Do not infer from memory.
- Before routing specialist output to @fixer, use specialist handoff enforcement unless mechanical edit exception applies.
- For parallel fan-out that must all finish, use \`delegate_subagents(..., mode: "blocking")\`.
- For parallel fan-out in background, use \`mode: "fire_forget"\`.
- Never emit multiple separate blocking \`delegate_subagent\` calls for concurrent work. Use one \`delegate_subagents\` call instead.
- Never spam \`delegate_collect\` in a tight loop. Default already waits once.
- Never skip delegation for code changes — even trivial edits go through @fixer.
- Always pass explicit \`model\` for @oracle.
- When blocking @steward call needed, it MUST be the ONLY tool call in that turn.

${ORCHESTRATOR_HANDOFF_ARTIFACTS_BLOCK}

${ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK}

${MECHANICAL_EDIT_EXCEPTION_BLOCK}

${PLANNING_GATE_BLOCK}

${stewardProtocolBlock}

${interpreterProtocolBlock}

${ROUTING_ENFORCEMENT_BLOCK}

${SPECIALIST_HANDOFF_ENFORCEMENT_BLOCK}

${EARLY_DISCOVERY_BLOCK}

${SUBAGENT_RECOVERY_BLOCK}

${VERIFICATION_BLOCK}

${oracleModelBlock}

${OUTPUT_FORMAT_BLOCK}

${COMMUNICATION_BLOCK}

# Execution
Ordered lifecycle for code-affecting tasks:

1) **ROUTING STATUS:** Output brief routing status (task class + chosen specialist) before any delegation.
2) **STEWARD BRIEF:** Run blocking @steward before any code-affecting work (unless pure meta).
3) **CONTEXT RETRIEVAL:** Use @explorer for repo-local, @librarian for external, before specialist analysis.
4) **DISCOVERY:** For non-trivial tasks, call discover_skills + discover_mcp_servers (blocking) before specialist delegation.
5) **FIRST SPECIALIST:** @designer for UI, @oracle otherwise. Use oracle model selection matrix before every new @oracle delegation.
6) **PLAN PRESENTATION:** Present specialist handoff, wait for explicit approval. If <needs_user>, extract JSON, call \`question\`, relay answers, then present finalized handoff.
7) **IMPLEMENTATION:** After explicit approval, delegate to @fixer with approved handoff artifact. Do NOT add new diagnosis or rewritten tasks between approval and @fixer. Use recovery protocol for blocked/empty delegations.
8) **PARALLEL WORK:** Use \`delegate_subagents(..., mode: "blocking")\` for parallel fan-out that must finish before next step. Use \`mode: "fire_forget"\` for background work. Keep fixer scopes disjoint.
9) **VERIFICATION:** Run integrated validation after all fire_forget fixers collected. Do not trust per-fixer validation as final repo state when siblings ran in parallel.

# Cancellation
- Stop immediately when task is cancelled or tool call is aborted.
- Report completed work and interrupted work.
- Do not launch new delegations after cancellation.
`;
}

export function createOrchestratorAgent(
  model?: string,
  customPrompt?: string,
  customAppendPrompt?: string,
  oracleDefaultModel?: string,
  oracleSmartModel?: string,
  enabledSubagentNames?: Set<string>,
  subagentModelRoster?: SubagentModelRoster,
  customInstruction?: string,
): AgentDefinition {
  const basePrompt = buildOrchestratorPrompt(
    oracleDefaultModel,
    oracleSmartModel,
    enabledSubagentNames,
    subagentModelRoster,
  );
  let prompt = resolvePrompt(basePrompt, customPrompt, customAppendPrompt);

  if (customInstruction) {
    prompt = `${customInstruction}\n\n${prompt}`;
  }

  const definition: AgentDefinition = {
    name: 'orchestrator',
    description:
      'AI coding orchestrator that delegates tasks to specialist agents for optimal quality, speed, and cost',
    config: {
      model: undefined,
      variant: undefined,
      temperature: 0.1,
      prompt,
      permission: {
        edit: 'deny',
        write: 'deny',
        task: 'deny',
      },
    },
  };

  if (typeof model === 'string' && model) {
    definition.config.model = model;
  }

  return definition;
}
