/**
 * Shared prompt fragments for the orchestrator and specialist agents.
 * Single source of truth for duplicated routing and variant policy copy.
 */
/**
 * Specialist-safe version: just the QuestionInfo JSON schema so subagents
 * can format their <needs_user> questions correctly.
 */
export declare const SUBAGENT_NEEDS_USER_FORMAT = "\nQuestionInfo JSON format (use double-quoted JSON, NO markdown code fences):\n[\n  {\n    \"question\": \"Complete question text\",\n    \"header\": \"Short label (max 30 chars)\",\n    \"options\": [\n      {\"label\": \"Option text (1-5 words)\", \"description\": \"What this choice means\"},\n      {\"label\": \"Option 2 (1-5 words)\", \"description\": \"What this choice means\"}\n    ],\n    \"multiple\": false,\n    \"custom\": true\n  }\n]\nRequired fields: question, header, options (array of {label, description})\nOptional: multiple (default false), custom (default true)\n";
/**
 * Full 9-invariant protocol for the orchestrator only.
 * Describes how to handle the question/q&a workflow when subagents
 * return <needs_user>.
 */
export declare const ORCHESTRATOR_CLARIFICATION_HANDOFF = "<orchestrator_clarification>\nNine invariants for question/q&a workflow:\n\n1) Subagent <needs_user> \u2192 extract the JSON array from their\n   `<questions>` block, then call the `question` tool with that\n   array as the `questions` parameter. Pass the JSON as-is\n   (no markdown wrapping, no re-serialization).\n   Never paste options as chat text - that bypasses the picker UI.\n\n   Extraction: the `<questions>...</questions>` content inside the\n   subagent's `<needs_user>` block is a JSON array. Parse it and\n   pass it directly to the `question` tool's `questions` parameter.\n   If the subagent returned prose or XML instead of JSON, re-delegate\n   with `continue_session_id` and the note: \"Reformat <needs_user>\n   questions as JSON per the QuestionInfo schema.\"\n\n2) After user answers: delegate_subagent with `continue_session_id`\n   from the prior result tag. Copy \"User answered:\" verbatim into\n   prompt. Same agent, model, variant as prior delegation.\n\n3) Never substitute your own analysis after `question` - resume the\n   specialist, don't replace them.\n\n4) Multiple subagents return <needs_user> in one round: merge all\n   questions into one `question` call (prefix each with agent name).\n   Resume each with its own `continue_session_id`.\n\n5) User follow-up questions (? in prose, hybrid ideas, new patterns):\n   stay unresolved. Pass through verbatim; only the specialist may\n   expand choices via another <needs_user> round.\n\n6) Subagent-to-user relay: if the specialist answered a user question\n   (definitions, teaching) before <needs_user>, relay that substance\n   before calling `question` so the picker is not orphaned.\n\n6b) If multiple subagents return <needs_user> and any has malformed\n    questions, ask only the well-formed ones first. Re-delegate the\n    malformed one with format correction note.\n\n7) Token discipline: reuse prior @steward/@explorer output; don't\n   re-delegate before resume unless scope widens.\n\n8) When a subagent returns <blocked> (not <needs_user>), use the\n   <subagent_recovery> protocol instead. Both <blocked> and\n   <needs_user> share the same continue_session_id resume pattern:\n   retrieve missing info first, then re-delegate to the same session.\n</orchestrator_clarification>\n\n\nQuestionInfo JSON format (use double-quoted JSON, NO markdown code fences):\n[\n  {\n    \"question\": \"Complete question text\",\n    \"header\": \"Short label (max 30 chars)\",\n    \"options\": [\n      {\"label\": \"Option text (1-5 words)\", \"description\": \"What this choice means\"},\n      {\"label\": \"Option 2 (1-5 words)\", \"description\": \"What this choice means\"}\n    ],\n    \"multiple\": false,\n    \"custom\": true\n  }\n]\nRequired fields: question, header, options (array of {label, description})\nOptional: multiple (default false), custom (default true)\n";
/**
 * Shared `<needs_user>` output format for all specialist agents.
 * Contains the scaffolding XML block without agent-specific examples.
 */
