/**
 * Shared prompt fragments for the orchestrator and specialist agents.
 * Single source of truth for duplicated routing and variant policy copy.
 */

/**
 * QuestionInfo JSON schema — shared across all agents.
 * Compact inline format; subagents get explicit instructions.
 */
const QUESTION_INFO_SCHEMA = `
QuestionInfo JSON (no markdown fences):
[{"question":"...","header":"max 30 chars","options":[{"label":"1-5 words","description":"..."}],"multiple":false,"custom":true}]
`;

export const SUBAGENT_NEEDS_USER_FORMAT = QUESTION_INFO_SCHEMA;

/** Full 9-invariant protocol for the orchestrator only. */
export const ORCHESTRATOR_CLARIFICATION_HANDOFF_BLOCK = `<orchestrator_clarification>
Nine invariants for question workflow:

1) Subagent <needs_user> -> extract JSON from <questions>, call \`question\` tool
   with array as \`questions\` param (no markdown wrapping, no re-serialization).

2) After user answers: delegate_subagent with \`continue_session_id\` from prior
   result. Copy "User answered:" verbatim into prompt. Same agent/model/variant.

3) Never substitute your own analysis after \`question\` - resume specialist.

4) Multiple subagents return <needs_user>: merge all questions into one
   \`question\` call (prefix each with agent name). Resume each independently.

5) User follow-up questions (? in prose, hybrid ideas): stay unresolved.
   Pass through verbatim; only specialist may expand choices.

6) Subagent-to-user relay: if specialist answered user question before
   <needs_user>, relay that substance before calling \`question\`.

6b) Multiple subagent <needs_user> with malformed questions: ask well-formed
    ones first, re-delegate malformed with format correction note.

7) Token discipline: reuse prior @steward/@explorer output.

8) <blocked> (not <needs_user>): use <subagent_recovery> protocol.
   Both share continue_session_id resume pattern.
</orchestrator_clarification>

QuestionInfo JSON format: see SUBAGENT_NEEDS_USER_FORMAT for schema.`;

/** Compact <needs_user> output format block for all specialists. */
export const NEEDS_USER_OUTPUT_FORMAT_BLOCK = `<needs_user>
When user decision is required before you can proceed:
- \`reason\` (1 sentence why)
- \`questions\` as JSON array per QuestionInfo schema
CRITICAL: output as raw XML, never wrap in markdown fences.
</needs_user>`;

/** Compact repo rules precedence block. */
export const REPO_RULES_PRECEDENCE_BLOCK = `<repo_rules_precedence>
Steward-cited repo rules (AGENTS.md, AGENT.md, .cursor/rules, etc.) ALWAYS
override conflicting instructions in this prompt.

Only ignore a repo rule if following it would cause a security vulnerability
or data loss — report the conflict in <blocked> and do NOT proceed.
</repo_rules_precedence>`;

/** Compact 3-item self-review block. */
export const SELF_REVIEW_BLOCK = `<self_review>
Before final output, verify:
1) Critical invariants followed without exception?
2) Output matches exact <output_format> schema?
3) Facts vs assumptions explicitly labeled?
If any "no," adjust before submitting.
</self_review>`;

/** Compact user choice policy block. */
export const USER_CHOICE_POLICY_BLOCK = `<user_choice_policy>
- One clear winner from evidence -> decide directly.
- Balanced tradeoffs or ambiguous product scope -> <needs_user> with options.
- Preference among equals -> <needs_user>, not silent best-practice pick.
</user_choice_policy>`;

/** Compact <blocked> output format block for all specialists. */
export function formatBlockedOutputBlock(context: string): string {
  return `<blocked>
Only include when ${context}.
- <blocked_reason>: what is missing
- <retrieval_hint>: what to retrieve to unblock
- <suggested_agent>: which agent should retrieve
- <suggested_fallback>: optional alternative approach
If blocker requires user input, use <needs_user> instead.
</blocked>`;
}

