import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from '@opencode-ai/plugin';
import { createAgents, getAgentConfigs } from './agents';
import { buildOrchestratorPrompt } from './agents/orchestrator';
import {
  addPluginToOpenCodeTuiConfig,
  resolvePluginEntryFromOpenCodeConfig,
} from './cli/config-io';
import {
  type AgentOverrideConfig,
  ALL_AGENT_NAMES,
  DEFAULT_MODELS,
  deepMerge,
  loadPluginConfig,
} from './config';
import { AGENT_ALIASES } from './config/constants';
import {
  getActiveRuntimePreset,
  getPreviousRuntimePreset,
  setActiveRuntimePreset,
} from './config/runtime-preset';
import { getLocalDiscovery } from './discovery/local';
import { createDiscoverMcpServersTool } from './discovery/mcp-servers';
import { createDiscoverSkillsTool } from './discovery/skills';

import {
  createApplyPatchHook,
  createAutoUpdateCheckerHook,
  createChatHeadersHook,
  createContextPressureReminderHook,
  createDelegateTaskRetryHook,
  createFilterAvailableSkillsHook,
  createJsonErrorRecoveryHook,
  createPhaseReminderHook,
  createPostFileToolNudgeHook,
  createTaskSessionManagerHook,
  createTodoContinuationHook,
} from './hooks';
import { getLatestVersion } from './hooks/auto-update-checker';
import { processImageAttachments } from './hooks/image-hook';
import { createBuiltinMcps } from './mcp';
import type { UsageService } from './subscriptions';
import { createUsageService } from './subscriptions';
import {
  ast_grep_replace,
  ast_grep_search,
  createDelegateTools,
  createPresetManager,
  createWebfetchTool,
} from './tools';
import {
  deleteSessionEntries,
  expandMissingSessionCascade,
  mergedSessionModels,
  mergedSessionTree,
  normalizeProjectDirectory,
  patchSessionTreeStatusFromOpenCode,
  pruneStaleTuiSessionBundles,
  type RecordSessionUsageInput,
  readTuiSnapshot,
  recordChildSessionSnapshot,
  recordSessionDone,
  recordSessionEnd,
  recordSessionModel,
  recordSessionNode,
  recordSessionProject,
  recordSessionTitle,
  recordSessionUsage,
  recordSessionUsagesBatch,
  recordSessionVariant,
  sessionTreeStore,
  syncOpenCodeStatusesIntoSessionTree,
  updateSnapshot,
} from './tui-state';
import {
  createDisplayNameMentionRewriter,
  resolveRuntimeAgentName,
} from './utils';
import { initLogger, log } from './utils/logger';
import { SubagentDepthTracker } from './utils/subagent-depth';
import { collapseSystemInPlace } from './utils/system-collapse';
import { VERSION_CACHE_STALE_MS, writeVersionCache } from './version-store';

/**
 * Best-effort log to opencode's app logger.
 * Wrapped in try/catch to avoid deadlocking on opencode v1.4.8-v1.4.9
 * where client.app.log() during init triggers a middleware cycle.
 */
async function appLog(
  ctx: Parameters<Plugin>[0],
  level: 'error' | 'warn' | 'info',
  message: string,
): Promise<void> {
  try {
    await ctx.client.app.log({
      body: { service: 'opencode-dux', level, message },
    });
  } catch {
    // client.app.log may deadlock or be unavailable; stderr is the
    // fallback
    const prefix =
      level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO';
    console.error(`[opencode-dux] ${prefix}: ${message}`);
  }
}

/** Minimum expected registrations for a healthy plugin load. */
const HEALTH_CHECK = {
  minAgents: 5,
  minTools: 5,
  minMcps: 1,
} as const;

function readPluginVersion(): string | null {
  try {
    const modDir = dirname(fileURLToPath(import.meta.url));
    const rootDir = dirname(modDir);
    const pkgPath = join(rootDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return typeof pkg.version === 'string' ? pkg.version : null;
    }
  } catch {}
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readTokenTelemetry(message: unknown): {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  contextLimit: number;
} | null {
  const msg = message as {
    info?: {
      role?: string;
      tokens?: {
        input?: unknown;
        output?: unknown;
        reasoning?: unknown;
        cache?: { read?: unknown; write?: unknown };
      };
      model?: {
        limit?: { context?: unknown; input?: unknown };
      };
    };
  };
  if (msg.info?.role !== 'assistant') return null;

  const input = asNumber(msg.info?.tokens?.input) ?? 0;
  const output = asNumber(msg.info?.tokens?.output) ?? 0;
  const reasoning = asNumber(msg.info?.tokens?.reasoning) ?? 0;
  const cacheRead = asNumber(msg.info?.tokens?.cache?.read) ?? 0;
  const cacheWrite = asNumber(msg.info?.tokens?.cache?.write) ?? 0;

  const contextLimit =
    asNumber(msg.info?.model?.limit?.context) ??
    asNumber(msg.info?.model?.limit?.input) ??
    0;

  if (
    input <= 0 &&
    output <= 0 &&
    reasoning <= 0 &&
    cacheRead <= 0 &&
    cacheWrite <= 0
  ) {
    return null;
  }

  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    contextLimit,
  };
}

// Model context limit cache: key = "providerID/modelID", value = context
// limit. Populated lazily via ensureModelContextLimits().
const _modelContextLimitCache = new Map<string, number>();
let _modelLimitFetchPromise: Promise<void> | null = null;

async function ensureModelContextLimits(client: {
  provider: {
    list: () => Promise<{
      data?: { all?: Array<Record<string, unknown>> };
    }>;
  };
}): Promise<void> {
  if (_modelContextLimitCache.size > 0 || _modelLimitFetchPromise) {
    await _modelLimitFetchPromise;
    return;
  }

  _modelLimitFetchPromise = (async () => {
    try {
      const result = await client.provider.list();
      const providers =
        (result.data?.all as
          | Array<{
              id?: string;
              models?: Record<
                string,
                { id?: string; limit?: { context?: number } }
              >;
            }>
          | undefined) ?? [];
      for (const provider of providers) {
        if (!provider.models) continue;
        for (const model of Object.values(provider.models)) {
          if (
            typeof model?.limit?.context === 'number' &&
            model.limit.context > 0 &&
            provider.id &&
            model.id
          ) {
            _modelContextLimitCache.set(
              `${provider.id}/${model.id}`,
              model.limit.context,
            );
          }
        }
      }
    } catch {
      // Non-critical - cache stays empty, percentage shows 0
    }
  })();

  return _modelLimitFetchPromise;
}

/**
 * Compute usage telemetry for one session (messages fetch). Used by
 * reconciliation; persists via {@link recordSessionUsagesBatch} so we do not
 * N-compete on tui-state.json.
 */
