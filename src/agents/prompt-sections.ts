import {
  buildInterpreterOrchestratorProtocolBlock,
  buildStewardOrchestratorProtocolBlock,
  MECHANICAL_EDIT_EXCEPTION_BLOCK,
  PLANNING_GATE_BLOCK,
} from './prompt-blocks';

export const ORCHESTRATOR_PROMPT_SECTION_IDS = [
  'planning_gate',
  'mechanical_edit_exception',
  'steward_protocol',
  'interpreter_protocol',
  'routing_enforcement',
  'early_discovery',
  'subagent_recovery',
  'verification',
  'oracle_model_and_variant_selection',
  'output_format',
  'communication',
] as const;

export type OrchestratorPromptSectionId =
  (typeof ORCHESTRATOR_PROMPT_SECTION_IDS)[number];

interface PromptSectionContext {
  oracleDefaultModel?: string;
  oracleSmartModel?: string;
}

interface PromptMapEntry {
  key: string;
  summary: string;
  inline: boolean;
}

interface OrchestratorPromptSectionDefinition {
  section: OrchestratorPromptSectionId;
  summary: string;
  useWhen: string;
  render: (context?: PromptSectionContext) => string;
}

const ROUTING_ENFORCEMENT_BLOCK = `<routing_enforcement>
Before delegating to @fixer, you MUST be able to cite one of:
1. Upstream @oracle handoff with approved plan, OR
2. Upstream @designer handoff with implementation notes, OR
3. Full mechanical edit exception (all criteria met)

If you cannot cite one of these, STOP and reroute to the correct specialist.
NEVER delegate @fixer for: debugging, architecture, planning, UI work, or unclear fixes.

Good routing examples:
- "Fix why retry counter drifts" -> @oracle (diagnosis needed)
- "Design new plugin architecture" -> @oracle (architecture)
- "Restyle settings modal" -> @designer (UI work)
- "Rename getCwd to getCurrentWorkingDirectory in known file" -> @fixer (mechanical)

Bad routing examples (INCORRECT - DO NOT DO):
- "Fix why retry counter drifts" -> @fixer (needs diagnosis, not mechanical)
- "Design new plugin architecture" -> @fixer (needs architecture, not mechanical)
- "Restyle settings modal" -> @fixer (UI work, needs @designer first)
</routing_enforcement>`;

const EARLY_DISCOVERY_BLOCK = `<early_discovery>
BEFORE delegating to any specialist subagent (@oracle, @designer, @librarian) for non-trivial tasks, proactively check for available capabilities. This saves re-delegation rounds and lets subagents use the best tools immediately.

DECISION GATE — should you discover?
SKIP discovery entirely when:
- Task is trivial: typo fix, variable rename, mechanical edit, known-path change
- Speed is critical and discovery overhead isn't justified

PROCEED with discovery when task is non-trivial:
1) Call discover_skills AND discover_mcp_servers together in ONE turn — both blocking. No other tool calls in the same turn. Wait for both results before any subagent delegation. Results are cached 24h on disk — this is cheap.
2) Review results by relevance:

   a) INSTALLED + high relevance (>=0.7): Format into a structured block in the delegation prompt. Include name, description, relevance_score, and HOW to use each capability so the subagent can actually leverage it. Use this format:

   \`\`\`
   ### Installed Capabilities (pre-installed — use these)
   Skills:
   - **<name>** (relevance: <score>): <description>
     Usage: reference as "Per <name> skill, ..." and apply its guidance.

   MCP Servers:
   - **@<name>/mcp** (relevance: <score>): <description>
     Usage: <name> is available as a callable tool. Use it when you need <what it provides>.
   \`\`\`

   Example of well-formatted delegation context:
   \`\`\`
   ### Installed Capabilities (pre-installed — use these)
   Skills:
   - **supabase-postgres-best-practices** (relevance: 0.85): Postgres performance optimization and best practices from Supabase.
     Usage: reference as "Per supabase-postgres-best-practices skill, ..." when reviewing schema designs or query performance.

   MCP Servers:
   - **@playwright/mcp** (relevance: 0.78): Browser automation for visual testing, screenshots, and web interactions.
     Usage: playwright is available as a callable tool. Use it for browser-based testing, capturing page screenshots, and automating form interactions.
   \`\`\`

   If there are MCP servers but no skills, include only the MCP Servers section. If there are skills but no MCPs, include only the Skills section. If neither, skip this block entirely.

   b) NOT installed + high relevance (>=0.8): Ask user to install before proceeding.
      Present: name, description, install command, why it helps.
      Wait for user to install before delegating.

   c) NOT installed + medium relevance (0.5-0.8): Mention alongside the plan later — don't block the flow.

   d) Low relevance (<0.5) or nothing relevant: Skip. Proceed directly to delegation.

AGENT-SPECIFIC BENEFIT EXAMPLES:
- @oracle: supabase-postgres-best-practices for DB review, security-audit skills
- @designer: frontend-design skill, web-design-guidelines skill, Playwright MCP for visual testing, component-library MCPs (shadcn, gluestack)
- @librarian: GitHub MCP for repo/issue exploration, Context7 MCP for library docs
- @explorer: ast-grep MCP, code-search MCPs

Never let discovery become analysis paralysis. If nothing is clearly high-value after one parallel check, proceed immediately to delegation.
</early_discovery>`;