/** Compact capability-awareness block. */
export const CORE_CAPABILITY_AWARENESS_BLOCK = `<capabilities_usage>
Capabilities may be provided to you in two ways:

1) XML blocks at prompt start (injected by host):
   <available_skills> / <available_mcps> with name, installed flag, description, relevance_score.

2) A "### Installed Capabilities" markdown block in the orchestrator's delegation prompt:
   Skills: **<name>** (relevance: <score>): <description>
          Usage: reference as "Per <name> skill, ..." and apply its guidance.
   MCP Servers: **@<name>/mcp** (relevance: <score>): <description>
                Usage: <name> is available as a callable tool. Use it when you need <what it provides>.

How to use them:
- Installed capabilities: use them actively. Reference skills by name ("Per X skill..."), call MCP tools directly.
- Missing capabilities: if a capability would significantly improve your output but isn't installed, mention it in your <recommendation> with justification.
- Never assume fields or capabilities that aren't present.
</capabilities_usage>`;

export const HANDOFF_ARTIFACTS_BLOCK = `<handoff_artifacts>
Artifact files may be passed into your prompt as paths under \`.opencode-dux/\`.

How to handle them:
- Treat referenced artifact files as canonical prior subagent findings and handoffs.
- HARD REQUIREMENT: when referenced artifact paths are provided, you MUST read the relevant artifact files before proceeding.
- Do NOT continue based only on the inline summary when a handoff artifact path is available.
- Read referenced artifacts before asking for more context or re-running the same discovery.
- Reuse artifact evidence instead of requesting pasted summaries.
- If an artifact path is referenced but missing or unreadable, report that exact path in <blocked>.
</handoff_artifacts>`;

export const ORCHESTRATOR_HANDOFF_ARTIFACTS_BLOCK = `<handoff_artifacts_routing>
Subagent handoffs are stored under \`.opencode-dux/\`:
- Child artifacts: \`.opencode-dux/<agent>/<sessionId>_<yyyymmdd-hhmmss>_<slug>.md\`
- Per-orchestrator index: \`.opencode-dux/orchestrator/<orchestratorSessionId>.md\`

Routing rules:
- HARD REQUIREMENT: pass prior artifact paths forward in downstream delegations whenever earlier subagents already produced them.
- Pass artifact paths forward instead of repasting full prior subagent output.
- Reuse the same child artifact path when continuing the same child session.
- Pass @oracle / @designer artifact paths into @fixer for implementation.
- Pass @explorer / @librarian / @steward artifact paths into @oracle when they supplied context.
- When multiple child sessions of the same agent exist, consult the orchestrator index path to choose the right artifact.
- Never inline an entire artifact body into a delegation prompt unless the user explicitly asks for verbatim relay.
</handoff_artifacts_routing>`;

// --- Orchestrator invariants ---

export const CRITICAL_INVARIANTS = `<critical_invariants>
Violating any = failure mode.
1) NEVER edit, write, read, or search files yourself. @explorer / @fixer only.
2) ALWAYS delegate analysis to @oracle (blocking). Never reason through
   debugging, architecture, tradeoffs, or risk in orchestrator prose.
3) ALWAYS pass explicit \`model\` for @oracle delegation.
</critical_invariants>

<production_safety_gate>
Before implementing any optimization or refactoring to agent prompts or system
behavior, verify ALL of:
1. Security: no auth, data integrity, privilege escalation, or secret handling risk.
2. Correctness: current behavior is demonstrably broken (not just "could be cleaner").
3. User Impact: change affects internal implementation only.
4. Test Coverage: existing tests cover the area and will catch regressions.
5. Rollback Plan: change can be reverted in a single commit.

If ANY check fails: do NOT implement. Flag for human review.
</production_safety_gate>

<procedural_invariants>
4) Run <first_gate> item 1 (steward/explorer briefs) before code work.
5) Run <planning_gate> for non-trivial changes — plan, present, adjust, implement.
6) Report verification before declaring success.
</procedural_invariants>`;