async function computeSessionUsageForReconcile(
  ctx: Parameters<Plugin>[0],
  sessionID: string,
): Promise<RecordSessionUsageInput | null> {
  try {
    const messagesResult = await ctx.client.session.messages({
      path: { id: sessionID },
    });
    const allMessages = Array.isArray(messagesResult.data)
      ? messagesResult.data
      : [];
    const assistantMsgs = allMessages.filter(
      (m) => (m as { info?: { role?: string } }).info?.role === 'assistant',
    );

    // Extract tokens from last assistant message only (SDK supplies cumulative values)
    let totalInput = 0;
    let totalOutput = 0;
    let totalReasoning = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let contextLimit = 0;
    let contextUsed = 0;
    let contextPct = 0;

    // Ensure context limit cache is populated before recording usage
    await ensureModelContextLimits(ctx.client).catch(() => {});

    const lastTokenMsg = [...assistantMsgs]
      .reverse()
      .find((m) => readTokenTelemetry(m));
    if (lastTokenMsg) {
      const telemetry = readTokenTelemetry(lastTokenMsg);
      if (telemetry) {
        totalInput = telemetry.input;
        totalOutput = telemetry.output;
        totalReasoning = telemetry.reasoning;
        totalCacheRead = telemetry.cacheRead;
        totalCacheWrite = telemetry.cacheWrite;
        contextLimit = telemetry.contextLimit;
        // Sidebar expects CTX used to match Input + Output tokens.
        // Input row = input + cacheRead
        // Output row = output + reasoning
        contextUsed =
          telemetry.input +
          telemetry.cacheRead +
          telemetry.output +
          telemetry.reasoning;
        contextPct = contextLimit > 0 ? (contextUsed / contextLimit) * 100 : 0;
      }
    }

    // Fallback: if message didn't provide context limit, look up from cache
    if (contextLimit === 0 && contextUsed > 0) {
      const model = mergedSessionModels(readTuiSnapshot())[sessionID];
      const cachedLimit = model
        ? _modelContextLimitCache.get(model)
        : undefined;
      if (cachedLimit && cachedLimit > 0) {
        contextLimit = cachedLimit;
        contextPct = (contextUsed / contextLimit) * 100;
      }
    }

    if (contextUsed > 0 || totalInput > 0 || totalOutput > 0) {
      return {
        sessionID,
        contextUsed,
        contextLimit,
        contextPct,
        input: totalInput,
        output: totalOutput,
        reasoning: totalReasoning,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Probe jsdom at init time so the first webfetch call doesn't fail
 * silently. Logs a warning if jsdom can't be imported or instantiated,
 * but does not throw; the plugin works without webfetch.
 */
async function probeJSDOM(): Promise<string | null> {
  try {
    const { JSDOM } = await import('jsdom');
    new JSDOM('<!DOCTYPE html><html><body>test</body></html>');
    return null;
  } catch (err) {
    return String(err);
  }
}

// Module-level runtime preset tracking. Survives plugin re-inits triggered
// by client.config.update() → Instance.dispose(). When the plugin function
// re-runs, it checks this variable and applies the runtime preset instead
// of the config file's preset. State lives in config/runtime-preset.ts.

// Guards to ensure startup logs fire only once across plugin re-inits
let didLogVerboseInit = false;
let didLogStartupSummary = false;

const OpenCodeDux: Plugin = async (ctx) => {
  const sessionId = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  initLogger(sessionId);
  log('[plugin] factory invoked');

  // Declare variables that must survive the try/catch for the return
  // closure. These are set inside the try block.
  let config: ReturnType<typeof loadPluginConfig>;
  let agentDefs: Awaited<ReturnType<typeof createAgents>>;
  let agents: Awaited<ReturnType<typeof getAgentConfigs>>;
  let builtinMcps: ReturnType<typeof createBuiltinMcps>;

  let depthTracker: SubagentDepthTracker;
  let autoUpdateChecker: ReturnType<typeof createAutoUpdateCheckerHook>;
  let phaseReminderHook: ReturnType<typeof createPhaseReminderHook>;
  let filterAvailableSkillsHook: ReturnType<
    typeof createFilterAvailableSkillsHook
  >;
  let sessionAgentMap: Map<string, string>;
  let deletingSessions: Set<string>;
  let reconcileSessions!: () => Promise<void>;
  let postFileToolNudgeHook: ReturnType<typeof createPostFileToolNudgeHook>;
  let chatHeadersHook: ReturnType<typeof createChatHeadersHook>;
  let delegateTaskRetryHook: ReturnType<typeof createDelegateTaskRetryHook>;
  let applyPatchHook: ReturnType<typeof createApplyPatchHook>;
  let jsonErrorRecoveryHook: ReturnType<typeof createJsonErrorRecoveryHook>;
  let todoContinuationHook: ReturnType<typeof createTodoContinuationHook>;
  let taskSessionManagerHook: ReturnType<typeof createTaskSessionManagerHook>;
  let contextPressureReminderHook: ReturnType<
    typeof createContextPressureReminderHook
  >;
  let presetManager: ReturnType<typeof createPresetManager>;
  let usageService: UsageService | null;
  let webfetch: ReturnType<typeof createWebfetchTool>;
  let delegateTools: Record<string, unknown>;
  let discoverMcpTool:
    | ReturnType<typeof createDiscoverMcpServersTool>
    | undefined;
  let discoverSkillsTool:
    | ReturnType<typeof createDiscoverSkillsTool>
    | undefined;
  let rewriteDisplayNameMentions: ReturnType<
    typeof createDisplayNameMentionRewriter
  >;

  // Counters for post-init health check (set inside try, checked outside)
  let toolCount = 0;

  try {
    const isFirstInit = !didLogVerboseInit;

    if (isFirstInit) {
      console.log('\u{2699}\u{FE0F} Initializing opencode-dux...');
      log('[init] Initializing opencode-dux...');
    }

    config = loadPluginConfig(ctx.directory);

    // Safety net: if a runtime preset was set via /preset command and
    // OpenCode ever fully re-runs the plugin function (not just the
    // config() hook), override config.preset so agents are created with
    // the correct models. Currently only the config() hook re-runs after
    // Instance.dispose(), so this is a defensive guard.
    const runtimePreset = getActiveRuntimePreset();
    if (runtimePreset && config.presets?.[runtimePreset]) {
      config.preset = runtimePreset;
      // Re-merge runtime preset into config.agents (loadPluginConfig
      // already merged the config-file preset, not the runtime one).
      // Runtime preset is override so it wins over config-file preset.
      const presetAgents = config.presets[runtimePreset];
      config.agents = deepMerge(config.agents, presetAgents);
    } else if (runtimePreset) {
      // Preset was deleted from config since last switch - clear stale state
      setActiveRuntimePreset(null);
    }

    // Validate all agents have models configured
    for (const agentName of ALL_AGENT_NAMES) {
      const override = config?.agents?.[agentName]?.model;
      const defaultModel =
        DEFAULT_MODELS[agentName as keyof typeof DEFAULT_MODELS];
      const effectiveModel = override ?? defaultModel;
      if (!effectiveModel) {
        ctx.client.tui
          .showToast({
            body: {
              title: `Agent "${agentName}" has no model configured`,
              message:
                `Set "agents.${agentName}.model" in your config or ` +
                'a default will be used.',
              variant: 'info',
              duration: 5000,
            },
          })
          .catch(() => {});
      }
    }

    if (isFirstInit) {
      console.log('  \u{1F4C1} plugin config: loaded');
      log('[init] plugin config: loaded');
    }

    // Auto-register opencode-dux in OpenCode's tui.json so it appears in the TUI plugin list.
    // Fire-and-forget so failures (e.g., tui.json not writable) don't block init.
    if (isFirstInit) {
      const entry = resolvePluginEntryFromOpenCodeConfig();
      addPluginToOpenCodeTuiConfig(entry).catch(() => {});
    }

    rewriteDisplayNameMentions = createDisplayNameMentionRewriter(config);
    agentDefs = await createAgents(config);
    agents = await getAgentConfigs(config);

    if (isFirstInit) {
      console.log(`  \u{1F916} agents: ${Object.keys(agents).join(', ')}`);
      log(`[init] agents: ${Object.keys(agents).join(', ')}`);
    }

    depthTracker = new SubagentDepthTracker();

    // Initialize delegate tools for orchestrator variant-based subagent spawning
    delegateTools = createDelegateTools(ctx, config, depthTracker);

    builtinMcps = createBuiltinMcps(undefined, config.websearch);

    if (isFirstInit) {
      console.log(
        '  \u{1F50C} Built-in MCPs: ' + Object.keys(builtinMcps).join(', '),
      );
      log('[init] Built-in MCPs: ' + Object.keys(builtinMcps).join(', '));
    }

    // Warm the local discovery cache asynchronously (non-blocking init).
    // Subsequent hooks/tools will read from cache on first use.
    getLocalDiscovery(ctx).catch(() => {});

    webfetch = createWebfetchTool(ctx);

    // Initialize online discovery tools (graceful degradation on failure)
    const toolsOnline: string[] = [];
    try {
      discoverMcpTool = createDiscoverMcpServersTool(ctx);
      toolsOnline.push('discover_mcp_servers');
    } catch (err) {
      log('[plugin] failed to create discover_mcp_servers tool', String(err));
      discoverMcpTool = undefined;
    }
    try {
      discoverSkillsTool = createDiscoverSkillsTool(ctx);
      toolsOnline.push('discover_skills');
    } catch (err) {
      log('[plugin] failed to create discover_skills tool', String(err));
      discoverSkillsTool = undefined;
    }
    if (isFirstInit) {
      console.log(
        `  \u{1F527} tools: webfetch, ast_grep_search, ast_grep_replace${toolsOnline.length ? `, ${toolsOnline.join(', ')}` : ''}`,
      );
      log(
        `[init] tools: webfetch, ast_grep_search, ast_grep_replace${toolsOnline.length ? `, ${toolsOnline.join(', ')}` : ''}`,
      );
    }

    // Initialize auto-update checker hook
    autoUpdateChecker = createAutoUpdateCheckerHook(ctx, {
      autoUpdate: config.autoUpdate ?? true,
    });

    // Trigger auto-update check after init completes.
    // setTimeout(0) defers to next microtask, ensuring plugin factory
    // has fully returned before the update check starts.
    setTimeout(() => autoUpdateChecker.trigger(), 0);

    // Initialize phase reminder hook for workflow compliance
    phaseReminderHook = createPhaseReminderHook();

    // Initialize available skills filter hook
    filterAvailableSkillsHook = createFilterAvailableSkillsHook(ctx, config);

    // Track session → agent mapping for serve-mode system prompt injection
    sessionAgentMap = new Map<string, string>();
    deletingSessions = new Set<string>();

    // Sync tui-state with OpenCode's session snapshot. Prefer running after the
    // user submits (`experimental.chat.messages.transform`) rather than plugin
    // init so session.status tends to enumerate active sessions reliably.
    reconcileSessions = async (): Promise<void> => {
      try {
        const result = await ctx.client.session.status({});
        const statuses = result.data as
          | Record<string, { type: string }>
          | undefined;
        if (!statuses) return;
        // An empty status map cannot distinguish "nothing running" from
        // transient/incomplete enumeration. Treating {} as authoritative
        // cleared every snapshot bundle for this cwd and tore down the
        // entire sessionTreeStore (see instanceSeeds below).
        if (Object.keys(statuses).length === 0) return;

        const opencodeIds = new Set(Object.keys(statuses));
        const currentProjectDir = normalizeProjectDirectory(ctx.directory);

        // Sync polled OpenCode statuses into tree nodes. Bundles are removed
        // when every session id in the tree is absent from OpenCode (same
        // project only), by 7d idle TTL, or soft-pruned for partial gaps.
        updateSnapshot((s) => {
          syncOpenCodeStatusesIntoSessionTree(
            s,
            statuses as Record<string, { type: string }>,
          );
          pruneStaleTuiSessionBundles(s, {
            opencodeIds,
            currentProjectDir,
            now: Date.now(),
          });
        });

        const snap = readTuiSnapshot();
        const mergedForMemory = {
          ...mergedSessionTree(snap),
          ...sessionTreeStore,
        };

        const instanceSeeds = Object.keys(sessionTreeStore).filter(
          (sid) => !opencodeIds.has(sid),
        );
        const instanceExpanded = expandMissingSessionCascade(
          mergedForMemory,
          instanceSeeds,
        );

        for (const sid of instanceExpanded) {
          sessionAgentMap.delete(sid);
          delete sessionTreeStore[sid];
          if (depthTracker) depthTracker.cleanup(sid);
          deletingSessions.delete(sid);
        }

        const activeIds = Object.keys(statuses);
        const usageResults = await Promise.allSettled(
          activeIds.map((sid) => computeSessionUsageForReconcile(ctx, sid)),
        );
        const usageBatch: RecordSessionUsageInput[] = [];
        for (const r of usageResults) {
          if (r.status === 'fulfilled' && r.value) {
            usageBatch.push(r.value);
          }
        }
        recordSessionUsagesBatch(usageBatch);

        usageService?.refresh(false).catch(() => {});
      } catch {
        // best-effort - silent
      }
    };

    // Initialize post-file-tool nudge hook
    postFileToolNudgeHook = createPostFileToolNudgeHook({
      shouldInject: (sessionID) =>
        sessionAgentMap.get(sessionID) === 'orchestrator',
    });

    chatHeadersHook = createChatHeadersHook(ctx);

    // Initialize delegate-task retry guidance hook
    delegateTaskRetryHook = createDelegateTaskRetryHook(ctx);

    applyPatchHook = createApplyPatchHook(ctx);
    // Initialize JSON parse error recovery hook
    jsonErrorRecoveryHook = createJsonErrorRecoveryHook(ctx);

    // Initialize todo-continuation hook (opt-in auto-continue for
    // incomplete todos)
    todoContinuationHook = createTodoContinuationHook(ctx, {
      maxContinuations: config.todoContinuation?.maxContinuations ?? 5,
      cooldownMs: config.todoContinuation?.cooldownMs ?? 3000,
      autoEnable: config.todoContinuation?.autoEnable ?? false,
      autoEnableThreshold: config.todoContinuation?.autoEnableThreshold ?? 4,
    });
    taskSessionManagerHook = createTaskSessionManagerHook(ctx, {
      maxSessionsPerAgent: config.sessionManager?.maxSessionsPerAgent ?? 2,
      readContextMinLines: config.sessionManager?.readContextMinLines ?? 10,
      readContextMaxFiles: config.sessionManager?.readContextMaxFiles ?? 8,
      shouldManageSession: (sessionID) =>
        sessionAgentMap.get(sessionID) === 'orchestrator',
    });
    contextPressureReminderHook = createContextPressureReminderHook({
      enabled: config.contextPressure?.enabled ?? true,
      warnThresholdPct: config.contextPressure?.warnThresholdPct ?? 75,
    });
    presetManager = createPresetManager(ctx, config);
    usageService = createUsageService(ctx.client);
    usageService.syncActiveAccounts();

    if (isFirstInit) {
      console.log(
        '  \u{1F517} hooks: auto-update, phase-reminder, skills-filter, apply-patch, json-recovery, todo-continuation, session-manager, pressure-reminder',
      );
      log(
        '[init] hooks: auto-update, phase-reminder, skills-filter, apply-patch, json-recovery, todo-continuation, session-manager, pressure-reminder',
      );
    }

    toolCount =
      Object.keys(delegateTools).length +
      Object.keys(todoContinuationHook.tool).length +
      1 + // webfetch
      2 + // ast_grep_search, ast_grep_replace
      (discoverMcpTool ? 1 : 0); // discover_mcp_servers

    if (isFirstInit) {
      console.log(
        `\u{2705} opencode-dux initialized (${Object.keys(agents).length} agents, ${toolCount} tools, ${Object.keys(builtinMcps).length} MCPs)`,
      );
      log(
        `[init] initialized (${Object.keys(agents).length} agents, ${toolCount} tools, ${Object.keys(builtinMcps).length} MCPs)`,
      );
      didLogVerboseInit = true;

      // Persist currentVersion for "just updated" detection on next startup
      const currentVersion = readPluginVersion();
      if (currentVersion) {
        updateSnapshot((s) => {
          s.pluginVersion = currentVersion;
        });
      }
    }
  } catch (err) {
    // Plugin init failed: log visibly before re-throwing so the user
    // sees something actionable instead of a silent "loaded but empty".
    log('[plugin] FATAL: init failed', String(err));
    await appLog(
      ctx,
      'error',
      `INIT FAILED: ${String(err)}. Report at github.com/bakhtiar-personal-work/opencode-dux/issues`,
    );
    throw err;
  }

  const agentCount = Object.keys(agents).length;
  const mcpCount = Object.keys(builtinMcps).length;
  const mcpThreshold = HEALTH_CHECK.minMcps;

  if (
    agentCount < HEALTH_CHECK.minAgents ||
    toolCount < HEALTH_CHECK.minTools ||
    mcpCount < mcpThreshold
  ) {
    const msg = [
      'Health check: registrations suspiciously low.',
      `  agents: ${agentCount} (expected >=${HEALTH_CHECK.minAgents})`,
      `  tools:  ${toolCount} (expected >=${HEALTH_CHECK.minTools})`,
      `  mcps:   ${mcpCount} (expected >=${mcpThreshold})`,
      'This usually means a dependency failed to resolve (jsdom, etc).',
    ].join('\n');
    log(`[plugin] WARN: ${msg}`);
    await appLog(ctx, 'warn', msg);
  } else {
    log('[plugin] health check passed', {
      agents: agentCount,
      tools: toolCount,
      mcps: mcpCount,
    });
  }

  // Don't await this; we don't want to block init. The warning will
  // appear shortly after startup if jsdom is broken.
  probeJSDOM().then((err) => {
    if (err) {
      const msg = `jsdom probe failed; webfetch tool will not work: ${err}`;
      log(`[plugin] WARN: ${msg}`);
      appLog(ctx, 'warn', msg).catch(() => {});
    }
  });

  async function scheduleVersionDisplay(
    currentVersion: string,
  ): Promise<boolean> {
    try {
      // 1. Get saved version (for "just updated" detection)
      const snapshot = readTuiSnapshot();
      const savedVersion = snapshot.pluginVersion ?? null;

      // 2. Always fetch latest version from npm on every startup
      console.log('📦 Checking for updates...');
      log('[version] Checking for updates...');
      const latestVersion = await getLatestVersion('latest');
      console.log(`  📦 Fetched latest version: ${latestVersion ?? 'failed'}`);
      log(`[version] Fetched latest version: ${latestVersion ?? 'failed'}`);
      let lastChecked: number | null = null;

      // Persist to cache for background check reference
      if (latestVersion) {
        lastChecked = Date.now();
        writeVersionCache({ latestVersion, lastChecked });
        updateSnapshot((s) => {
          s.versionCheck = {
            latestVersion,
            lastChecked,
          };
        });
      }

      // 3. Display version with fresh npm data
      if (savedVersion && savedVersion !== currentVersion) {
        console.log(
          `  \u{1F4E6} Current version: \x1b[31mv${savedVersion}\x1b[0m \u2192 \x1b[32mv${currentVersion} (Updated)\x1b[0m`,
        );
        log(
          `[version] Current version: v${savedVersion} \u2192 v${currentVersion} (Updated)`,
        );
      } else {
        const cacheFresh =
          latestVersion !== null &&
          lastChecked !== null &&
          Date.now() - lastChecked < VERSION_CACHE_STALE_MS;

        if (cacheFresh && latestVersion !== currentVersion) {
          console.log(
            `  \u{1F4E6} Current version: \x1b[31mv${currentVersion}\x1b[0m \u2192 \x1b[33mv${latestVersion}\x1b[0m`,
          );
          log(
            `[version] Current version: v${currentVersion} \u2192 v${latestVersion}`,
          );
        } else {
          const latestIndicator =
            cacheFresh && latestVersion === currentVersion ? ' (latest)' : '';
          console.log(
            `  \u{1F4E6} Current version: \x1b[32mv${currentVersion}${latestIndicator}\x1b[0m`,
          );
          log(
            `[version] Current version: v${currentVersion}${latestIndicator}`,
          );
        }
      }

      // If a newer version is available, notify the user. The auto-update
      // checker handles installation in the background.
      if (
        latestVersion &&
        lastChecked &&
        Date.now() - lastChecked < VERSION_CACHE_STALE_MS &&
        latestVersion !== currentVersion
      ) {
        log(
          `[auto-update-checker] Update available: v${currentVersion} → v${latestVersion}`,
        );
      }

      return true;
    } catch (err) {
      const verErrMsg = err instanceof Error ? err.message : String(err);
      console.log('  📦 Version check failed:', verErrMsg);
      log('[version] Version check failed: ' + verErrMsg);
      return false;
    }
  }

  return {
    name: 'opencode-dux',

    agent: agents,

    tool: {
      ...delegateTools,
      webfetch,
      ...todoContinuationHook.tool,
      ast_grep_search,
      ast_grep_replace,
      ...(discoverMcpTool ? { discover_mcp_servers: discoverMcpTool } : {}),
      ...(discoverSkillsTool ? { discover_skills: discoverSkillsTool } : {}),
    },

    mcp: builtinMcps,

    config: async (opencodeConfig: Record<string, unknown>) => {
      // Only set default_agent if not already configured by the user
      // and the plugin config doesn't explicitly disable this behavior
      if (
        config.setDefaultAgent !== false &&
        !(opencodeConfig as { default_agent?: string }).default_agent
      ) {
        (opencodeConfig as { default_agent?: string }).default_agent =
          'orchestrator';
      }

      // Merge Agent configs - per-agent shallow merge to preserve
      // user-supplied fields (e.g. tools, permission) from opencode.json
      if (!opencodeConfig.agent) {
        opencodeConfig.agent = { ...agents };
      } else {
        for (const [name, pluginAgent] of Object.entries(agents)) {
          const existing = (opencodeConfig.agent as Record<string, unknown>)[
            name
          ] as Record<string, unknown> | undefined;
          if (existing) {
            // Shallow merge: plugin defaults first, user overrides win
            (opencodeConfig.agent as Record<string, unknown>)[name] = {
              ...pluginAgent,
              ...existing,
            };
          } else {
            (opencodeConfig.agent as Record<string, unknown>)[name] = {
              ...pluginAgent,
            };
          }
        }
      }
      const configAgent = opencodeConfig.agent as Record<string, unknown>;

      // Runtime preset override: if /preset switched to a runtime preset,
      // override the model/variant/temperature from the preset's agent
      // config.
      const runtimePresetName = getActiveRuntimePreset();
      if (runtimePresetName && config.presets?.[runtimePresetName]) {
        const runtimePreset = config.presets[runtimePresetName];
        for (const [agentName, override] of Object.entries(runtimePreset)) {
          // Resolve legacy alias keys (e.g. "explore" → "explorer")
          // so presets using aliases work in this path.
          const resolvedName = AGENT_ALIASES[agentName] ?? agentName;
          const entry = configAgent[resolvedName] as
            | Record<string, unknown>
            | undefined;
          if (!entry) continue;

          if (typeof override.model === 'string') {
            entry.model = override.model;
          }
          // Explicitly set or clear scalar fields so switching from
          // Preset A (which sets a field) to Preset B (which doesn't)
          // doesn't leave stale values behind.
          if (typeof override.variant === 'string') {
            entry.variant = override.variant;
          } else if ('variant' in override) {
            delete entry.variant;
          }
          if (typeof override.temperature === 'number') {
            entry.temperature = override.temperature;
          } else if ('temperature' in override) {
            delete entry.temperature;
          }
          if (
            override.options &&
            typeof override.options === 'object' &&
            !Array.isArray(override.options)
          ) {
            entry.options = override.options;
          } else if ('options' in override) {
            delete entry.options;
          }
          log('[plugin] runtime preset override', {
            preset: runtimePresetName,
            agent: agentName,
            model: entry.model as string,
          });
        }

        // Reset agents from the previous preset that aren't in the new one.
        // The stale model resolution above overwrites the reset values sent
        // by preset-manager, so we re-apply them here from config-file
        // baseline.
        const prevPresetName = getPreviousRuntimePreset();
        if (prevPresetName && config.presets?.[prevPresetName]) {
          const prevPreset = config.presets[prevPresetName];
          // Build resolved key set from new preset for correct comparison
          // (handles alias keys like "explore" → "explorer")
          const newPresetResolved = new Set(
            Object.keys(runtimePreset).map((k) => AGENT_ALIASES[k] ?? k),
          );
          for (const agentName of Object.keys(prevPreset)) {
            const resolvedName = AGENT_ALIASES[agentName] ?? agentName;
            if (newPresetResolved.has(resolvedName)) continue; // new preset handles it
            const entry = configAgent[resolvedName] as
              | Record<string, unknown>
              | undefined;
            if (!entry) continue;
            // Reset to config-file baseline. Use the previous preset's
            // override to identify which fields to clear even when the
            // baseline doesn't define them.
            const baseline = config.agents?.[resolvedName];
            const prevOverride = prevPreset[agentName] as
              | AgentOverrideConfig
              | undefined;
            if (typeof baseline?.model === 'string') {
              entry.model = baseline.model;
            }
            if (typeof baseline?.variant === 'string') {
              entry.variant = baseline.variant;
            } else if (prevOverride && 'variant' in prevOverride) {
              delete entry.variant;
            }
            if (typeof baseline?.temperature === 'number') {
              entry.temperature = baseline.temperature;
            } else if (prevOverride && 'temperature' in prevOverride) {
              delete entry.temperature;
            }
            if (
              baseline?.options &&
              typeof baseline.options === 'object' &&
              !Array.isArray(baseline.options)
            ) {
              entry.options = baseline.options;
            } else if (prevOverride && 'options' in prevOverride) {
              delete entry.options;
            }
            log('[plugin] runtime preset reset from previous', {
              previousPreset: prevPresetName,
              agent: resolvedName,
              model: entry.model as string,
            });
          }
        }
      }

      // Merge MCP configs
      const configMcp = opencodeConfig.mcp as
        | Record<string, unknown>
        | undefined;
      if (!configMcp) {
        opencodeConfig.mcp = { ...builtinMcps };
      } else {
        Object.assign(configMcp, builtinMcps);
      }

      // Register /auto-continue command so OpenCode recognizes it.
      // Actual handling is done by command.execute.before hook below
      // (no LLM round-trip - injected directly into output.parts).
      const configCommand = opencodeConfig.command as
        | Record<string, unknown>
        | undefined;
      if (!configCommand?.['auto-continue']) {
        if (!opencodeConfig.command) {
          opencodeConfig.command = {};
        }
        (opencodeConfig.command as Record<string, unknown>)['auto-continue'] = {
          template: 'Call the auto_continue tool with enabled=true',
          description:
            'Enable auto-continuation - orchestrator keeps working through incomplete todos',
        };
      }

      presetManager.registerCommand(opencodeConfig);
      usageService?.registerCommand(opencodeConfig);

      // One-time startup summary: log user-installed MCPs (exclude built-in ones already logged at init)
      if (!didLogStartupSummary) {
        didLogStartupSummary = true;

        console.log('\u{1F50C} Loading MCP servers...');
        log('[startup] Loading MCP servers...');

        const allMcpKeys = Object.keys(
          (opencodeConfig.mcp as Record<string, unknown>) ?? builtinMcps,
        );
        const builtinMcpNames = Object.keys(builtinMcps);
        const userMcpKeys = allMcpKeys.filter(
          (key) => !builtinMcpNames.includes(key),
        );
        if (userMcpKeys.length > 0) {
          console.log(`\u{1F50C} MCP servers: ${userMcpKeys.join(', ')}`);
          log(`[startup] MCP servers: ${userMcpKeys.join(', ')}`);
        }

        // Log installed skills (await to ensure it loads before continuing)
        try {
          console.log('\u{1F3AF} Loading skills...');
          log('[startup] Loading skills...');

          const discovery = await getLocalDiscovery(ctx);
          const skillNames = (discovery.skills || [])
            .map((s) => s.name)
            .filter(Boolean);
          if (skillNames.length > 0) {
            console.log(`\u{1F3AF} Skills: ${skillNames.join(', ')}`);
            log(`[startup] Skills: ${skillNames.join(', ')}`);
          }
        } catch (err) {
          log('[startup] Failed to load skills list:', String(err));
        }

        const currentVersion = readPluginVersion();
        if (currentVersion) {
          scheduleVersionDisplay(currentVersion).catch((err) => {
            const versionErrMsg =
              err instanceof Error ? err.message : String(err);
            console.log('  📦 Version check failed:', versionErrMsg);
            log('[version] Version check failed: ' + versionErrMsg);
          });
        }
      }
    },

    event: async (input) => {
      const event = input.event as {
        type: string;
        properties?: {
          info?: {
            id?: string;
            parentID?: string;
            title?: string;
            agent?: string;
            providerID?: string;
            modelID?: string;
            variant?: string;
            sessionID?: string;
            directory?: string;
          };
          sessionID?: string;
          error?: { name?: string };
          status?: { type: string };
          part?: {
            type?: string;
            sessionID?: string;
            tokens?: {
              input?: number;
              output?: number;
              reasoning?: number;
              cache?: { read?: number; write?: number };
            };
          };
          providerID?: string;
          modelID?: string;
        };
      };

      // Handle streaming token updates from step-finish parts
      if (event.type === 'message.part.updated') {
        const part = event.properties?.part as
          | {
              type?: string;
              sessionID?: string;
              tokens?: {
                input?: number;
                output?: number;
                reasoning?: number;
                cache?: { read?: number; write?: number };
              };
            }
          | undefined;

        if (part?.type === 'step-finish' && part?.sessionID && part?.tokens) {
          const input = part.tokens.input ?? 0;
          const output = part.tokens.output ?? 0;
          const reasoning = part.tokens.reasoning ?? 0;
          const cacheRead = part.tokens.cache?.read ?? 0;
          // Don't record cache tokens during streaming - they're cumulative
          // per message and will be correctly summed by the message.updated
          // handler

          if (input > 0 || output > 0 || reasoning > 0 || cacheRead > 0) {
            // Calculate contextUsed from the same components as
            // the sidebar Input + Output rows.
            const streamContextUsed = input + cacheRead + output + reasoning;

            // Look up contextLimit from cache using session's model
            let streamContextLimit = 0;
            const sessionModel = mergedSessionModels(readTuiSnapshot())[
              part.sessionID
            ];
            if (sessionModel) {
              streamContextLimit =
                _modelContextLimitCache.get(sessionModel) ?? 0;
            }

            const streamContextPct =
              streamContextLimit > 0
                ? (streamContextUsed / streamContextLimit) * 100
                : 0;

            recordSessionUsage({
              sessionID: part.sessionID,
              contextUsed: streamContextUsed,
              contextLimit: streamContextLimit,
              contextPct: streamContextPct,
              input,
              output,
              reasoning,
              cacheRead,
              cacheWrite: part.tokens.cache?.write ?? 0,
            });
          }
        }
      }

      if (event.type === 'message.updated') {
        const info = event.properties?.info;
        const sessionIDForTitle =
          (info && typeof info.sessionID === 'string' && info.sessionID) ||
          (typeof event.properties?.sessionID === 'string'
            ? event.properties.sessionID
            : undefined);
        if (
          sessionIDForTitle &&
          info &&
          typeof info.title === 'string' &&
          info.title.trim().length > 0
        ) {
          recordSessionTitle({
            sessionID: sessionIDForTitle,
            title: info.title,
          });
        }
        if (info) {
          const sessionID = info.sessionID ?? event.properties?.sessionID;
          if (sessionID) {
            if (
              typeof info.providerID === 'string' &&
              typeof info.modelID === 'string'
            ) {
              recordSessionModel({
                sessionID,
                model: `${info.providerID}/${info.modelID}`,
              });
            }
            if (typeof info.variant === 'string' && info.variant.trim()) {
              recordSessionVariant({
                sessionID,
                variant: info.variant.trim(),
              });
            }
          }
        }

        const sessionID = info?.sessionID ?? event.properties?.sessionID;
        if (sessionID) {
          try {
            // Fetch messages and extract tokens from last assistant message only
            const messagesResult = await ctx.client.session.messages({
              path: { id: sessionID },
            });
            const allMessages = Array.isArray(messagesResult.data)
              ? messagesResult.data
              : [];
            const assistantMsgs = allMessages.filter(
              (m) =>
                (m as { info?: { role?: string } }).info?.role === 'assistant',
            );

            // Extract tokens from last assistant message only (SDK supplies cumulative values)
            let totalInput = 0;
            let totalOutput = 0;
            let totalReasoning = 0;
            let totalCacheRead = 0;
            let totalCacheWrite = 0;
            let contextLimit = 0;
            let contextUsed = 0;
            let contextPct = 0;

            // Ensure context limit cache is populated before recording usage
            await ensureModelContextLimits(ctx.client).catch(() => {});

            const lastTokenMsg = [...assistantMsgs]
              .reverse()
              .find((m) => readTokenTelemetry(m));
            if (lastTokenMsg) {
              const telemetry = readTokenTelemetry(lastTokenMsg);
              if (telemetry) {
                totalInput = telemetry.input;
                totalOutput = telemetry.output;
                totalReasoning = telemetry.reasoning;
                totalCacheRead = telemetry.cacheRead;
                totalCacheWrite = telemetry.cacheWrite;
                contextLimit = telemetry.contextLimit;
                // Sidebar expects CTX used to match Input + Output tokens.
                // Input row = input + cacheRead
                // Output row = output + reasoning
                contextUsed =
                  telemetry.input +
                  telemetry.cacheRead +
                  telemetry.output +
                  telemetry.reasoning;
                contextPct =
                  contextLimit > 0 ? (contextUsed / contextLimit) * 100 : 0;
              }
            }

            // Fallback: if message didn't provide context limit, look up from
            // cache using the model associated with this session.
            if (contextLimit === 0) {
              const model = mergedSessionModels(readTuiSnapshot())[sessionID];
              const cachedLimit = model
                ? _modelContextLimitCache.get(model)
                : undefined;
              if (cachedLimit && cachedLimit > 0) {
                contextLimit = cachedLimit;
                contextPct = (contextUsed / contextLimit) * 100;
              }
            }

            if (contextUsed > 0 || totalInput > 0 || totalOutput > 0) {
              recordSessionUsage({
                sessionID,
                contextUsed,
                contextLimit,
                contextPct,
                input: totalInput,
                output: totalOutput,
                reasoning: totalReasoning,
                cacheRead: totalCacheRead,
                cacheWrite: totalCacheWrite,
              });
            }
          } catch {
            // Usage telemetry is best-effort for sidebar display.
          }
        }
      }

      if (event.type === 'session.created') {
        const childSessionId = event.properties?.info?.id;
        const parentSessionId = event.properties?.info?.parentID;
        const title = event.properties?.info?.title;
        const directory = event.properties?.info?.directory ?? ctx.directory;
        if (depthTracker && childSessionId && parentSessionId) {
          depthTracker.registerChild(parentSessionId, childSessionId);
        }
        if (childSessionId) {
          recordChildSessionSnapshot({
            sessionID: childSessionId,
            title: title ?? '',
            parentSessionId:
              typeof parentSessionId === 'string' ? parentSessionId : undefined,
            projectPath: directory ? directory : undefined,
          });
        }
      }

      if (event.type === 'session.updated') {
        const info = event.properties?.info;
        const sid =
          (typeof info?.id === 'string' && info.id) ||
          (typeof info?.sessionID === 'string' && info.sessionID) ||
          (typeof event.properties?.sessionID === 'string'
            ? event.properties.sessionID
            : undefined);
        if (
          sid &&
          info &&
          typeof info.title === 'string' &&
          info.title.trim().length > 0
        ) {
          recordSessionTitle({ sessionID: sid, title: info.title });
        }
        if (
          sid &&
          info &&
          typeof info.variant === 'string' &&
          info.variant.trim().length > 0
        ) {
          recordSessionVariant({
            sessionID: sid,
            variant: info.variant.trim(),
          });
        }
      }

      // Todo-continuation: auto-continue orchestrator on incomplete todos
      await todoContinuationHook.handleEvent(input);

      // Handle auto-update checking
      await autoUpdateChecker.event(input);

      // Track session.status to update sidebar status display and
      // active session counts. Non-orchestrator idle means done.
      if (event.type === 'session.status') {
        const statusType = event.properties?.status?.type;
        const sessionID = event.properties?.sessionID;
        if (sessionID && statusType) {
          patchSessionTreeStatusFromOpenCode(sessionID, statusType);
        }
        if (sessionID && statusType === 'idle') {
          if (sessionAgentMap.get(sessionID) === 'orchestrator') {
            // Cascade abort: stop any still-running blocking children
            const snapshot = readTuiSnapshot();
            for (const [childId, child] of Object.entries(
              mergedSessionTree(snapshot),
            )) {
              if (
                child.parentId === sessionID &&
                child.status === 'busy' &&
                child.mode !== 'fire_forget'
              ) {
                ctx.client.session
                  .abort({ path: { id: childId } })
                  .catch(() => {});
              }
            }
            recordSessionNode({
              sessionID,
              agent: 'orchestrator',
              status: 'idle',
            });
            // Trigger OpenCode Go usage data refresh
            usageService?.onOrchestratorIdle();
            // Set finishedAt with a 3-second buffer so the orchestrator's
            // flash timer starts AFTER children have cleared from the tree.
            // Children were just marked idle (recordSessionDone) and need
            // FLASH_DURATION_MS+1s to flash out. The orchestrator shows a
            // spinner while children are visible, then flashes after they clear.
            updateSnapshot((s) => {
              for (const bundle of Object.values(s.sessions)) {
                const node = bundle.tree[sessionID];
                if (node) {
                  node.finishedAt = Date.now() + 3000;
                  bundle.lastActivityAt = Date.now();
                }
              }
            });
            const storeNode = sessionTreeStore[sessionID];
            if (storeNode) storeNode.finishedAt = Date.now() + 3000;
          } else {
            recordSessionEnd(sessionID);
            recordSessionDone(sessionID);
          }
        }
      }

      await taskSessionManagerHook.event(
        input as {
          event: {
            type: string;
            properties?: { info?: { id?: string }; sessionID?: string };
          };
        },
      );

      if (event.type === 'session.deleted') {
        const sessionID =
          event.properties?.info?.id ?? event.properties?.sessionID;
        if (sessionID) {
          recordSessionEnd(sessionID);
          recordSessionDone(sessionID);
          deleteSessionEntries(sessionID);
          if (depthTracker) depthTracker.cleanup(sessionID);
          deletingSessions.delete(sessionID);
        }
      }
    },

    // Best-effort rescue only for stale apply_patch input before native
    // execution
    'tool.execute.before': async (input, output) => {
      await applyPatchHook['tool.execute.before'](
        input as {
          tool: string;
          directory?: string;
        },
        output as {
          args?: { patchText?: unknown; [key: string]: unknown };
        },
      );

      await taskSessionManagerHook['tool.execute.before'](
        input as {
          tool: string;
          sessionID?: string;
          callID?: string;
        },
        output as { args?: unknown },
      );
    },

    // Direct interception of /auto-continue command - bypasses LLM
    // round-trip
    'command.execute.before': async (input, output) => {
      await todoContinuationHook.handleCommandExecuteBefore(
        input as {
          command: string;
          sessionID: string;
          arguments: string;
        },
        output as { parts: Array<{ type: string; text?: string }> },
      );

      await presetManager.handleCommandExecuteBefore(
        input as {
          command: string;
          sessionID: string;
          arguments: string;
        },
        output as { parts: Array<{ type: string; text?: string }> },
      );

      await usageService?.handleCommandExecuteBefore(
        input as {
          command: string;
          sessionID: string;
          arguments: string;
        },
        output as { parts: Array<{ type: string; text?: string }> },
      );
    },

    'chat.headers': chatHeadersHook['chat.headers'],

    // Track which agent each session uses (needed for serve-mode prompt
    // injection)
    'chat.message': async (
      input: {
        sessionID: string;
        agent?: string;
        model?: { providerID: string; modelID: string };
        variant?: string;
      },
      output?: { message?: { agent?: string } },
    ) => {
      const rawAgent = input.agent ?? output?.message?.agent;
      const agent = rawAgent
        ? resolveRuntimeAgentName(config, rawAgent)
        : undefined;

      if (
        agent &&
        output?.message &&
        typeof output.message.agent === 'string'
      ) {
        output.message.agent = agent;
      }

      if (agent) {
        sessionAgentMap.set(input.sessionID, agent);
        recordSessionProject({
          sessionID: input.sessionID,
          projectPath: ctx.directory,
        });
        if (input.model) {
          recordSessionModel({
            sessionID: input.sessionID,
            model: `${input.model.providerID}/${input.model.modelID}`,
          });
        }
        if (typeof input.variant === 'string') {
          recordSessionVariant({
            sessionID: input.sessionID,
            variant: input.variant,
          });
        }
        if (agent) {
          recordSessionNode({
            sessionID: input.sessionID,
            agent,
            model: input.model
              ? `${input.model.providerID}/${input.model.modelID}`
              : undefined,
            variant: input.variant,
            status: 'busy',
          });
        }
      }
      todoContinuationHook.handleChatMessage({
        sessionID: input.sessionID,
        agent,
      });
    },

    // Inject orchestrator system prompt for serve-mode sessions. In serve
    // mode, the agent's prompt field may be absent from the agents
    // registry (built before plugin config hooks run). This hook injects
    // it at LLM call time. Uses the already-resolved prompt from
    // agentDefs (which has custom replacement or append prompts applied)
    // instead of rebuilding the default.
    'experimental.chat.system.transform': async (
      input: { sessionID?: string },
      output: { system: string[] },
    ): Promise<void> => {
      const agentName = input.sessionID
        ? sessionAgentMap.get(input.sessionID)
        : undefined;
      if (agentName === 'orchestrator') {
        const alreadyInjected = output.system.some(
          (s) =>
            typeof s === 'string' &&
            s.includes('<Role>') &&
            s.includes('orchestrator'),
        );
        if (!alreadyInjected) {
          // Prepend the orchestrator prompt to the system array. Use the
          // resolved prompt from the orchestrator agent definition (which
          // includes any custom replacement or append from orchestrator.md
          // / orchestrator_append.md) Fall back to
          // buildOrchestratorPrompt only if the resolved prompt is
          // missing.
          const orchestratorDef = agentDefs.find(
            (a) => a.name === 'orchestrator',
          );
          const orchestratorPrompt =
            typeof orchestratorDef?.config?.prompt === 'string'
              ? orchestratorDef.config.prompt
              : buildOrchestratorPrompt();
          output.system[0] =
            orchestratorPrompt +
            (output.system[0] ? `\n\n${output.system[0]}` : '');
        }
      }

      // Collapse to single system message for provider compatibility.
      // Some providers (e.g. Qwen via VLLM/DashScope) reject multiple
      // system messages. Sub-hooks above may push additional entries; join
      // them back into one element so OpenCode emits a single system
      // message.
      collapseSystemInPlace(output.system);
    },

    // Inject phase reminder and filter available skills before sending to
    // API (doesn't show in UI)
    'experimental.chat.messages.transform': async (
      input: Record<string, never>,
      output: { messages: unknown[] },
    ): Promise<void> => {
      // Type assertion since we know the structure matches
      // MessageWithParts[]
      const typedOutput = output as {
        messages: Array<{
          info: { role: string; agent?: string; sessionID?: string };
          parts: Array<{
            type: string;
            text?: string;
            [key: string]: unknown;
          }>;
        }>;
      };

      const hasUserTurn = typedOutput.messages.some(
        (message) => message.info.role === 'user',
      );
      if (hasUserTurn) {
        // After the user submits, session.status reliably reflects OpenCode -
        // better than reconciling once at startup (empty/partial snapshots).
        // Await so context telemetry is fresh for hooks (e.g. /compact reminder).
        await reconcileSessions();
      }

      for (const message of typedOutput.messages) {
        if (message.info.role !== 'user') {
          continue;
        }
        for (const part of message.parts) {
          if (part.type !== 'text' || typeof part.text !== 'string') {
            continue;
          }
          part.text = rewriteDisplayNameMentions(part.text);
        }
      }

      processImageAttachments();

      await todoContinuationHook.handleMessagesTransform({
        messages: typedOutput.messages,
      });
      await taskSessionManagerHook['experimental.chat.messages.transform'](
        input,
        typedOutput,
      );
      await contextPressureReminderHook['experimental.chat.messages.transform'](
        input,
        typedOutput,
      );
      await phaseReminderHook['experimental.chat.messages.transform'](
        input,
        typedOutput,
      );
      await filterAvailableSkillsHook['experimental.chat.messages.transform'](
        input,
        typedOutput,
      );
    },

    // Post-tool hooks: retry guidance for delegation errors + file-tool
    // nudge
    'tool.execute.after': async (input, output) => {
      await delegateTaskRetryHook['tool.execute.after'](
        input as { tool: string },
        output as { output: unknown },
      );

      await jsonErrorRecoveryHook['tool.execute.after'](
        input as {
          tool: string;
          sessionID: string;
          callID: string;
        },
        output as {
          title: string;
          output: unknown;
          metadata: unknown;
        },
      );

      await todoContinuationHook.handleToolExecuteAfter(
        input as {
          tool: string;
          sessionID?: string;
        },
        output as { output?: unknown },
      );

      await postFileToolNudgeHook['tool.execute.after'](
        input as {
          tool: string;
          sessionID?: string;
          callID?: string;
        },
        output as {
          title: string;
          output: string;
          metadata: Record<string, unknown>;
        },
      );

      await taskSessionManagerHook['tool.execute.after'](
        input as {
          tool: string;
          sessionID?: string;
          callID?: string;
        },
        output as { output: unknown },
      );
    },
  };
};

export default OpenCodeDux;

export type {
  AgentName,
  AgentOverrideConfig,
  PluginConfig,
} from './config';
export type { RemoteMcpConfig } from './mcp';