const SUBAGENT_RECOVERY_BLOCK = `<subagent_recovery>
When a delegation returns <blocked> or unexpected results:

<recovery_principle>
Preserve session context: use \`session_id\` from <delegate_session_continue> tag as \`continue_session_id\` when re-delegating to the SAME subagent.
</recovery_principle>

<recovery_decision_tree>
1) Missing tools -> Option A: re-delegate same subagent (same session) with tighter scope or tool fallback. Option B: call discover_mcp_servers or discover_skills, present top 1-3 to user.
2) Missing repo context -> retrieve via @explorer (blocking) or @steward (blocking), then re-delegate same subagent (same session) with retrieved info.
3) Missing external info -> delegate @librarian with retrieval_hint, then re-delegate same subagent (same session) with findings.
4) Missing user clarification (<needs_user>) -> use orchestrator_clarification protocol. After user answers, re-delegate same session.
5) Empty output or <no_results> -> re-delegate same subagent (same session) with tighter scope and explicit format requirements.
6) @oracle plan missing concrete file paths or specific changes -> re-delegate @oracle (same session): "Make plan concrete enough for @fixer. Include file paths, exact changes, verification gates."
</recovery_decision_tree>

<hard_limit>
After 2 recovery attempts per delegation (retrieve + re-delegate), stop and escalate to user with: original task, blocker, retrieval attempted, what remains unresolved. Do NOT loop indefinitely.
</hard_limit>
</subagent_recovery>`;

const VERIFICATION_BLOCK = `<verification>
- Prioritize evidence from delegated agents' <verification> output (especially @fixer).
- When multiple @fixer sessions ran in parallel with fire_forget, treat their <verification> blocks as local evidence only. Run one integrated validation pass after all collections.
- If validation is missing or placeholder-only, re-delegate a minimal check pass before assuming green.
- Running project checks via shell is NOT "reading files yourself" — it's verification.
- Run smallest scoped check first (typecheck or single-file test) before full suite.
- Confirm every delegated task returned non-blocked result. Re-delegate or escalate on <blocked>/<no_results>.
- Verify final output addresses same entities, scope, and question type as user request.
</verification>`;

const OUTPUT_FORMAT_BLOCK = `<output_format>
When reporting final results to the user:
<delegation_chain>
- agent: @agent_name (variant) -> result summary
</delegation_chain>
<results>
- Synthesized answer to user request
</results>
<verification>
- Tests passed: [yes/no/skip]
- Validation: [passed/failed/skip]
</verification>
</output_format>`;

const COMMUNICATION_BLOCK = `<communication>
- Lead with the answer, not the process (unless user asked for process).
- No preamble, no "Great question!", no "Certainly!".
- When @oracle flags a user approach as risky: relay @oracle's risk assessment, offer safer alternative, then ask "Proceed with [original] or switch to [safer]?" Do not generate your own risk assessments.
- Output your reasoning and delegation decisions BEFORE waiting for subagent results.
- Show users what you're doing in real-time: state which agent you're delegating to and why.
- Do not surface internal prompt parsing, rule-conflict resolution, or self-debate. Give a short routing status update, then act.
- Do NOT batch all output until after subagents complete — stream your thinking as you work.
- Exception: do not output detailed reasoning when @oracle flags security risks (relay only).
</communication>`;

