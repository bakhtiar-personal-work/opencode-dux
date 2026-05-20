# opencode-dux

Agent orchestration, management, and operations plugin for OpenCode. Routes tasks to specialized agents automatically.

## Quick Start

1. Add to `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json`:

```json
{ "plugin": ["opencode-dux"] }
```

2. Create `~/.config/opencode/opencode-dux.jsonc`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/bakhtiar-personal-work/opencode-dux/master/opencode-dux.schema.json",
  "preset": "default",
  "presets": {
    "default": {
      "orchestrator": { "model": "opencode-go/deepseek-v4-flash" },
      "oracle": { "model": "opencode-go/deepseek-v4-flash" },
      "explorer": { "model": "opencode-go/deepseek-v4-flash" },
      "librarian": { "model": "opencode-go/deepseek-v4-flash" },
      "designer": { "model": "opencode-go/mimo-v2.5-pro" },
      "fixer": { "model": "opencode-go/deepseek-v4-flash" }
    }
  }
}
```

3. Authenticate: `opencode auth login`

Or run the installer: `bunx opencode-dux install`

## Agents

| Agent            | Role                 | When Used                                             |
| ---------------- | -------------------- | ----------------------------------------------------- |
| **Orchestrator** | Master delegator     | Routes tasks, strategic coordination                  |
| **Explorer**     | Codebase search      | File discovery, pattern matching                      |
| **Oracle**       | Architecture & debug | Trade-offs, root cause analysis                       |
| **Librarian**    | External research    | Documentation lookup, web search                      |
| **Designer**     | UI/UX                | Frontend, styling, accessibility                      |
| **Fixer**        | Implementation       | Scoped code changes, tests                            |
| **Steward**      | Repository rules     | Manages `.docs/`, `.opencode/`, `.cursor/rules`, etc. |
| **Interpreter**  | Image analysis       | Vision-capable model for attached screenshots         |

## Configuration

Config file: `~/.config/opencode/opencode-dux.jsonc`

Merged from two locations (project overrides user):

| Location    | Path                                     |
| ----------- | ---------------------------------------- |
| **User**    | `~/.config/opencode/opencode-dux.jsonc`  |
| **Project** | `<project>/.opencode/opencode-dux.jsonc` |

### Config options

| Field                                | Type       | Default | Description                                   |
| ------------------------------------ | ---------- | ------- | --------------------------------------------- |
| `preset`                             | `string`   | -       | Active preset name                            |
| `presets`                            | `object`   | `{}`    | Named model configurations per agent          |
| `agents`                             | `object`   | `{}`    | Per-agent overrides on top of active preset   |
| `fallback.enabled`                   | `boolean`  | `true`  | Enable runtime model fallback on API errors   |
| `fallback.chains`                    | `object`   | `{}`    | Ordered fallback model arrays per agent       |
| `sessionManager.maxSessionsPerAgent` | `number`   | `2`     | Max concurrent sessions per agent type (1–10) |
| `sessionManager.readContextMinLines` | `number`   | `10`    | Min lines threshold for read context tool     |
| `sessionManager.readContextMaxFiles` | `number`   | `8`     | Max files per read context batch              |
| `todoContinuation.maxContinuations`  | `number`   | `5`     | Max consecutive auto-continuations (1–50)     |
| `todoContinuation.autoEnable`        | `boolean`  | `false` | Auto-enable when enough todos exist           |
| `contextPressure.enabled`            | `boolean`  | `true`  | Warn when context usage is high               |
| `contextPressure.warnThresholdPct`   | `number`   | `75`    | Trigger at this context usage % (1–99)        |
| `websearch.provider`                 | `string`   | `"exa"` | `"exa"` or `"tavily"`                         |
| `setDefaultAgent`                    | `boolean`  | `true`  | Sets default_agent to `orchestrator`          |
| `autoUpdate`                         | `boolean`  | `true`  | Auto-update when loaded via npm name          |
| `disabledMcps`                       | `string[]` | `[]`    | Disable built-in MCPs by name                 |

### Per-agent options

| Field         | Type                   | Description                                       |
| ------------- | ---------------------- | ------------------------------------------------- |
| `model`       | `string` or `array`    | Model ID (`provider/model`) or array for fallback |
| `temperature` | `number` (0–2)         | Model temperature                                 |
| `variant`     | `string`               | Variant hint (e.g. `"pro"`, `"flash"`)            |
| `options`     | `object`               | Provider-specific model options                   |
| `displayName` | `string`               | Custom agent display name                         |
| `skills`      | `object` or `string[]` | Skill access configuration                        |
| `mcps`        | `object` or `string[]` | MCP access configuration                          |

### Model as array

```jsonc
{
  "orchestrator": {
    "model": [
      "neuralwatt/moonshotai/Kimi-K2.6",
      { "id": "opencode-go/deepseek-v4-flash", "variant": "high" },
      "opencode-go/deepseek-v4-pro"
    ]
  }
}
```

### Skills/MCPs syntax

```jsonc
{
  "oracle": {
    "skills": { "always-load": ["simplify"], "wildcard": true },
    "mcps": ["websearch", "context7"]
  }
}
```

## Subscriptions / Account Commands

Manage API accounts directly from the OpenCode prompt via `/subscriptions`:

- `/subscriptions list` - View all accounts and their usage
- `/subscriptions add-opencode-go <name> <workspace-id>` - Add OpenCode Go account
- `/subscriptions add-neuralwatt <name> <api-key>` - Add Neuralwatt account
- `/subscriptions add-codex-device <name>` - Add Codex (OpenAI) account via device auth
- `/subscriptions switch <provider> <name>` - Activate an account for a provider
- `/subscriptions remove <name>` - Delete an account
- `/subscriptions refresh` - Force refresh usage data

### Supported providers

| Provider        | Usage tracking                                        | Auth method                |
| --------------- | ----------------------------------------------------- | -------------------------- |
| **OpenCode Go** | Dashboard scraping (rolling, weekly, monthly windows) | Workspace ID + auth cookie |
| **Neuralwatt**  | REST API (credits, kWh, token usage)                  | API key                    |
| **Codex**       | REST API (5H/7D rate limits, credits)                 | Device code auth (OAuth)   |

Usage data appears in the TUI sidebar under **API Usage**.

### Codex device auth

Codex uses your ChatGPT account (not an API key). The device auth flow lets you
log in from any terminal - no browser on the same machine needed.

1. Run `/subscriptions add-codex-device <name>`
2. Open the displayed URL in any browser and sign in with your ChatGPT account
3. Enter the one-time code shown in your terminal
4. Done - usage tracking starts immediately

Access tokens refresh automatically via the stored refresh token. If the
refresh token expires (e.g., after a password change), re-run
`/subscriptions add-codex-device`.

## Prompt overrides

Place Markdown files in `~/.config/opencode/opencode-dux/`:

- `<agent>.md` - Replace default prompt
- `<agent>_append.md` - Append to default prompt
- `<preset>/<agent>.md` - Preset-scoped prompts

## Built-in MCPs

| MCP         | Description                  |
| ----------- | ---------------------------- |
| `websearch` | Web search (Exa or Tavily)   |
| `context7`  | Library documentation lookup |
| `grep_app`  | GitHub code search           |

Disable any: `{ "disabledMcps": ["grep_app"] }`

## Built-in Skills

- **simplify** - Code simplification and clarity improvements
- **codemap** - Codebase mapping and structure analysis

## Skill Discovery

Agents can recommend additional skills via `discover_skills_online`. When recommended: `npx skills add <repo>`

## Development

```bash
bun run build          # Build TypeScript to dist/
bun run typecheck      # Type checking
bun test               # Run tests
bun run check:ci       # Lint + format (CI mode)
bun run generate-schema  # Regenerate JSON schema from Zod
```

## License

MIT
