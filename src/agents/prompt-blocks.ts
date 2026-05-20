/**
 * Shared prompt fragments for the orchestrator and specialist agents.
 * Single source of truth for duplicated routing and variant policy copy.
 */

/**
 * Subagents use `<needs_user>`; orchestrator runs host `question` once and re-delegates.
 * Shape matches OpenCode SDK `QuestionRequest.questions` / `QuestionInfo` (see
 * `@opencode-ai/sdk` v2 types: `QuestionInfo`, `QuestionOption`).
 */
const QUESTION_INFO_SCHEMA = `
QuestionInfo JSON format (use double-quoted JSON, NO markdown code fences):
[
  {
    "question": "Complete question text",
    "header": "Short label (max 30 chars)",
    "options": [
      {"label": "Option text (1-5 words)", "description": "What this choice means"},
      {"label": "Option 2 (1-5 words)", "description": "What this choice means"}
    ],
    "multiple": false,
    "custom": true
  }
]
Required fields: question, header, options (array of {label, description})
Optional: multiple (default false), custom (default true)
`;

/**
 * Specialist-safe version: just the QuestionInfo JSON schema so subagents
 * can format their <needs_user> questions correctly.
 */
export const SUBAGENT_NEEDS_USER_FORMAT = QUESTION_INFO_SCHEMA;

/**
 * Full 9-invariant protocol for the orchestrator only.
 * Describes how to handle the question/q&a workflow when subagents
 * return <needs_user>.
 */
export const ORCHESTRATOR_CLARIFICATION_HANDOFF = `<orchestrator_clarification>
Nine invariants for question/q&a workflow:

1) Subagent <needs_user> → extract the JSON array from their
   \`<questions>\` block, then call the \`question\` tool with that
   array as the \`questions\` parameter. Pass the JSON as-is
   (no markdown wrapping, no re-serialization).
   Never paste options as chat text - that bypasses the picker UI.

   Extraction: the \`<questions>...</questions>\` content inside the
   subagent's \`<needs_user>\` block is a JSON array. Parse it and
   pass it directly to the \`question\` tool's \`questions\` parameter.
   If the subagent returned prose or XML instead of JSON, re-delegate
   with \`continue_session_id\` and the note: "Reformat <needs_user>
   questions as JSON per the QuestionInfo schema."

2) After user answers: delegate_subagent with \`continue_session_id\`
   from the prior result tag. Copy "User answered:" verbatim into
   prompt. Same agent, model, variant as prior delegation.

3) Never substitute your own analysis after \`question\` - resume the
   specialist, don't replace them.

4) Multiple subagents return <needs_user> in one round: merge all
   questions into one \`question\` call (prefix each with agent name).
   Resume each with its own \`continue_session_id\`.

5) User follow-up questions (? in prose, hybrid ideas, new patterns):
   stay unresolved. Pass through verbatim; only the specialist may
   expand choices via another <needs_user> round.

6) Subagent-to-user relay: if the specialist answered a user question
   (definitions, teaching) before <needs_user>, relay that substance
   before calling \`question\` so the picker is not orphaned.

6b) If multiple subagents return <needs_user> and any has malformed
    questions, ask only the well-formed ones first. Re-delegate the
    malformed one with format correction note.

7) Token discipline: reuse prior @steward/@explorer output; don't
   re-delegate before resume unless scope widens.

8) When a subagent returns <blocked> (not <needs_user>), use the
   <subagent_recovery> protocol instead. Both <blocked> and
   <needs_user> share the same continue_session_id resume pattern:
   retrieve missing info first, then re-delegate to the same session.
</orchestrator_clarification>

${QUESTION_INFO_SCHEMA}`;

/**
 * Shared `<needs_user>` output format for all specialist agents.
 * Contains the scaffolding XML block without agent-specific examples.
 */
export const NEEDS_USER_OUTPUT_FORMAT_BLOCK = `<needs_user>
When the user must decide before you can proceed, output:
- \`reason\` (1 sentence why the user must decide)
- \`questions\` as a JSON array of QuestionInfo objects (see schema above).

CRITICAL: Output \`<needs_user>\` as raw XML. NEVER wrap it in markdown code fences (\`\`\`).
</needs_user>`;