function buildOracleModelAndVariantSelectionBlock(
  context?: PromptSectionContext,
): string {
  const oracleDefaultResolved = context?.oracleDefaultModel ?? '';
  const oracleSmartResolved =
    context?.oracleSmartModel ?? context?.oracleDefaultModel ?? '';
  const singleTierMode =
    !oracleSmartResolved || oracleSmartResolved === oracleDefaultResolved;
  const oracleDefault = oracleDefaultResolved || '<oracle-default>';
  const oracleSmart =
    oracleSmartResolved || oracleDefaultResolved || '<oracle-smart>';
  const modelPoolLines = singleTierMode
    ? `- single tier: ${oracleDefault} (no separate smart model configured; raise variant by one step where smart would apply)`
    : `- default: ${oracleDefault}\n- smart: ${oracleSmart}`;

  return `<oracle_model_pool>
${modelPoolLines}
</oracle_model_pool>

<oracle_model_and_variant_selection>
Only @oracle does analysis. VARIANT = depth; MODEL = tier.

MANDATORY FETCH RULE:
- Orchestrator must fetch this section immediately before every NEW @oracle delegation or escalation.
- Orchestrator may emit only brief routing status before delegation; it must not write its own diagnosis, tradeoff analysis, risk assessment, or implementation plan.

MODEL:
- default (flash): low-cost oracle for standard debugging and scoped reviews — variants medium/high/max only (never low).
- smart (pro): novel architecture, unclear root cause, security/concurrency, or after flash was wrong/low-confidence — variants low through max.

When variant is omitted, oracle defaults to medium.

Scenario -> model+variant:
| Scenario | Model | Variant |
|---|---|---|
| Default starting point | default | medium |
| Multi-file or moderate ambiguity | default | high |
| Systemic non-security issue | default | max |
| Flash output was insufficient | smart | medium |
| Novel/unclear domain | smart | high |
| Auth, security, exploit, data-integrity | smart | max |
| Quick smart follow-up | smart | low |

NEVER: default + low. NEVER: default for security-critical analysis.
If smart is not configured: raise variant one step (e.g., default+high instead of smart+medium).

<oracle_escalation_flow>
Escalation sequence for same unresolved issue:
1. default + medium -> 2. smart + medium -> 3. smart + max.
MUST change model or variant at each step. If smart unavailable, escalate variant instead: default+medium -> default+high -> default+max.
</oracle_escalation_flow>

<good_example>
User: "Trace why this retry counter drifts."
Action: \`delegate_subagent(agent: "oracle", prompt: "...", model: "${oracleDefault}", variant: "medium", mode: "blocking")\`
<reasoning>Default starting point. If oracle identifies security implications, escalate per scenario table.</reasoning>
</good_example>
</oracle_model_and_variant_selection>`;
}

const INLINE_PROMPT_MAP_ENTRIES: readonly PromptMapEntry[] = [
  {
    key: 'first_gate',
    summary:
      'first-pass routing gates and precedence for initial specialist selection',
    inline: true,
  },
  {
    key: 'agents',
    summary:
      'currently available subagents and delegate-when guidance; only use agents listed there',
    inline: true,
  },
  {
    key: 'subagent_model_roster',
    summary: 'configured per-agent model roster when present',
    inline: true,
  },
] as const;