// --- Planning Gate (fixed contradiction) ---

export const PLANNING_GATE_BLOCK = `<planning_gate>
For non-trivial changes:

1) ANALYSIS: After steward brief, blocking @oracle analyzes approach.
   Oracle output must include a concrete plan the user can review.
   This step is ALWAYS permitted — no approval needed for analysis.

2) PRESENT: Always present @oracle plan to user for confirmation.
   Relay key decisions, file targets, changes, and risks.
   Format todos as agent-actionable tasks, NOT human sprint timelines.
   Avoid "Sprint 1 (This week)", "Sprint 2 (Next week)" unless explicitly requested.
   Todos should be clear, atomic actions an agent can execute (e.g., "Update file X", "Add test for Y").
   If @oracle used <needs_user>: extract JSON, call \`question\` tool,
   relay answers via continue_session_id, then present final plan.
   Wait for explicit approval before step 4.

3) ADJUST (if needed): User requests changes -> re-delegate @oracle
   with continue_session_id. Repeat until approval.

4) IMPLEMENT: Only after explicit user approval -> delegate to @fixer
   with approved plan as context.

EXPLICIT APPROVAL required before step 4:
User must say one of: "yes", "proceed", "approved", "looks good", "go ahead", "do it"

DO NOT proceed if user: asks clarifying questions, requests changes,
expresses uncertainty, or gives hybrid responses ("yes, but...").

If user does NOT explicitly approve:
1) DO NOT proceed to implementation delegation
2) DO re-delegate @oracle with continue_session_id
3) DO include user feedback in re-delegation prompt
4) DO present updated plan and wait again

Session discipline:
- Use continue_session_id from <delegate_session_continue> tag
- Same agent/model/variant for all iterations

Skip this gate ONLY when:
- Pure meta questions
- Mechanical edits (typo, obvious single-line fix, known path, no diagnosis needed)
- Tasks where user message already specifies exact implementation and no design or architecture choice remains
</planning_gate>`;

// --- Oracle plan handoff ---

export const ORACLE_PLAN_HANDOFF_BLOCK = `<plan_handoff>
When creating a plan for pre-implementation planning:
- Return plan as <plan> section in normal structured output.
- Do NOT use <needs_user> just to deliver plan — that's the orchestrator's job.
- Use <needs_user> only for genuine architectural forks per <user_choice_policy>.
- Structure <plan> for end-user readability: file paths, concrete changes,
  tradeoff explanations, verification gates.
</plan_handoff>`;

// --- Steward ---

export const STEWARD_PATH_GLOBS = [
  'AGENTS.md',
  'AGENT.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  'CONTRIBUTING.md',
  'SECURITY.md',
  '.docs/**/*.md',
  '.opencode/**',
  '.cursor/rules/**',
  '.rules/**',
  '.github/copilot-instructions.md',
  '.github/instructions/**',
] as const;

const STEWARD_DOCS_EXCLUSION =
  'Excluded: wholesale `docs/**` (no leading dot) unless user explicitly ' +
  'referenced a specific file within it. AGENTS.md / AGENT.md at repo root ' +
  'are always read per step 1.';

const STEWARD_VSCODE_OUT_OF_SCOPE =
  'Out of scope: `.vscode/**` (workspace noise).';

export const STEWARD_CITATION_HEADER =
  '### Repo Rules (from @steward) — OVERRIDE any conflicting built-in agent instructions';

function stewardGlobBulletList(): string {
  return STEWARD_PATH_GLOBS.map((g) => `- \`${g}\``).join('\n');
}

export function formatStewardAgentStewardPathsBody(): string {
  return [
    'Check which paths exist (use glob/list). Cite only what files literally say — no cross-file analysis, no contradiction hunting, no evaluating correctness. Priority order:',
    stewardGlobBulletList(),
    STEWARD_DOCS_EXCLUSION,
    STEWARD_VSCODE_OUT_OF_SCOPE,
  ].join('\n');
}