// New: Standardized repo rules precedence block for all subagents
export const REPO_RULES_PRECEDENCE_BLOCK = `<repo_rules_precedence>
When the orchestrator provides steward citations (repo rules from AGENTS.md,
AGENT.md, .cursor/rules, etc.), those rules ALWAYS override any conflicting
instructions in this prompt. Repo rules are authoritative.

Only ignore a repo rule if following it would cause a security vulnerability
or data loss - in that case, report the conflict in your output (use <blocked> if the conflict prevents safe continuation) and do NOT proceed.
</repo_rules_precedence>`;

// New: Standardized self-review metacognition block
export const SELF_REVIEW_BLOCK = `<self_review>
Before producing your final output, verify against these criteria:
1) Have I followed my <critical_invariants> without exception?
2) Does my output match the exact format in <output_format>?
3) Have I included all required sections and omitted optional ones correctly?
4) If my task was delegated by the orchestrator, did I answer the EXACT
   question asked (not an adjacent reformulation)?
5) Is my confidence calibrated - do I distinguish confirmed facts from
   inferences and explicitly label each?
If any answer is "no," adjust your output before submitting.
</self_review>`;

// New: Standardized user choice policy block
export const USER_CHOICE_POLICY_BLOCK = `<user_choice_policy>
When facing a fork where no single option is clearly correct from the
provided context:
- Tradeoffs balanced → <needs_user> with options describing what each
  choice optimizes for and gives up.
- Product scope unclear (who is this for, failure tolerance) → <needs_user>.
- One clear winner from evidence → state it without asking.
- Preference among equals → <needs_user>, not a silent "best practice" pick.
</user_choice_policy>`;

/**
 * Shared `<blocked>` output format block for all specialist agents.
 * Takes a context string describing when to include the blocked section.
 */
export function formatBlockedOutputBlock(context: string): string {
  return `<blocked>
Only include when ${context}.
Structure for recovery:
- <blocked_reason>: 1-2 sentences explaining what is missing or failed.
- <retrieval_hint>: Concrete instructions for what the orchestrator or another agent should retrieve to unblock this task.
- <suggested_agent>: Which agent should retrieve this (explorer, librarian, oracle, designer, steward).
- <suggested_fallback>: Optional alternative approach if the primary tool/source is unavailable.
- If the blocker is a missing tool that has NO fallback, state that explicitly.
- If the blocker requires user input rather than retrieval, use <needs_user> instead of <blocked>.
</blocked>`;
}

// --- Orchestrator invariants ---

/**
 * Absolute rules the orchestrator must never violate.
 * Violating any = failure mode.
 */
export const CRITICAL_INVARIANTS = `<critical_invariants>
These are HARD FAILURES. Violating any = broken delegation.
1) NEVER edit, write, read, or search files yourself. @explorer / @fixer only.
2) ALWAYS delegate analysis to @oracle (blocking). Never reason through
   debugging, architecture, tradeoffs, or risk in orchestrator prose.
3) ALWAYS pass explicit \`model\` for @oracle delegation.
</critical_invariants>

<production_safety_gate>
Before implementing any optimization, refactoring, or "improvement" to agent
prompts or system behavior, verify ALL of the following:

1. **Security**: No security implications (auth, data integrity, privilege
   escalation, input validation, secret handling)
2. **Correctness**: Current behavior is demonstrably broken or produces wrong
   outputs (not just "could be cleaner")
3. **User Impact**: Change affects internal implementation only - no breaking
   changes to user-facing behavior without explicit approval
4. **Test Coverage**: Existing tests cover the affected area AND will catch
   regressions
5. **Rollback Plan**: Change can be reverted in a single commit if issues arise

**If ANY check fails**: Do NOT implement. Flag for human review instead.

**Philosophy**: "If it's good enough for production, leave it alone." Only fix
what's actually broken, not what could theoretically be cleaner.
</production_safety_gate>

<procedural_invariants>
These ensure quality. Violating = incomplete work.
4) Run <first_gate> item 1 (steward/explorer briefs) before code work.
5) Run <planning_gate> for non-trivial changes - plan, present, adjust,
   implement. Never skip user confirmation.
6) Report verification before declaring success.
</procedural_invariants>`;

/**
 * Planning gate workflow for non-trivial changes.
 * Introduces plan → present → adjust → implement cycle.
 */