export declare const NEEDS_USER_OUTPUT_FORMAT_BLOCK = "<needs_user>\nWhen the user must decide before you can proceed, output:\n- `reason` (1 sentence why the user must decide)\n- `questions` as a JSON array of QuestionInfo objects (see schema above).\n\nCRITICAL: Output `<needs_user>` as raw XML. NEVER wrap it in markdown code fences (```).\n</needs_user>";
export declare const REPO_RULES_PRECEDENCE_BLOCK = "<repo_rules_precedence>\nWhen the orchestrator provides steward citations (repo rules from AGENTS.md,\nAGENT.md, .cursor/rules, etc.), those rules ALWAYS override any conflicting\ninstructions in this prompt. Repo rules are authoritative.\n\nOnly ignore a repo rule if following it would cause a security vulnerability\nor data loss - in that case, report the conflict in your output (use <blocked> if the conflict prevents safe continuation) and do NOT proceed.\n</repo_rules_precedence>";
export declare const SELF_REVIEW_BLOCK = "<self_review>\nBefore producing your final output, verify against these criteria:\n1) Have I followed my <critical_invariants> without exception?\n2) Does my output match the exact format in <output_format>?\n3) Have I included all required sections and omitted optional ones correctly?\n4) If my task was delegated by the orchestrator, did I answer the EXACT\n   question asked (not an adjacent reformulation)?\n5) Is my confidence calibrated - do I distinguish confirmed facts from\n   inferences and explicitly label each?\nIf any answer is \"no,\" adjust your output before submitting.\n</self_review>";
export declare const USER_CHOICE_POLICY_BLOCK = "<user_choice_policy>\nWhen facing a fork where no single option is clearly correct from the\nprovided context:\n- Tradeoffs balanced \u2192 <needs_user> with options describing what each\n  choice optimizes for and gives up.\n- Product scope unclear (who is this for, failure tolerance) \u2192 <needs_user>.\n- One clear winner from evidence \u2192 state it without asking.\n- Preference among equals \u2192 <needs_user>, not a silent \"best practice\" pick.\n</user_choice_policy>";
/**
 * Shared `<blocked>` output format block for all specialist agents.
 * Takes a context string describing when to include the blocked section.
 */
export declare function formatBlockedOutputBlock(context: string): string;
/**
 * Absolute rules the orchestrator must never violate.
 * Violating any = failure mode.
 */
export declare const CRITICAL_INVARIANTS = "<critical_invariants>\nThese are HARD FAILURES. Violating any = broken delegation.\n1) NEVER edit, write, read, or search files yourself. @explorer / @fixer only.\n2) ALWAYS delegate analysis to @oracle (blocking). Never reason through\n   debugging, architecture, tradeoffs, or risk in orchestrator prose.\n3) ALWAYS pass explicit `model` for @oracle delegation.\n</critical_invariants>\n\n<production_safety_gate>\nBefore implementing any optimization, refactoring, or \"improvement\" to agent\nprompts or system behavior, verify ALL of the following:\n\n1. **Security**: No security implications (auth, data integrity, privilege\n   escalation, input validation, secret handling)\n2. **Correctness**: Current behavior is demonstrably broken or produces wrong\n   outputs (not just \"could be cleaner\")\n3. **User Impact**: Change affects internal implementation only - no breaking\n   changes to user-facing behavior without explicit approval\n4. **Test Coverage**: Existing tests cover the affected area AND will catch\n   regressions\n5. **Rollback Plan**: Change can be reverted in a single commit if issues arise\n\n**If ANY check fails**: Do NOT implement. Flag for human review instead.\n\n**Philosophy**: \"If it's good enough for production, leave it alone.\" Only fix\nwhat's actually broken, not what could theoretically be cleaner.\n</production_safety_gate>\n\n<procedural_invariants>\nThese ensure quality. Violating = incomplete work.\n4) Run <first_gate> item 1 (steward/explorer briefs) before code work.\n5) Run <planning_gate> for non-trivial changes - plan, present, adjust,\n   implement. Never skip user confirmation.\n6) Report verification before declaring success.\n</procedural_invariants>";
/**
 * Planning gate workflow for non-trivial changes.
 * Introduces plan → present → adjust → implement cycle.
 */
