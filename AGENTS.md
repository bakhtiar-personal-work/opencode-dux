# opencode-dux — Agent instructions

## Commands

```bash
bun run build          # clean → build:plugin + build:cli → tsc declarations → generate-schema
bun run build:plugin   # bundles src/index.ts + src/tui.ts → dist/
bun run build:cli      # bundles src/cli/index.ts → dist/cli/
bun test               # bun's built-in test runner (test root = src/ per bunfig.toml)
bun run typecheck      # tsc --noEmit
bun run lint           # biome lint .
bun run check          # biome check --write .  (lint + format + organize imports)
bun run check:ci       # biome check .  (read-only, for CI)
bun run format         # biome format . --write
bun run generate-schema  # regenerate opencode-dux.schema.json from Zod schema
bun run verify:release   # path-scan + pack + smoke test
bun run verify:host-smoke  # boot isolated OpenCode host with plugin tarball
```

## Architecture

- **Plugin entrypoint**: `src/index.ts` exports a `Plugin` factory function. Loaded by OpenCode at startup.
- **CLI entrypoint**: `src/cli/index.ts` (`bunx opencode-dux install`).
- **Config schema**: `src/config/schema.ts` — Zod `PluginConfigSchema` → generates `opencode-dux.schema.json` via `scripts/generate-schema.ts`. The JSON schema is NOT hand-written; always run `bun run generate-schema` after changing the Zod schema.
- **Toolchain**: Bun 1.3.x runtime, Biome for lint/format (no ESLint/Prettier), TypeScript for typecheck only (Bun handles bundling).

## Project structure

- `src/agents/` — Agent definitions + prompt builders (orchestrator, oracle, explorer, etc.)
- `src/cli/` — Installer CLI, config editing, provider presets
- `src/config/` — Schema, loader, preset merging, constants
- `src/discovery/` — Online skill & MCP server discovery tools
- `src/hooks/` — OpenCode lifecycle hooks (patch, update checker, phase reminder, etc.)
- `src/mcp/` — Built-in MCP definitions (websearch, context7, grep_app)
- `src/skills/` — Bundled skills (codemap, simplify), unpacked on install
- `src/subscriptions/` — API key storage, account management, usage tracking
- `src/tools/` — Extra tools (ast-grep, webfetch, preset manager)
- `src/utils/` — Logging, session management, depth tracking, system collapse
- `src/tui.ts` + `src/tui-state.ts` — TUI integration point: session tree mirroring, multiplexer polling, usage display

## Key behaviors

- The plugin factory function can **re-run** after `Instance.dispose()`. Module-level `didLogVerboseInit` / `didLogStartupSummary` flags prevent duplicate startup logs.
- `src/skills/registry.ts` exports `discoverSkills` — caches results by plugin root.
- `src/tools/ast-grep/downloader.ts` downloads binaries to `~/.cache/opencode-dux/` on first use.
- `src/mcp/index.ts` — builtin MCPs are defined here; any can be disabled via config `disabledMcps`.
- JSON Schema is **generated** — edits to `opencode-dux.schema.json` are overwritten by `bun run generate-schema`. Edit `src/config/schema.ts` instead.

## External dependencies (NOT bundled, kept external at build time)

- `@opencode-ai/plugin` / `@opencode-ai/sdk` — OpenCode plugin SDK
- `@ast-grep/napi` — ast-grep native, resolves at runtime
- `jsdom` — webfetch HTML parsing
- `zod` — config validation
- `@opentui/solid` — optional TUI rendering

## Testing

- `bun test` runs all `**/*.test.ts` under `src/`.
- No jest/vitest — bun has its own test runner with `describe`, `it`, `expect`.
- Mock strategy: most tests use hand-written mocks (not `vi.mock`); see `src/config/loader.test.ts` for pattern.
- Codemap test (`src/skills/codemap/scripts/codemap.test.ts`) is the most expensive suite.