export const PLANNING_GATE_BLOCK = `<planning_gate>
When the user requests non-trivial changes (anything beyond pure meta or
mechanical edits), follow this cycle:

1) ANALYSIS: After steward brief (per <first_gate> item 1 and
   <procedural_invariants> item 4), blocking @oracle analyzes the
   technical approach (no implementation).
   Oracle output must include a concrete plan section the user can review.
2) PRESENT: Always present the @oracle plan to the user for confirmation.
   This step is MANDATORY — never skip it for any non-trivial change.
   - If @oracle used <needs_user> with questions: extract JSON, call \`question\` tool, relay answers back via continue_session_id, then present the final plan.
   - Otherwise: relay the plan's key decisions, file paths, and risks as text.
   - Ask the user to confirm or request adjustments before proceeding.
   Wait for explicit user approval before step 4.
3) ADJUST (if needed): User requests changes → re-delegate @oracle with
   \`continue_session_id\` (same session, incremental). Repeat until approval.
4) IMPLEMENT: Only after explicit user approval → delegate to @fixer with
   the approved plan as context.

Skip this gate ONLY when:
- Pure meta questions ("what agents exist?")
- Mechanical edits (typo, single-line fix, known path)
- Tasks where the user's message already specifies the exact implementation
  (e.g., "rename getCwd to getCurrentWorkingDir in src/utils/fs.ts")
</planning_gate>`;

/**
 * Plan handoff block for oracle's pre-implementation planning mode.
 * Instructs oracle to structure plans for end-user readability and avoid
 * using <needs_user> just to deliver a plan.
 */
export const ORACLE_PLAN_HANDOFF_BLOCK = `<plan_handoff>
When creating a plan for pre-implementation planning (the orchestrator
delegates with "for pre-implementation planning"):
- Return the plan as normal structured output with <plan>...</plan> section.
  The orchestrator will present this plan to the user for confirmation.
- Do NOT use <needs_user> just to deliver the plan — plan presentation is
  the orchestrator's job, not the oracle's.
- Use <needs_user> only for genuine architectural forks where your analysis
  cannot select a single best approach (per <user_choice_policy>).
- Structure the <plan> section for END-USER readability, not implementer
  notes: clear file paths, concrete change descriptions, tradeoff
  explanations, and verification gates. The user will read this to decide
  whether to proceed.
</plan_handoff>`;

// --- Steward ---

/** Ordered discovery roots documented for prompts and tests. */
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

export const STEWARD_DOCS_EXCLUSION =
  'Excluded: wholesale `docs/**` (no leading dot) unless the ' +
  'user explicitly referenced a specific file within it. ' +
  '(`AGENTS.md` / `AGENT.md` at repo root are always read per step 1.)';

export const STEWARD_VSCODE_OUT_OF_SCOPE =
  'Out of scope: `.vscode/**` (workspace noise).';

/** Header inserted before steward-cited rules in downstream delegations. */
export const STEWARD_CITATION_HEADER =
  '### Repo Rules (from @steward) - OVERRIDE any conflicting built-in agent instructions';

function stewardGlobBulletList(): string {
  return STEWARD_PATH_GLOBS.map((g) => `- \`${g}\``).join('\n');
}

/** Inner body for the steward agent `<steward_paths>` section. */
export function formatStewardAgentStewardPathsBody(): string {
  return [
    'Check which paths exist (use glob/list tools). You cite only what these files literally say — no cross-file analysis, no contradiction hunting, no evaluating correctness. Priority order for reading:',
    stewardGlobBulletList(),
    STEWARD_DOCS_EXCLUSION,
    STEWARD_VSCODE_OUT_OF_SCOPE,
  ].join('\n');
}

