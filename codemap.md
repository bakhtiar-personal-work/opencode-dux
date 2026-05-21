# Repository Atlas: opencode-dux

## Project Responsibility

`opencode-dux` is an OpenCode plugin for agent orchestration, management, and operations. Its core job is to:

- define orchestrator and specialist agents,
- load layered plugin configuration and per-agent permissions,
- expose additional tools and MCP integrations,
- manage delegated/resumable session orchestration,
- inject workflow-enforcement hooks plus runtime command handlers,
- track API usage and manage subscriptions/account keys,
- discover and install OpenCode skills and MCP servers,
- ship a bootstrap CLI.

This codemap intentionally covers the plugin repository itself and excludes the nested `opencode/` upstream checkout.

## System Entry Points

| Path | Role |
|---|---|
| `package.json` | Package manifest, dependency graph, release scripts, published file list. |
| `src/index.ts` | Main plugin bootstrap: wires agents, tools, MCPs, hooks, session managers, session tracking, preset managers, task-session tracking, config merge behavior, and startup summary logging. |
| `src/cli/index.ts` | CLI entrypoint for installation/bootstrap workflows. |
| `src/config/schema.ts` | Source-of-truth runtime config schema used by validation and schema generation. |
| `scripts/generate-schema.ts` | Generates `opencode-dux.schema.json` from the Zod config schema. |

## Repository Directory Map

| Directory | Responsibility Summary | Detailed Map |
|---|---|---|
| `src/` | Main application surface that composes plugin bootstrap, runtime model chains, hook orchestration, task-session aliasing, and installer-facing code. | `src/index.ts`, `src/tui.ts`, `src/tui-state.ts` |
| `src/agents/` | Agent factory layer for orchestrator and specialists, including prompt/model overrides, display-name normalization, MCP assignment, and permission shaping. | No sub-codemap |
| `src/cli/` | Installer, config editing, and provider preset generation. | No sub-codemap |
| `src/config/` | Configuration schema, layered loaders, preset merging, compatibility migrations, constant tables, and agent/MCP policy helpers. | No sub-codemap |
| `src/discovery/` | Online discovery tools for finding OpenCode skills (`discover_skills_online`) and MCP servers (`discover_mcp_servers`) from remote sources. | No sub-codemap |
| `src/hooks/` | Aggregated runtime hook surface for prompt transforms, recovery logic, task-session aliasing, nudges, and lifecycle policies. | No sub-codemap |
| `src/hooks/apply-patch/` | Structured `apply_patch` parsing, matching, recovery, and rewrite pipeline. | No sub-codemap |
| `src/hooks/auto-update-checker/` | Startup update detection, cache handling, and optional install prompt flow. | No sub-codemap |
| `src/hooks/context-pressure-reminder/` | Context window pressure warnings when approaching token limits. | No sub-codemap |
| `src/hooks/delegate-task-retry/` | Post-tool retry guidance for failed delegation attempts. | No sub-codemap |
| `src/hooks/filter-available-skills/` | Skill-visibility filtering based on agent permission policy. | No sub-codemap |
| `src/hooks/json-error-recovery/` | JSON/tool-output recovery helpers for malformed model responses. | No sub-codemap |
| `src/hooks/phase-reminder/` | Message-transform reminder enforcing orchestrator workflow phases. | No sub-codemap |
| `src/hooks/post-file-tool-nudge/` | Post-read/write reminder path that nudges delegation-aware next steps. | No sub-codemap |
| `src/hooks/task-session-manager/` | Resumable `task` session tracking, short alias resolution, prompt injection, and stale-session cleanup. | No sub-codemap |
| `src/hooks/todo-continuation/` | Auto-continue behavior for outstanding todo execution. | No sub-codemap |
| `src/mcp/` | Built-in MCP registry and per-provider MCP definitions (websearch, context7, grep_app). | No sub-codemap |
| `src/subscriptions/` | API key management, account tracking, and usage monitoring for LLM provider subscriptions. | No sub-codemap |
| `src/tools/` | Tool and runtime-command export surface for AST-grep, smartfetch, preset switching, and webfetch. | No sub-codemap |
| `src/tools/ast-grep/` | AST-grep binary management and AST-aware search/replace tool flow. | No sub-codemap |
| `src/tools/smartfetch/` | Fetch/extract/cache pipeline for web content and secondary-model summarization. | No sub-codemap |
| `src/utils/` | Cross-cutting helpers for logging, session metadata, resumable task aliases, system-message normalization, subagent depth tracking, environment, and runtime operations. | No sub-codemap |
| `scripts/` | Build/release validation and generated-artifact maintenance scripts. | [View Map](scripts/codemap.md) |

## Runtime Control Flow

1. **Plugin startup**
   - OpenCode loads `src/index.ts`.
   - Config is loaded and normalized through `src/config/`.
   - Agent definitions are produced by `src/agents/`.
   - Tool factories from `src/tools/`, discovery tools from `src/discovery/`, and MCP definitions from `src/mcp/` are registered.
   - Hooks from `src/hooks/` are attached.
   - Subscription/usage tracking via `src/subscriptions/` is initialized.
   - Startup summary logs available MCPs.

2. **Interactive request handling**
   - The orchestrator prompt drives routing decisions.
   - Tool calls resolve through `src/tools/` or built-in OpenCode tools.
   - Hooks can transform prompts/messages, normalize system message arrays, repair tool failures, or intercept runtime commands before/after execution.

3. **Delegated execution**
   - OpenCode child sessions are created by delegation flows and tracked by plugin utilities.
   - `src/hooks/task-session-manager/` remembers reusable child sessions and injects short aliases into the orchestrator prompt.
   - Results flow back into the parent session through notifications/output polling.

4. **Online discovery**
   - `src/discovery/` implements `discover_skills_online` and `discover_mcp_servers` tools for finding and installing community skills/MCPs at runtime.

5. **Install/release path**
   - `src/cli/` configures host OpenCode instances.
   - `scripts/` validates generated schema, package completeness, and host-load behavior.

## Key Cross-Module Integration Points

- `src/index.ts` is the central composition root for nearly every runtime subsystem.
- `src/config/` feeds `src/agents/`, session/delegation utilities, and MCP registration.
- `src/cli/custom-skills.ts` bridges install-time skill packaging with runtime permission policy.
- `src/tools/preset-manager.ts` hooks command execution and updates runtime agent models from configured presets.
- `src/hooks/task-session-manager/` depends on `src/utils/session-manager.ts` and `src/utils/task.ts` to support child-session reuse.
- `src/hooks/filter-available-skills/` and agent permission logic rely on shared skill names from the CLI/config layer.
- `src/subscriptions/` hooks into plugin command/event surfaces exposed by `src/index.ts` for account and usage management.
- `src/discovery/` provides online tools consumed by the orchestrator agent for discovering skills and MCPs at runtime.

## Root Assets

- `README.md`: user-facing product overview, install docs, and agent descriptions.
- `biome.json`: formatting/lint policy.
- `tsconfig.json`: TypeScript compiler settings.
- `opencode-dux.schema.json`: generated JSON Schema from `src/config/schema.ts`.
- `.slim/codemap.json`: codemap change-detection state for this repository.

## Recommended Reading Order

1. `codemap.md`
2. `scripts/codemap.md`
3. Based on task:
   - **Agent system** → `src/agents/`
   - **Configuration** → `src/config/`
   - **Tools** → `src/tools/`
   - **Hooks** → `src/hooks/`
   - **CLI/install** → `src/cli/`
   - **Discovery** → `src/discovery/`
   - **Subscriptions/usage** → `src/subscriptions/`
