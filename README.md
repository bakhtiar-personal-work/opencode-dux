# opencode-dux

Agent orchestration, management, and operations plugin for OpenCode. Routes tasks to specialized agents automatically.

## Quick Start

1. Add to `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json`:

```json
{
  "plugin": ["github:bakhtiar-personal-work/opencode-dux"]
}
```

2. Create `~/.config/opencode/opencode-dux.jsonc`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/bakhtiar-personal-work/opencode-dux/master/opencode-dux.schema.json",
  "preset": "my-preset",
  "presets": {
    "my-preset": {
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

Or run the automated installer:

```bash
bunx github:bakhtiar-personal-work/opencode-dux install
```

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

Config file: `~/.config/opencode/opencode-dux.jsonc` (preferred) or `.json`

Configs are merged from two locations (project overrides user):

1. **User**: `~/.config/opencode/opencode-dux.jsonc`
2. **Project**: `<project>/.opencode/opencode-dux.jsonc`

### `preset`

Active preset name. Selects an entry from `presets` to apply as the default agent configuration. Can also be set via the `OH_MY_OPENCODE_SLIM_PRESET` environment variable.

```jsonc
{ "preset": "opencode-go" }
```

### `presets`

Named model configurations. Each preset maps agent names to their overrides. The active preset is selected by `preset`.

```jsonc
{
  "preset": "fast",
  "presets": {
    "fast": {
      "orchestrator": { "model": "opencode-go/deepseek-v4-flash" },
      "oracle": { "model": "opencode-go/deepseek-v4-flash" }
    },
    "pro": {
      "orchestrator": { "model": "neuralwatt/moonshotai/Kimi-K2.6" },
      "oracle": { "model": "opencode-go/deepseek-v4-pro" }
    }
  }
}
```

### `agents`

Per-agent overrides that apply on top of the active preset. Accepts the same per-agent options as preset entries. Useful for agent-specific settings that should apply regardless of which preset is active.

```jsonc
{
  "agents": {
    "orchestrator": {
      "skills": { "always-load": ["find-skills"], "wildcard": false },
      "mcps": { "always-load": [], "wildcard": false }
    }
  }
}
```

### Per-agent options

Each agent entry (in `presets.<name>.<agent>` or `agents.<agent>`) accepts:

| Field         | Type                   | Description                                                             |
| ------------- | ---------------------- | ----------------------------------------------------------------------- |
| `model`       | `string` or `array`    | Model ID (`provider/model`) or array of models for runtime fallback     |
| `temperature` | `number` (0–2)         | Model temperature                                                       |
| `variant`     | `string`               | Variant hint (e.g. `"medium"`, `"pro"`, `"flash"`)                      |
| `options`     | `object`               | Provider-specific model options (e.g. `textVerbosity`, thinking budget) |
| `displayName` | `string`               | Custom display name for the agent                                       |
| `skills`      | `object` or `string[]` | Skill access configuration                                              |
| `mcps`        | `object` or `string[]` | MCP access configuration                                                |

**Model as array** — When `model` is an array, the first available model is used at startup. Runtime fallback on API errors uses the full chain:

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

**Skills/MCPs syntax**:

```jsonc
{
  "oracle": {
    "skills": {
      "always-load": ["simplify"], // always available
      "wildcard": true // allow all other skills too
    },
    "mcps": ["websearch", "context7"] // shorthand: just array of names
  }
}
```

### `fallback`

Runtime model fallback when the primary model returns an API error (rate limit, timeout, etc.).

```jsonc
{
  "fallback": {
    "enabled": true,
    "timeoutMs": 15000,
    "retryDelayMs": 500,
    "retry_on_empty": true,
    "chains": {
      "orchestrator": [
        "opencode-go/deepseek-v4-pro",
        "opencode-go/mimo-v2.5-pro"
      ],
      "oracle": ["opencode-go/deepseek-v4-pro"]
    }
  }
}
```

| Field            | Default | Description                                 |
| ---------------- | ------- | ------------------------------------------- |
| `enabled`        | `true`  | Enable fallback chains                      |
| `timeoutMs`      | `15000` | Per-request timeout before trigger fallback |
| `retryDelayMs`   | `500`   | Delay between retry attempts                |
| `retry_on_empty` | `true`  | Treat empty responses as failures           |
| `chains`         | `{}`    | Ordered fallback model arrays per agent     |

### `sessionManager`

Controls how the orchestrator manages parallel subagent sessions.

```jsonc
{
  "sessionManager": {
    "maxSessionsPerAgent": 2,
    "readContextMinLines": 10,
    "readContextMaxFiles": 8
  }
}
```

| Field                 | Default | Description                                        |
| --------------------- | ------- | -------------------------------------------------- |
| `maxSessionsPerAgent` | `2`     | Max concurrent sessions per agent type (1–10)      |
| `readContextMinLines` | `10`    | Min lines threshold for read context tool (0–1000) |
| `readContextMaxFiles` | `8`     | Max files per read context batch (0–50)            |

### `todoContinuation`

Auto-continue the orchestrator when todos remain incomplete.

```jsonc
{
  "todoContinuation": {
    "maxContinuations": 5,
    "cooldownMs": 3000,
    "autoEnable": false,
    "autoEnableThreshold": 4
  }
}
```

| Field                 | Default | Description                                                  |
| --------------------- | ------- | ------------------------------------------------------------ |
| `maxContinuations`    | `5`     | Max consecutive auto-continuations before asking user (1–50) |
| `cooldownMs`          | `3000`  | Delay before auto-continuing (0–30000ms)                     |
| `autoEnable`          | `false` | Automatically enable when enough todos exist                 |
| `autoEnableThreshold` | `4`     | Number of todos that triggers auto-enable (1–50)             |

### `contextPressure`

Warns the orchestrator when context usage is high, prompting `/compact` before the model fails.

```jsonc
{
  "contextPressure": {
    "enabled": true,
    "warnThresholdPct": 75
  }
}
```

| Field              | Default | Description                            |
| ------------------ | ------- | -------------------------------------- |
| `enabled`          | `true`  | Enable context pressure warnings       |
| `warnThresholdPct` | `75`    | Trigger at this context usage % (1–99) |

### `websearch`

Configure the built-in websearch MCP provider.

```jsonc
{
  "websearch": { "provider": "exa" }
}
```

| Field      | Default | Description           |
| ---------- | ------- | --------------------- |
| `provider` | `"exa"` | `"exa"` or `"tavily"` |

### `setDefaultAgent`

When `true` (default), sets the OpenCode `default_agent` to `"orchestrator"` on startup. Set to `false` to keep your existing default agent.

```jsonc
{ "setDefaultAgent": false }
```

### `autoUpdate`

Enable automatic updates when the plugin is loaded via npm package name.

```jsonc
{ "autoUpdate": true }
```

### `scoringEngineVersion`

Experimental scoring engine version selection.

```jsonc
{ "scoringEngineVersion": "v2" }
```

### `balanceProviderUsage`

Spread requests across providers for cost/rate-limit balancing.

```jsonc
{ "balanceProviderUsage": true }
```

### `manualPlan`

Legacy explicit 4-tier fallback plan for each agent. Superseded by `fallback.chains` — both can coexist; `fallback.chains` appends to `_modelArray`.

```jsonc
{
  "manualPlan": {
    "orchestrator": {
      "primary": "neuralwatt/moonshotai/Kimi-K2.6",
      "fallback1": "opencode-go/deepseek-v4-flash",
      "fallback2": "opencode-go/deepseek-v4-pro",
      "fallback3": "opencode-go/mimo-v2.5-pro"
    }
  }
}
```

## Full example config

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/bakhtiar-personal-work/opencode-dux/master/opencode-dux.schema.json",
  "preset": "opencode-go",
  "setDefaultAgent": true,
  "autoUpdate": true,
  "contextPressure": {
    "enabled": true,
    "warnThresholdPct": 75
  },
  "websearch": {
    "provider": "exa"
  },
  "sessionManager": {
    "maxSessionsPerAgent": 2,
    "readContextMinLines": 10,
    "readContextMaxFiles": 8
  },
  "todoContinuation": {
    "maxContinuations": 5,
    "cooldownMs": 3000,
    "autoEnable": false,
    "autoEnableThreshold": 4
  },
  "fallback": {
    "enabled": true,
    "timeoutMs": 15000,
    "retryDelayMs": 500,
    "retry_on_empty": true,
    "chains": {
      "orchestrator": ["opencode-go/deepseek-v4-pro"],
      "oracle": ["opencode-go/deepseek-v4-pro"]
    }
  },
  "presets": {
    "opencode-go": {
      "orchestrator": {
        "model": "neuralwatt/Qwen/Qwen3.5-397B-A17B-FP8",
        "variant": "medium",
        "skills": { "always-load": ["find-skills"], "wildcard": false },
        "mcps": { "always-load": [], "wildcard": false }
      },
      "oracle": {
        "model": "opencode-go/deepseek-v4-flash",
        "skills": { "always-load": ["simplify"], "wildcard": true },
        "options": { "smart": "opencode-go/deepseek-v4-pro" }
      },
      "explorer": {
        "model": "neuralwatt/qwen3.5-397b-fast",
        "skills": { "always-load": ["codemap"], "wildcard": true }
      },
      "librarian": {
        "model": "opencode-go/deepseek-v4-flash",
        "skills": { "always-load": [], "wildcard": true },
        "mcps": {
          "always-load": ["websearch", "context7", "github"],
          "wildcard": true
        }
      },
      "designer": {
        "model": "neuralwatt/moonshotai/Kimi-K2.6",
        "temperature": 0.3,
        "skills": { "always-load": [], "wildcard": true },
        "mcps": { "always-load": [], "wildcard": true }
      },
      "fixer": {
        "model": "opencode-go/deepseek-v4-flash",
        "skills": { "always-load": ["codemap"], "wildcard": true },
        "mcps": { "always-load": [], "wildcard": true }
      },
      "steward": {
        "model": "opencode-go/deepseek-v4-flash",
        "skills": { "always-load": [], "wildcard": false }
      },
      "interpreter": {
        "model": "neuralwatt/moonshotai/Kimi-K2.6",
        "skills": { "always-load": [], "wildcard": false }
      }
    }
  },
  "agents": {
    "librarian": {
      "mcps": { "always-load": ["websearch", "context7"], "wildcard": true }
    },
    "oracle": {
      "skills": { "always-load": ["simplify"], "wildcard": true }
    }
  }
}
```

## Prompt overrides

Customize agent system prompts by placing Markdown files in the prompts directory:

- **Replace** the default prompt: `~/.config/opencode/opencode-dux/<agent>.md`
- **Append** to the default prompt: `~/.config/opencode/opencode-dux/<agent>_append.md`

Preset-scoped prompts are also supported — place them in a subdirectory named after the preset:

- `~/.config/opencode/opencode-dux/<preset>/<agent>.md`

## Built-in MCPs

Plugin provides 3 MCP servers (auto-loaded):

| MCP         | Description                  |
| ----------- | ---------------------------- |
| `websearch` | Web search (Exa or Tavily)   |
| `context7`  | Library documentation lookup |
| `grep_app`  | GitHub code search           |

Disable any MCP in config:

```jsonc
{
  "disabledMcps": ["grep_app"]
}
```

## Built-in Skills

Plugin includes 2 bundled skills (auto-installed):

- **simplify** — Code simplification and clarity improvements
- **codemap** — Codebase mapping and structure analysis

## Skill Discovery

Agents can recommend additional skills via `discover_skills_online` tool. When a skill is recommended:

1. Agent presents: "I recommend installing X for this task"
2. You run: `npx skills add <repo>`
3. Next session: skill appears in `<available_skills>`

## Commands

```bash
bun run build        # Build TypeScript to dist/
bun run typecheck    # Type checking
bun test             # Run tests
bun run check:ci     # Lint + format (CI mode)
bun run generate-schema  # Regenerate JSON schema from Zod
bun run verify:release   # Verify release artifact
```

## License

MIT