export function buildStewardOrchestratorProtocolBlock(): string {
  return `<steward_protocol>
- Same triggers as <first_gate> item 1: one blocking \`delegate_subagent(agent: "steward", ...)\` before @oracle / @fixer / @designer when work touches code, tests, reviews, or repo workflow; pure "where is X" may use @explorer first, but @steward before any @fixer (or mixed implementation).
- **ALWAYS blocking. NEVER fire_forget.** Steward citations are mandatory input for ALL downstream delegations (@oracle, @fixer, @designer). Parallelizing steward with any other agent violates the sequential dependency chain: steward → oracle → fixer. Even in recovery flows (see <subagent_recovery>), steward delegations must be blocking.
In practice, this means the orchestrator MUST issue @steward as the sole tool call in its turn and wait for the result before issuing any other delegate_subagent calls in a subsequent turn.
 - Steward prompt: State the convention-domain (e.g., "test conventions", "code style rules", "commit conventions") — NOT the codebase task (e.g., "fix retry logic"). Require \`AGENTS.md\` then \`AGENT.md\` at root when present, then other steward_paths — no vague "check rules" delegations.
- Steward checks which steward_paths exist (glob/list; existing paths only). Priority order:
// Note: Steward paths list appears in both steward and orchestrator prompts by design.
// Each agent needs its own context - this is not code duplication.
${stewardGlobBulletList()}
${STEWARD_DOCS_EXCLUSION}
${STEWARD_VSCODE_OUT_OF_SCOPE}
- Convention-domain keywords + hints in prompt; cited bullets only. Copy steward citations verbatim into every downstream delegation (@oracle, @fixer, @designer) with the header \`${STEWARD_CITATION_HEADER}\`.
- PRECEDENCE: Repo rules cited by @steward (AGENTS.md, AGENT.md, .cursor/rules, etc.) ALWAYS override built-in agent prompt rules when they conflict. If a repo rule says "skip tests for docs" and a built-in rule says "always run tests," the repo rule wins. If they don't conflict, follow both.
- Handoff only: cites steward_paths — not traces, product reads, @explorer search, or @oracle analysis. @steward cites verbatim text from steward_paths files with path attribution. @steward NEVER analyzes rules for correctness, consistency, contradictions, gaps, or applicability to specific code changes. Those tasks are @oracle's responsibility.
- Attribution: Rules need \`path\` + quote; do not claim steward *proved* code root cause unless the doc says so verbatim-@explorer / @oracle own diagnosis otherwise.
</steward_protocol>

`;
}

// --- Interpreter ---

export function buildInterpreterOrchestratorProtocolBlock(): string {
  return `<interpreter_protocol>
- When the user message includes images (including pasted screenshots / clipboard) and the task is not explicitly UI redesign/polish, delegate first to \`delegate_subagent(agent: "interpreter", ...)\` (blocking) so vision runs in the specialist session.
- For explicit UI redesign, accessibility polish, or design-system work, route to @designer instead (may still use @interpreter earlier only if the screenshot context is ambiguous).
- The UI may show inline placeholders like \`[Image 1]\` or "img clipboard" while the host attaches binary parts separately-you often cannot see pixels yourself on a text-only orchestrator model; still delegate to @interpreter instead of asking the user to "attach again." If delegation errors about missing parts, treat it as an attachment/host pipeline issue-not users forgetting the image.
- Forward image attachments are handled by delegation plumbing when targeting @interpreter-do not describe pixels yourself in place of @interpreter.
</interpreter_protocol>

`;
}

// --- Librarian ---

export const LIBRARIAN_VARIANT_SCOPE_LINES = [
  'low: answer one focused question with minimal but direct citations',
  'medium: synthesize multiple sources and explain one key caveat',
  'high: provide deep multi-source comparison with explicit version ' +
    'matrix and conflict resolution',
  'max: exhaustive cross-source research with full version matrix, ' +
    'competing implementations, and ecosystem-wide context',
] as const;

// --- Interpreter ---

export const INTERPRETER_VARIANT_SCOPE_LINES = [
  'low: single image - identify key elements and suggest one routing agent',
  'medium: multi-image or complex diagram - cross-reference visible artifacts ' +
    'and produce a structured routing recommendation',
  'high: detailed technical breakdown of multiple screenshots or diagrams with ' +
    'annotated findings and ordered routing chain',
] as const;

// --- Steward ---

export const STEWARD_VARIANT_SCOPE_LINES = [
  'low: read and cite AGENTS.md / AGENT.md only; stop after root anchor files',
  'medium: root anchor files plus remaining steward_paths in priority order ' +
    '(up to ~6 whole-file reads)',
  'high: read and cite all steward_paths including .cursor/rules, ' +
    '.opencode, .docs, and any secondary convention shards — cite verbatim only, do not analyze',
] as const;

export const STEWARD_VARIANT_MAX_NOTE =
  'not supported — steward is citation-only; deep analysis belongs to @oracle';

// --- Designer ---