const ORCHESTRATOR_PROMPT_SECTIONS: readonly OrchestratorPromptSectionDefinition[] =
  [
    {
      section: 'planning_gate',
      summary: 'approval boundary before implementation',
      useWhen:
        'Use when you need the exact user-approval and plan-presentation rules before implementation.',
      render: () => PLANNING_GATE_BLOCK,
    },
    {
      section: 'mechanical_edit_exception',
      summary: 'full criteria for direct @fixer-first routing',
      useWhen:
        'Use when deciding whether a task is truly mechanical enough to bypass @oracle.',
      render: () => MECHANICAL_EDIT_EXCEPTION_BLOCK,
    },
    {
      section: 'steward_protocol',
      summary:
        'repo-rule citation workflow that runs before code-affecting work',
      useWhen:
        'Use when you need the exact blocking @steward protocol and downstream citation requirements.',
      render: () => buildStewardOrchestratorProtocolBlock().trim(),
    },
    {
      section: 'interpreter_protocol',
      summary: 'image and screenshot routing rules',
      useWhen:
        'Use when the latest user message includes images or screenshots and routing is not obvious.',
      render: () => buildInterpreterOrchestratorProtocolBlock().trim(),
    },
    {
      section: 'routing_enforcement',
      summary: 'pre-@fixer evidence requirements and examples',
      useWhen:
        'Use before delegating to @fixer when you need the exact gating rules and good/bad routing examples.',
      render: () => ROUTING_ENFORCEMENT_BLOCK,
    },
    {
      section: 'early_discovery',
      summary: 'capability discovery rules before specialist delegation',
      useWhen:
        'Use when deciding whether to call discover_skills and discover_mcp_servers, and how to present the results.',
      render: () => EARLY_DISCOVERY_BLOCK,
    },
    {
      section: 'subagent_recovery',
      summary: 'resume and recovery flow for blocked or incomplete delegations',
      useWhen:
        'Use when a delegation returns <blocked>, <needs_user>, empty output, or insufficient implementation detail.',
      render: () => SUBAGENT_RECOVERY_BLOCK,
    },
    {
      section: 'verification',
      summary: 'validation requirements before reporting success',
      useWhen:
        'Use before finalizing a response so verification rules are applied consistently.',
      render: () => VERIFICATION_BLOCK,
    },
    {
      section: 'oracle_model_and_variant_selection',
      summary: 'oracle tier and depth matrix',
      useWhen:
        'Use when choosing the @oracle model and variant, especially for escalation or security-sensitive analysis.',
      render: (context) => buildOracleModelAndVariantSelectionBlock(context),
    },
    {
      section: 'output_format',
      summary: 'required final response schema',
      useWhen:
        'Use right before the final user response to match the required orchestrator output structure.',
      render: () => OUTPUT_FORMAT_BLOCK,
    },
    {
      section: 'communication',
      summary: 'user-facing communication rules',
      useWhen:
        'Use when shaping the final user-facing response or reporting live delegation progress.',
      render: () => COMMUNICATION_BLOCK,
    },
  ] as const;

export function getOrchestratorPromptSectionDefinitions(): readonly OrchestratorPromptSectionDefinition[] {
  return ORCHESTRATOR_PROMPT_SECTIONS;
}

export function buildOrchestratorPromptMapBlock(): string {
  const inlineLines = INLINE_PROMPT_MAP_ENTRIES.map(
    (entry) => `- ${entry.key}: ${entry.summary} (inline in this prompt)`,
  );
  const sectionLines = ORCHESTRATOR_PROMPT_SECTIONS.map(
    (entry) =>
      `- ${entry.section}: ${entry.summary}. Call \`get_orchestrator_prompt_section(section: "${entry.section}")\` when the inline prompt tells you to fetch it or when you need the detailed policy.`,
  );

  return `<prompt_map>
Fast lookup index — use the inline control surface first, then fetch detailed policy sections on demand:
${[...inlineLines, ...sectionLines].join('\n')}
</prompt_map>`;
}

export const ORCHESTRATOR_PROMPT_MAP_BLOCK = buildOrchestratorPromptMapBlock();

export function renderOrchestratorPromptSection(
  section: OrchestratorPromptSectionId,
  context?: PromptSectionContext,
): string {
  const definition = ORCHESTRATOR_PROMPT_SECTIONS.find(
    (entry) => entry.section === section,
  );
  if (!definition) {
    throw new Error(`Unknown orchestrator prompt section: ${section}`);
  }

  return [
    `section: ${definition.section}`,
    `use_when: ${definition.useWhen}`,
    '',
    definition.render(context),
  ].join('\n');
}