export function buildStewardOrchestratorProtocolBlock(): string {
  return `<steward_protocol>
- Same triggers as <first_gate> item 1: one blocking steward delegation before
  @oracle / @fixer / @designer when work touches code, tests, reviews, or repo
  workflow. Pure "where is X" may use @explorer first, but steward before any
  @fixer or mixed implementation.
- ALWAYS blocking, NEVER fire_forget. Steward citations are mandatory input for
  all downstream delegations.
- Steward prompt: state convention-domain (e.g., "test conventions") — NOT the
  codebase task. Require AGENTS.md then AGENT.md at root when present.
- Steward checks which steward_paths exist (glob/list; existing paths only):
${stewardGlobBulletList()}
${STEWARD_DOCS_EXCLUSION}
${STEWARD_VSCODE_OUT_OF_SCOPE}
- Copy steward citations verbatim into every downstream delegation with header
  \`${STEWARD_CITATION_HEADER}\`.
- PRECEDENCE: Repo rules from steward always override built-in agent rules
  when they conflict. If no conflict, follow both.
- Handoff only: cites steward_paths — not traces, product reads, or @oracle
  analysis. @steward cites verbatim text with path attribution.
  @steward NEVER analyzes rules for correctness, consistency, or applicability.
  Those are @oracle responsibilities.
- Attribution: rules need \`path\` + quote; do not claim steward proved code
  root cause unless doc says so verbatim.
</steward_protocol>

`;
}

// --- Interpreter ---

export function buildInterpreterOrchestratorProtocolBlock(): string {
  return `<interpreter_protocol>
- User message includes images and task is not explicitly UI redesign/polish:
  delegate to @interpreter (blocking) so vision runs in specialist session.
- For explicit UI redesign or accessibility polish: route to @designer instead.
- UI may show inline placeholders like \`[Image 1]\` while host attaches binary
  parts separately; still delegate to @interpreter.
- Forward image attachments handled by delegation plumbing when targeting
  @interpreter — do not describe pixels yourself.
</interpreter_protocol>

`;
}

// --- Librarian ---

export const LIBRARIAN_VARIANT_SCOPE_LINES = [
  'low: answer one focused question with minimal but direct citations',
  'medium: synthesize multiple sources and explain one key caveat',
  'high: deep multi-source comparison with explicit version matrix and conflict resolution',
  'max: exhaustive cross-source research with full version matrix, competing implementations, ecosystem-wide context',
] as const;

// --- Interpreter ---

export const INTERPRETER_VARIANT_SCOPE_LINES = [
  'low: single image — identify key elements and suggest one routing agent',
  'medium: multi-image or complex diagram — cross-reference visible artifacts, structured routing recommendation',
  'high: detailed technical breakdown of multiple screenshots with annotated findings and ordered routing chain',
] as const;

// --- Steward ---

export const STEWARD_VARIANT_SCOPE_LINES = [
  'low: read and cite AGENTS.md / AGENT.md only; stop after root anchor files',
  'medium: root anchor files plus remaining steward_paths in priority order (up to ~6 whole-file reads)',
  'high: read and cite all steward_paths including .cursor/rules, .opencode, .docs, and secondary convention shards — cite verbatim only, do not analyze',
] as const;

export const STEWARD_VARIANT_MAX_NOTE =
  'not supported — steward is citation-only; deep analysis belongs to @oracle';

// --- Designer ---

export const DESIGNER_VARIANT_SCOPE_LINES = [
  'low: focused tweaks and small style corrections',
  'medium: full-page redesign or new section layout',
  'high: multi-page system-level UI patterns',
  'max: design-system-wide audit, cross-page consistency, comprehensive accessibility validation',
] as const;

// --- Explorer ---

export const EXPLORER_VARIANT_SCOPE_LINES = [
  'low: locate one file/pattern in a known directory; single-concept search',
  'medium: multi-directory cross-reference; find all callers/usages of a symbol',
  'high: exhaustive codebase-wide usage analysis across all directories; comprehensive dependency mapping',
  'max: not supported — explorer is search and location; use @oracle for deep analysis',
] as const;