export const DESIGNER_VARIANT_SCOPE_LINES = [
  'low: focused tweaks and small style corrections',
  'medium: full-page redesign or new section layout',
  'high: multi-page system-level UI patterns',
  'max: design-system-wide audit, cross-page consistency, and ' +
    'comprehensive accessibility validation',
] as const;

// --- Explorer ---

export const EXPLORER_VARIANT_SCOPE_LINES = [
  'low: locate one file/pattern in a known directory; single-concept search',
  'medium: multi-directory cross-reference; find all callers/usages of a symbol',
  'high: exhaustive codebase-wide usage analysis across all directories; ' +
    'comprehensive dependency mapping (round cap does not apply; state coverage upfront)',
  'max: not supported - explorer is a search and location agent; ' +
    'use @oracle for deep analysis of discovered results',
] as const;

// --- Fixer ---

/** Orchestrator `<constraints>` line for @fixer variant caps. */
export const FIXER_ORCHESTRATOR_DELEGATION_VARIANT_RULE =
  '- ONLY use low or medium variant when delegating to @fixer. For high/max ' +
  'scope, split into multiple low/medium @fixer sessions.';

/** Specialist variant_policy cap line (orchestrator must not send high/max). */
export const FIXER_VARIANT_POLICY_CAP_LINE =
  '- high/max: NOT supported - the orchestrator constrains fixer to low/medium. ' +
  'If high/max scope is needed, split into multiple low/medium fixer sessions.';

export const FIXER_VARIANT_SCOPE_LINES = [
  'low: single-file, single-function edit; bounded scope change',
  'medium: multi-file change within one module; small refactor across 2-3 files',
] as const;

// --- Oracle ---

export const ORACLE_VARIANT_OMITTED_DEFAULT_RULE =
  '- If variant is omitted by the caller, default to medium.';

/** Depth labels: shared between orchestrator routing and oracle specialist. */
export const ORACLE_VARIANT_DEPTH_LINES = [
  'low: minimal rationale - smart model only (narrow follow-up once ' +
    'smart is warranted)',
  'medium: bounded analysis; 1-3 files; clear problem statement (minimum ' +
    'depth for default/flash)',
  'high: multi-file, moderate ambiguity, or flash+medium was incomplete',
  'max: security-critical, data-integrity, systemic risk, or last resort ' +
    'before giving up',
] as const;

export const ORACLE_SELF_AWARENESS_NOTE =
  '- If you receive `variant: low` and your session model is a standard/flash ' +
  'tier (not the smart/pro tier configured by the orchestrator), the depth may ' +
  'be insufficient. Proceed at minimal depth and note the limitation in ' +
  '`<confidence>` rather than refusing or stalling. If you infer you are the ' +
  'smart tier but your capabilities feel limited for the task, surface that ' +
  'discrepancy in `<confidence>` as well.';

/**
 * Model-tier context block injected into oracle\'s own prompt.
 * Explains when each tier is used so oracle can calibrate confidence and depth.
 */
export const ORACLE_MODEL_TIER_BLOCK = `<model_tier>
The orchestrator operates two oracle tiers and selects one before delegating:
- default (flash): standard debugging, scoped reviews, bounded analysis, no security impact - expects variant medium-max.
- smart (pro): novel architecture, unclear root cause, cross-framework subtlety, security/concurrency risk, or escalation after a flash attempt was wrong or low-confidence - supports variant low-max.

Deciding factors the orchestrator uses to pick the tier:
1. Security or data-integrity risk → always smart.
2. Novel/unclear root cause, concurrency, cross-framework subtlety → smart.
3. Prior flash result was wrong or explicitly low-confidence → escalate to smart.
4. Standard scoped debugging or review with no ambiguity → default.

You cannot observe your own model name. Infer your likely tier from the variant received:
- variant low → you are almost certainly the smart tier (flash + low is a misconfiguration).
- variant max → high-stakes task; calibrate for security/systemic risk regardless of tier.
- variant medium/high on a focused task → likely default tier; proceed at appropriate depth.
</model_tier>`;

