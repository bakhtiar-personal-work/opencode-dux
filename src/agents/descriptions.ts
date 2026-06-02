/**
 * Centralized agent descriptions used by the orchestrator prompt,
 * SDK registration, and sidebar UI labels.
 */

// XML-formatted agent descriptions for the orchestrator delegation prompt
export const AGENT_DESCRIPTIONS: Record<string, string> = {
  explorer: `<agent name="@explorer">
- Role: codebase search specialist
- Delegate when: locate files, usages, symbols, tests, config links
- Do not use when: exact file is already known and must be read in full
</agent>`,
  librarian: `<agent name="@librarian">
- Role: external docs and API reference specialist
- Delegate when: library behavior, version details, official examples, upstream GitHub issues/PRs/releases
- Do not use when: pure language fundamentals or local code discovery
</agent>`,
  oracle: `<agent name="@oracle">
- Role: technical analysis and code review; uses orchestrator \`model\` + \`variant\` matrix
- Delegate when: debugging, bug fixes that need diagnosis, architecture, tradeoffs, risk, any review depth
- Do not use when: pure local discovery (@explorer) or docs-only (@librarian)
</agent>`,
  designer: `<agent name="@designer">
- Role: UI/UX specialist for ALL user-facing UI - new pages, existing component changes, layout updates, styling, visual polish, a11y
- Delegate when: ANY change to TSX/JSX files, components, pages, layouts, styling, or user-facing visual elements - BEFORE @oracle or @fixer
- Do not use when: backend-only, non-visual work, or pure logic changes (hooks/utils) that don't affect rendering
</agent>`,
  fixer: `<agent name="@fixer">
- Role: implementation specialist
- Delegate when: edits, tests, scoped commands-after gates in <first_gate> when applicable
- Do not use when: diagnosis, strategy, conventions, or UI design are still unresolved-delegate upward first
</agent>`,
  steward: `<agent name="@steward">
- Role: rules citation from steward_paths - verbatim excerpts only; does NOT analyze, evaluate, or compare rules
- Delegate when: repo conventions needed before oracle/fixer
- Do not use when: pure symbol search (@explorer); rules analysis (@oracle).
</agent>`,
  interpreter: `<agent name="@interpreter">
- Role: screenshot / attached-image analyst
- Delegate when: user message has images and task is not redesign-only
- Do not use when: redesign-only-use @designer; text-only prompts
</agent>`,
};

// Compact sidebar labels for the TUI agent list
export const AGENT_SIDEBAR_DESCRIPTIONS: Record<string, string> = {
  orchestrator: 'Orchestrates',
  explorer: 'File Search',
  librarian: 'Doc Search',
  oracle: 'Architecture',
  designer: 'Design',
  fixer: 'Implement',
  steward: 'Repo rules',
  interpreter: 'Vision',
};