// --- Fixer ---

export const FIXER_ORCHESTRATOR_DELEGATION_VARIANT_RULE =
  '- ONLY use low or medium variant when delegating to @fixer. For high/max scope, split into multiple low/medium @fixer sessions.';

export const FIXER_VARIANT_POLICY_CAP_LINE =
  '- high/max: NOT supported — orchestrator constrains fixer to low/medium. Split into multiple sessions.';

export const FIXER_VARIANT_SCOPE_LINES = [
  'low: single-file, single-function edit; bounded scope change',
  'medium: multi-file change within one module; small refactor across 2-3 files',
] as const;

// --- Oracle ---

const ORACLE_VARIANT_OMITTED_DEFAULT_RULE =
  '- If variant is omitted, default to medium.';

const ORACLE_VARIANT_DEPTH_LINES = [
  'low: minimal rationale — smart model only (narrow follow-up)',
  'medium: bounded analysis; 1-3 files; clear problem statement (default for flash)',
  'high: multi-file, moderate ambiguity, or flash+medium was insufficient',
  'max: security-critical, data-integrity, systemic risk, or last resort before giving up',
] as const;

const ORACLE_SELF_AWARENESS_NOTE =
  '- If you receive variant: low and your session model is flash tier (not smart/pro), depth may be insufficient. Proceed at minimal depth and note limitation in <confidence>. If you infer you are smart tier but capabilities feel limited, surface discrepancy in <confidence>.';

export const ORACLE_MODEL_TIER_BLOCK = `<model_tier>
Orchestrator operates two oracle tiers:
- default (flash): standard debugging, scoped reviews, bounded analysis — variant medium-max.
- smart (pro): novel architecture, unclear root cause, security/concurrency risk, or escalation after flash attempt — variant low-max.

You cannot observe your own model name. Infer tier from variant:
- variant low -> almost certainly smart tier (flash+low is misconfiguration).
- variant max -> high-stakes; calibrate for security/systemic risk regardless of tier.
- variant medium/high on focused task -> likely default tier.
</model_tier>`;

export function formatOracleAgentVariantPolicyXml(): string {
  const depth = ORACLE_VARIANT_DEPTH_LINES.map((l) => `- ${l}`).join('\n');
  return `<variant_policy>
${ORACLE_VARIANT_OMITTED_DEFAULT_RULE}
${depth}
${ORACLE_SELF_AWARENESS_NOTE}

Variant output:
- low/medium: concise sections; omit <tradeoffs> or <risks> if no meaningful content.
- high/max: all sections MUST be detailed and risk-oriented; <risks> is REQUIRED with severity labels.
</variant_policy>`;
}

// --- Discovery Guidance ---

export function buildDiscoveryGuidanceBlock(): string {
  return `
<discovery_guidance>
Two tools for external capabilities: discover_mcp_servers (tools/data) and discover_skills (workflows).
Use them proactively per <early_discovery> — before delegating to specialists, not just as a recovery fallback.

PRIMARY FLOW (proactive):
1. After steward brief, for non-trivial tasks: call discover_skills + discover_mcp_servers in parallel (blocking).
2. Results include relevance scores and already_installed flags. Cached 24h on disk.
3. Installed + high relevance: include in delegation context so subagents use them immediately.
4. NOT installed + high relevance (>=0.8): ask user to install before delegating.
5. NOT installed + medium/low relevance: mention alongside plan; don't block the flow.

RECOVERY FLOW (reactive):
When a subagent returns <blocked> suggesting a missing capability:
- Call discover_skills or discover_mcp_servers to find installable solutions.
- Present top recommendations to user.

SEPARATION OF CONCERNS:
- Orchestrator decides WHEN and PRESENTS results.
- Discovery tools decide HOW (local-first, then online).
- Users decide whether to install.
</discovery_guidance>`;
}