export function formatOracleAgentVariantPolicyXml(): string {
  const depth = ORACLE_VARIANT_DEPTH_LINES.map((l) => `- ${l}`).join('\n');
  return `<variant_policy>
${ORACLE_VARIANT_OMITTED_DEFAULT_RULE}
${depth}
${ORACLE_SELF_AWARENESS_NOTE}

Variant output:
- low: keep <tradeoffs>, <risks>, and <confidence> concise.
- medium: keep all sections but limit alternatives to one; omit placeholder bullets-skip a subsection entirely if it would add no real content.
- high/max: all sections must be detailed and risk-oriented, with clear severity labels for risks.
</variant_policy>`;
}

export function formatOrchestratorOracleVariantDepthSection(): string {
  const lines = ORACLE_VARIANT_DEPTH_LINES.map((l) => `- ${l}`).join('\n');
  return `VARIANT (depth):\n${lines}`;
}

export function buildVariantGlossaryBlock(): string {
  return `<variant_glossary>
**Oracle variants:**
- low: minimal rationale (smart model only)
- medium: bounded analysis (1-3 files)
- high: multi-file or moderate ambiguity
- max: security-critical or systemic risk

**Fixer variants:**
- low: single-file, single-function edit
- medium: multi-file change within one module

**Note:** For @fixer work exceeding medium scope, split into multiple low/medium sessions.
</variant_glossary>`;
}

/**
 * Consolidated variant guide table for the orchestrator prompt.
 * Replaces 6 separate variant guide sections with a single table.
 * Includes shorter labels with detailed glossary below.
 */
export function buildConsolidatedVariantGuide(): string {
  return `<variant_guide>
| Agent | low | medium | high | max |
|-------|-----|--------|------|-----|
| @explorer | low: locate | medium: cross-ref | high: exhaustive | not supported |
| @librarian | low: focused | medium: synthesize | high: deep comparison | max: exhaustive |
| @oracle | low: minimal rationale | medium: bounded | high: comprehensive | max: critical risk |
| @designer | low: tweaks | medium: redesign | high: multi-page | max: audit |
| @fixer | low: single-file | medium: multi-file | not supported | not supported |
| @steward | low: anchor files | medium: steward paths | high: all paths | ${STEWARD_VARIANT_MAX_NOTE} |
| @interpreter | low: single image | medium: multi-image | high: breakdown | not supported |
</variant_guide>

For @fixer work exceeding medium scope, split into multiple low/medium sessions.

${buildVariantGlossaryBlock()}`;
}

/**
 * Build XML block with guidance on when and how to use the
 * `discover_mcp_servers` and `discover_skills_online` tools.
 *
 * MCP servers are capability/tool resources that provide new functions.
 * Skills are knowledge/prompt resources that provide specialized workflows.
 * Never conflate the two.
 *
 * The orchestrator calls these tools when a subagent outputs `<blocked>` due to
 * missing capabilities, or when the user explicitly asks for tool/skill
 * recommendations. Returns recommendations that the orchestrator presents to
 * the user.
 */