export declare const PLANNING_GATE_BLOCK = "<planning_gate>\nWhen the user requests non-trivial changes (anything beyond pure meta or\nmechanical edits), follow this cycle:\n\n1) ANALYSIS: After steward brief (per <first_gate> item 1 and\n   <procedural_invariants> item 4), blocking @oracle analyzes the\n   technical approach (no implementation).\n   Oracle output must include a concrete plan section the user can review.\n2) PRESENT: Always present the @oracle plan to the user for confirmation.\n   This step is MANDATORY \u2014 never skip it for any non-trivial change.\n   - If @oracle used <needs_user> with questions: extract JSON, call `question` tool, relay answers back via continue_session_id, then present the final plan.\n   - Otherwise: relay the plan's key decisions, file paths, and risks as text.\n   - Ask the user to confirm or request adjustments before proceeding.\n   Wait for explicit user approval before step 4.\n3) ADJUST (if needed): User requests changes \u2192 re-delegate @oracle with\n   `continue_session_id` (same session, incremental). Repeat until approval.\n4) IMPLEMENT: Only after explicit user approval \u2192 delegate to @fixer with\n   the approved plan as context.\n\nSkip this gate ONLY when:\n- Pure meta questions (\"what agents exist?\")\n- Mechanical edits (typo, single-line fix, known path)\n- Tasks where the user's message already specifies the exact implementation\n  (e.g., \"rename getCwd to getCurrentWorkingDir in src/utils/fs.ts\")\n</planning_gate>";
/**
 * Plan handoff block for oracle's pre-implementation planning mode.
 * Instructs oracle to structure plans for end-user readability and avoid
 * using <needs_user> just to deliver a plan.
 */