export function buildDiscoveryGuidanceBlock(): string {
  return `<discovery_guidance>
When a subagent returns <blocked> because it lacks the capabilities to complete
a task, you have two recovery options:
1. Work around the missing capability (use a different tool or approach)
2. Discover and recommend installable MCP servers or skills that provide the
   needed capability via the discovery tools

IMPORTANT SCOPE: Discovery tools are ONLY for AGENT capabilities and
knowledge — NOT for project dependencies.
- MCP servers = agent capabilities (tools the AI can call to do things)
- Skills = agent knowledge (prompt instructions that teach workflows)
- Project dependencies = what your code imports or references at
  runtime (language libraries, framework packages, runtime deps) — NOT
  for discovery tools

<tool_selection>
- Use \`discover_mcp_servers\` when you need tool/capability resources
  (external service automation, data source access, API integrations,
  file system operations, etc.)
- Use \`discover_skills_online\` when you need knowledge/prompt resources
  (specialized workflows, domain expertise, task-specific guidance, etc.)
</tool_selection>

Call \`discover_mcp_servers\` when:
- A subagent reports missing capabilities via <blocked> (e.g. "browser
  automation unavailable", "database MCP not configured")
- The user explicitly asks for an MCP server or tool recommendation
- You need to find external tool resources for a specific domain

Call \`discover_skills_online\` when:
- The user explicitly asks for a skill recommendation
- You need task-specific knowledge, prompts, or workflows
- A subagent needs specialized guidance for a particular domain

<correct_vs_incorrect>
✅ DO call discovery tools for:
  - External service automation MCP (API integrations, app automation)
  - Data source connector MCP (databases, storage, data platforms)
  - Platform API MCP (GitHub, GitLab, cloud services)
  - Design tool MCP (design asset access, visual workflows)
  - Web search / documentation MCP
  - Domain knowledge skill (best practices, specialized workflows)

❌ DON'T call discovery tools for:
  - Language libraries (charting, UI frameworks, utilities — project
    dependencies)
  - Framework packages (runtimes, SDKs, build tools — project
    dependencies)
  - Runtime dependencies (database drivers, HTTP clients, package
    managers — project dependencies)
  - Any package used in \`import\` or \`require\` statements

Project dependencies are installed by @fixer during implementation
using the project's package manager (npm, pip, nuget, cargo, etc.).
Discovery tools find AGENT capabilities, not PROJECT dependencies.
</correct_vs_incorrect>

Both tools return a JSON array of recommendations with relevance scores,
install commands, and suggested agents. Present the top 1-3 recommendations
to the user and ask if they would like to install any.

<auto_filtering>
Both tools automatically filter out already-installed MCPs/skills
from recommendations. If the user already has a matching MCP or skill
installed, it will only appear in the output when its relevance_score
is > 0.8 (significantly better for the current task), and it will be
marked with 'already_installed: true' so you know the user already has it.
Otherwise, already-installed items are silently excluded to avoid
recommending something the user already has.

When calling either tool, pass the 'existing_mcp_names' or
'existing_skill_names' parameter with the list of installed names
obtained via getLocalDiscovery() to enable this filtering.
</auto_filtering>

<scope_clarification>
- MCP servers/Skills = AGENT tooling (what AI can do/know)
- Project dependencies = what your code imports (language libraries,
  framework packages, runtime dependencies)

@fixer installs project dependencies during implementation verification.
Discovery tools find AGENT capabilities, not PROJECT dependencies.

Project dependencies (e.g., language libraries, framework packages,
runtime deps) are installed by @fixer during implementation using the
project's package manager. Discovery tools are for finding MCP servers
(agent capabilities) and Skills (agent knowledge) — NOT project
dependencies.
</scope_clarification>

<heuristics_table>
| Task signal detected in <blocked>               | Tool to use          | Likely recommendation(s)                         |
|--------------------------------------------------|----------------------|---------------------------------------------------|
| External service automation, API integration     | discover_mcp_servers | Automation/connector MCPs                        |
| Data source access, storage queries              | discover_mcp_servers | Data source connector MCPs                       |
| Repository operations, PR/issue management       | discover_mcp_servers | Platform API MCPs                                |
| File system operations, file read/write          | discover_mcp_servers | Filesystem MCP                                   |
| Web search, internet research, API docs          | discover_mcp_servers | Web search / documentation MCPs                  |
| Code search, grep-like operations                | discover_mcp_servers | Code search MCPs                                 |
| Communication (messaging platforms)              | discover_mcp_servers | Messaging platform MCPs                          |
| Project management (issue tracking, boards)      | discover_mcp_servers | Project management MCPs                          |
| Design tools, visual asset management            | discover_mcp_servers | Design tool MCPs                                 |
| Error monitoring, crash reporting                | discover_mcp_servers | Observability MCPs                               |
| Payments, billing, subscriptions                 | discover_mcp_servers | Payment platform MCPs                            |
| Documentation, knowledge base, wiki              | discover_mcp_servers | Knowledge base MCPs                              |
| Domain-specific knowledge, best practices        | discover_skills_online | Specialized workflow/domain knowledge skills    |
| Specialized workflows for a particular task      | discover_skills_online | Task-specific workflow skills                   |
| Package/import resolution, dependency install    | ⚠️ NOT for discovery | @fixer via project package manager              |
</heuristics_table>

<example>
Subagent returns: \`<blocked>\`External API access needed - I need to
interact with a third-party service but no connector is available.
<suggested_agent>explorer</suggested_agent>
\`</blocked>\`

Orchestrator action:
1. Call \`discover_mcp_servers(task_description: "External API integration
   for third-party service access", task_keywords: ["api", "integration",
   "connector", "service"], agent_name: "explorer")\`
2. Get recommendations including a service connector MCP
3. Present to user: "To enable external API access, you can install a
   service connector MCP server. Would you like me to search for
   available options?"
</example>

  `;
}