export declare const ORACLE_PLAN_HANDOFF_BLOCK = "<plan_handoff>\nWhen creating a plan for pre-implementation planning (the orchestrator\ndelegates with \"for pre-implementation planning\"):\n- Return the plan as normal structured output with <plan>...</plan> section.\n  The orchestrator will present this plan to the user for confirmation.\n- Do NOT use <needs_user> just to deliver the plan \u2014 plan presentation is\n  the orchestrator's job, not the oracle's.\n- Use <needs_user> only for genuine architectural forks where your analysis\n  cannot select a single best approach (per <user_choice_policy>).\n- Structure the <plan> section for END-USER readability, not implementer\n  notes: clear file paths, concrete change descriptions, tradeoff\n  explanations, and verification gates. The user will read this to decide\n  whether to proceed.\n</plan_handoff>";
/** Ordered discovery roots documented for prompts and tests. */
export declare const STEWARD_PATH_GLOBS: readonly ["AGENTS.md", "AGENT.md", "CLAUDE.md", "GEMINI.md", ".cursorrules", "CONTRIBUTING.md", "SECURITY.md", ".docs/**/*.md", ".opencode/**", ".cursor/rules/**", ".rules/**", ".github/copilot-instructions.md", ".github/instructions/**"];
export declare const STEWARD_DOCS_EXCLUSION: string;
export declare const STEWARD_VSCODE_OUT_OF_SCOPE = "Out of scope: `.vscode/**` (workspace noise).";
/** Header inserted before steward-cited rules in downstream delegations. */
export declare const STEWARD_CITATION_HEADER = "### Repo Rules (from @steward) - OVERRIDE any conflicting built-in agent instructions";
/** Inner body for the steward agent `<steward_paths>` section. */
export declare function formatStewardAgentStewardPathsBody(): string;
export declare function buildStewardOrchestratorProtocolBlock(): string;
export declare function buildInterpreterOrchestratorProtocolBlock(): string;
export declare const LIBRARIAN_VARIANT_SCOPE_LINES: readonly ["low: answer one focused question with minimal but direct citations", "medium: synthesize multiple sources and explain one key caveat", string, string];
export declare const INTERPRETER_VARIANT_SCOPE_LINES: readonly ["low: single image - identify key elements and suggest one routing agent", string, string];
export declare const STEWARD_VARIANT_SCOPE_LINES: readonly ["low: read and cite AGENTS.md / AGENT.md only; stop after root anchor files", string, string];
export declare const STEWARD_VARIANT_MAX_NOTE = "not supported \u2014 steward is citation-only; deep analysis belongs to @oracle";
export declare const DESIGNER_VARIANT_SCOPE_LINES: readonly ["low: focused tweaks and small style corrections", "medium: full-page redesign or new section layout", "high: multi-page system-level UI patterns", string];
export declare const EXPLORER_VARIANT_SCOPE_LINES: readonly ["low: locate one file/pattern in a known directory; single-concept search", "medium: multi-directory cross-reference; find all callers/usages of a symbol", string, string];
/** Orchestrator `<constraints>` line for @fixer variant caps. */
export declare const FIXER_ORCHESTRATOR_DELEGATION_VARIANT_RULE: string;
/** Specialist variant_policy cap line (orchestrator must not send high/max). */
export declare const FIXER_VARIANT_POLICY_CAP_LINE: string;
export declare const FIXER_VARIANT_SCOPE_LINES: readonly ["low: single-file, single-function edit; bounded scope change", "medium: multi-file change within one module; small refactor across 2-3 files"];
export declare const ORACLE_VARIANT_OMITTED_DEFAULT_RULE = "- If variant is omitted by the caller, default to medium.";
/** Depth labels: shared between orchestrator routing and oracle specialist. */
export declare const ORACLE_VARIANT_DEPTH_LINES: readonly [string, string, "high: multi-file, moderate ambiguity, or flash+medium was incomplete", string];
export declare const ORACLE_SELF_AWARENESS_NOTE: string;
/**
 * Model-tier context block injected into oracle\'s own prompt.
 * Explains when each tier is used so oracle can calibrate confidence and depth.
 */
export declare const ORACLE_MODEL_TIER_BLOCK = "<model_tier>\nThe orchestrator operates two oracle tiers and selects one before delegating:\n- default (flash): standard debugging, scoped reviews, bounded analysis, no security impact - expects variant medium-max.\n- smart (pro): novel architecture, unclear root cause, cross-framework subtlety, security/concurrency risk, or escalation after a flash attempt was wrong or low-confidence - supports variant low-max.\n\nDeciding factors the orchestrator uses to pick the tier:\n1. Security or data-integrity risk \u2192 always smart.\n2. Novel/unclear root cause, concurrency, cross-framework subtlety \u2192 smart.\n3. Prior flash result was wrong or explicitly low-confidence \u2192 escalate to smart.\n4. Standard scoped debugging or review with no ambiguity \u2192 default.\n\nYou cannot observe your own model name. Infer your likely tier from the variant received:\n- variant low \u2192 you are almost certainly the smart tier (flash + low is a misconfiguration).\n- variant max \u2192 high-stakes task; calibrate for security/systemic risk regardless of tier.\n- variant medium/high on a focused task \u2192 likely default tier; proceed at appropriate depth.\n</model_tier>";
export declare function formatOracleAgentVariantPolicyXml(): string;
export declare function formatOrchestratorOracleVariantDepthSection(): string;
export declare function buildVariantGlossaryBlock(): string;
/**
 * Consolidated variant guide table for the orchestrator prompt.
 * Replaces 6 separate variant guide sections with a single table.
 * Includes shorter labels with detailed glossary below.
 */
export declare function buildConsolidatedVariantGuide(): string;
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
export declare function buildDiscoveryGuidanceBlock(): string;
