import type { ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import type { AgentName, PluginConfig } from '../config';
import { ALL_AGENT_NAMES } from '../config/constants';
import { getAgentOverride } from '../config/utils';
import {
  recordDelegatedSubagentSession,
  recordSessionDone,
} from '../tui-state';
import { resolveRuntimeAgentName } from '../utils';
import {
  extractArtifactPathsFromPrompt,
  type HandoffArtifactStore,
  summarizeArtifactOutput,
} from '../utils/handoff-artifacts';
import {
  extractAssistantTextAfterPrompt,
  extractLatestUserImageParts,
  extractSessionResult,
  normalizeImagePartsForChildPrompt,
  type PromptBody,
  type PromptBodyPart,
  parseModelReference,
  promptWithTimeout,
} from '../utils/session';
import type { SubagentDepthTracker } from '../utils/subagent-depth';

/**
 * Scoped mutex for serializing only the blocking subagent cases that mutate the
 * shared workspace or must remain single-threaded per parent session.
 */
class ScopedBlockingMutex {
  private currentByKey = new Map<string, Promise<void>>();
  private resolveByKey = new Map<string, () => void>();

  async acquire(key: string): Promise<void> {
    while (this.currentByKey.has(key)) {
      await this.currentByKey.get(key);
    }

    this.currentByKey.set(
      key,
      new Promise<void>((resolve) => {
        this.resolveByKey.set(key, resolve);
      }),
    );
  }

  release(key: string): void {
    const resolve = this.resolveByKey.get(key);
    this.currentByKey.delete(key);
    this.resolveByKey.delete(key);
    resolve?.();
  }
}

const blockingMutex = new ScopedBlockingMutex();

/**
 * When true, blocking `delegate_subagent` keeps the child session open and
 * appends `<delegate_session_continue .../>` for `continue_session_id` flows.
 */
export function subagentOutputRequestsUserHandoff(text: string): boolean {
  return text.includes('<needs_user>');
}

type OpencodeClient = import('@opencode-ai/plugin').PluginInput['client'];
type SubagentRuntimeName = Exclude<AgentName, 'orchestrator'>;
type DelegationTaskInput = {
  agent: string;
  prompt: string;
  variant: (typeof VARIANT_OPTIONS)[number];
  model?: string;
  continue_session_id?: string;
};

const VARIANT_OPTIONS = ['low', 'medium', 'high', 'max'] as const;
const MODE_OPTIONS = ['blocking', 'fire_forget'] as const;
const INLINE_SECTION_TAGS_BY_AGENT = {
  oracle: ['plan'],
  designer: ['design_plan', 'implementation_notes'],
  fixer: ['summary', 'verification'],
} as const;
const SERIAL_BLOCKING_AGENTS = new Set<SubagentRuntimeName>([
  'fixer',
  'steward',
]);

const PARALLEL_FIXER_PROTOCOL_BLOCK = `<parallel_fixer_batch>
This fixer run is part of a parallel implementation batch.
- Implement ONLY the assigned scope. Assume sibling fixer sessions may be editing other files at the same time.
- Do NOT run repo-wide, integration, or end-to-end validation that can race sibling fixer sessions.
- Prefer the smallest local sanity check that is safe for your scoped files.
- In <verification>, explicitly state what you verified locally and that final integrated validation is deferred to the orchestrator after all fixer sessions are collected.
</parallel_fixer_batch>`;
const BLOCKING_FIXER_BATCH_WINDOW_MS = 75;
const FIRE_FORGET_COMPLETION_TIMEOUT_MS = 15 * 60 * 1000;
const COLLECT_RESULT_RETRY_DELAY_MS = 200;
const COLLECT_RESULT_MAX_RETRIES = 5;

type CompletionTracker = {
  promise: Promise<void>;
  resolve: () => void;
  terminal: boolean;
};

type PendingBlockingFixerRequest = {
  args: DelegationTaskInput & {
    mode?: 'blocking' | 'fire_forget';
  };
  resolve: (result: string) => void;
  reject: (error: unknown) => void;
};

type PendingBlockingFixerBatch = {
  requests: PendingBlockingFixerRequest[];
  timer?: ReturnType<typeof setTimeout>;
  flushing: boolean;
};

const fireForgetCompletionTrackers = new Map<string, CompletionTracker>();

function isTerminalSessionStatus(statusType: string | undefined): boolean {
  return (
    statusType === 'idle' ||
    statusType === 'completed' ||
    statusType === 'error'
  );
}

function ensureFireForgetCompletionTracker(
  sessionId: string,
): CompletionTracker {
  const existing = fireForgetCompletionTrackers.get(sessionId);
  if (existing) {
    return existing;
  }

  let resolvePromise = () => {};
  const tracker: CompletionTracker = {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: () => {
      tracker.terminal = true;
      resolvePromise();
    },
    terminal: false,
  };
  fireForgetCompletionTrackers.set(sessionId, tracker);
  return tracker;
}

function clearFireForgetCompletionTracker(sessionId: string): void {
  fireForgetCompletionTrackers.delete(sessionId);
}

export function notifyDelegatedSessionStatus(
  sessionId: string,
  statusType: string | undefined,
): void {
  if (!isTerminalSessionStatus(statusType)) {
    return;
  }

  const tracker = fireForgetCompletionTrackers.get(sessionId);
  if (!tracker || tracker.terminal) {
    return;
  }
  tracker.resolve();
}

export function notifyDelegatedSessionDeleted(sessionId: string): void {
  const tracker = fireForgetCompletionTrackers.get(sessionId);
  if (!tracker || tracker.terminal) {
    return;
  }
  tracker.resolve();
}

async function waitForFireForgetCompletion(
  sessionId: string,
  timeoutMs: number,
): Promise<boolean> {
  const tracker = fireForgetCompletionTrackers.get(sessionId);
  if (!tracker) {
    return false;
  }
  if (tracker.terminal) {
    return true;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      tracker.promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }

  return tracker.terminal;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractXmlSection(text: string, tagName: string): string | undefined {
  const match = text.match(
    new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'),
  );
  return match?.[0];
}

function collectInlineSections(agentName: string, text: string): string[] {
  const sections: string[] = [];
  for (const tagName of ['needs_user', 'blocked']) {
    const section = extractXmlSection(text, tagName);
    if (section) {
      sections.push(section);
    }
  }

  const extraTags =
    INLINE_SECTION_TAGS_BY_AGENT[
      agentName as keyof typeof INLINE_SECTION_TAGS_BY_AGENT
    ] ?? [];
  for (const tagName of extraTags) {
    const section = extractXmlSection(text, tagName);
    if (section) {
      sections.push(section);
    }
  }

  return sections;
}

type ImplementationAuthorization = {
  status?: string;
  source?: string;
  evidence?: string;
};

function extractXmlTagBody(text: string, tagName: string): string | undefined {
  const match = text.match(
    new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'),
  );
  return match?.[1]?.trim();
}

function parseImplementationAuthorization(
  promptText: string,
): ImplementationAuthorization | undefined {
  const body = extractXmlTagBody(promptText, 'implementation_authorization');
  if (!body) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body) as ImplementationAuthorization;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function validateFixerAuthorization(promptText: string): string | undefined {
  const authorization = parseImplementationAuthorization(promptText);
  if (!authorization) {
    return (
      'Error: New @fixer delegations require <implementation_authorization> ' +
      'with raw JSON indicating either {"status":"approved"} for explicit user approval ' +
      'or {"status":"mechanical_exception"} when the full mechanical edit exception applies.'
    );
  }

  if (
    authorization.status !== 'approved' &&
    authorization.status !== 'mechanical_exception'
  ) {
    return (
      'Error: <implementation_authorization> must use status ' +
      '"approved" or "mechanical_exception" for new @fixer delegations.'
    );
  }

  return undefined;
}

function determineArtifactStatus(
  text: string,
  mode: 'blocking' | 'fire_forget',
): 'completed' | 'blocked' | 'needs_user' | 'collected' {
  if (text.includes('<needs_user>')) {
    return 'needs_user';
  }
  if (text.includes('<blocked>')) {
    return 'blocked';
  }
  return mode === 'fire_forget' ? 'collected' : 'completed';
}

function buildSummaryLine(
  agentName: string,
  status: 'completed' | 'blocked' | 'needs_user' | 'collected' | 'open',
  text: string,
): string {
  if (status === 'needs_user') {
    return `${agentName} needs user clarification.`;
  }
  if (status === 'blocked') {
    return `${agentName} is blocked and recorded the blocker in the artifact.`;
  }
  if (status === 'open') {
    return `${agentName} launched in the background.`;
  }
  const preview = summarizeArtifactOutput(text);
  return preview || `${agentName} completed and saved an artifact.`;
}

function buildCompactEnvelope(input: {
  agentName: string;
  variant?: string;
  childSessionId: string;
  artifactPath: string;
  indexPath: string;
  summaryLine: string;
  inlineSections: string[];
  continueSessionId?: string;
}): string {
  const lines = [
    `**${input.agentName}** (variant: ${input.variant ?? 'default'})`,
    `- Session ID: ${input.childSessionId}`,
    `- Artifact: ${input.artifactPath}`,
    `- Orchestrator index: ${input.indexPath}`,
    `- Summary: ${input.summaryLine}`,
  ];

  if (input.inlineSections.length > 0) {
    lines.push('', ...input.inlineSections);
  }

  if (input.continueSessionId) {
    lines.push(
      '',
      `<delegate_session_continue session_id="${input.continueSessionId}" agent="${input.agentName}" />`,
    );
  }

  return lines.join('\n');
}

async function extractAssistantTextAfterCompletionSignal(
  client: OpencodeClient,
  sessionId: string,
  workspaceDirectory: string,
): Promise<{ text: string; empty: boolean }> {
  let result = await extractSessionResult(client, sessionId, {
    includeReasoning: false,
    directory: workspaceDirectory,
  });

  for (
    let attempt = 0;
    attempt < COLLECT_RESULT_MAX_RETRIES && result.empty;
    attempt++
  ) {
    await delay(COLLECT_RESULT_RETRY_DELAY_MS);
    result = await extractSessionResult(client, sessionId, {
      includeReasoning: false,
      directory: workspaceDirectory,
    });
  }

  if (result.empty) {
    result = await extractSessionResult(client, sessionId, {
      includeReasoning: true,
      directory: workspaceDirectory,
    });
  }

  return result;
}

function buildBatchEnvelope(
  mode: 'blocking' | 'fire_forget',
  taskCount: number,
  results: string[],
): string {
  return [
    `## Delegation Batch`,
    `- Mode: ${mode}`,
    `- Tasks: ${taskCount}`,
    '',
    ...results.flatMap((result, index) =>
      index === 0 ? [result] : ['', result],
    ),
  ].join('\n');
}

function buildScopedBlockingKey(
  parentSessionId: string,
  agentName: SubagentRuntimeName,
): string | undefined {
  if (!SERIAL_BLOCKING_AGENTS.has(agentName)) {
    return undefined;
  }

  return `${parentSessionId}:${agentName}`;
}

export function resolveDelegatedAgentConfig(
  config: PluginConfig | undefined,
  agentName: string,
  requested: {
    model?: string;
    variant?: string;
  },
): {
  model?: string;
  variant?: string;
} {
  const agentOverride = getAgentOverride(config, agentName);

  return {
    model: requested.model ?? agentOverride?.model,
    variant: agentOverride?.variant ?? requested.variant,
  };
}

export function createDelegateTools(
  ctx: { client: OpencodeClient; directory: string },
  config: PluginConfig | undefined,
  depthTracker: SubagentDepthTracker | undefined,
  artifactStore: HandoffArtifactStore,
): Record<string, ToolDefinition> {
  const directory = ctx.directory;

  const subagentOptions: readonly string[] = [
    ...ALL_AGENT_NAMES.filter((name) => name !== 'orchestrator'),
  ];
  const batchTaskSchema = tool.schema.object({
    agent: tool.schema.string().describe('Target specialist subagent'),
    prompt: tool.schema
      .string()
      .describe('Detailed task description for the subagent'),
    variant: tool.schema
      .enum(VARIANT_OPTIONS)
      .describe(
        'Reasoning depth: low (simple), medium (typical), high (complex), max (critical)',
      ),
    model: tool.schema
      .string()
      .optional()
      .describe(
        'Override the subagent model. Pass for @oracle when you selected a specific model (flash vs pro).',
      ),
    continue_session_id: tool.schema
      .string()
      .optional()
      .describe(
        'Blocking only: resume the same child session after <needs_user>.',
      ),
  });
  type DelegationRequest = DelegationTaskInput & {
    mode?: 'blocking' | 'fire_forget';
  };
  const pendingBlockingFixerBatches = new Map<
    string,
    PendingBlockingFixerBatch
  >();

  function recordSessionTree(
    sessionId: string,
    parentSessionId: string,
    agent: string,
    variant?: string,
    mode?: 'blocking' | 'fire_forget',
  ): void {
    recordDelegatedSubagentSession({
      sessionID: sessionId,
      parentSessionId,
      agent,
      variant,
      mode,
    });
  }

  async function runAgentSession(options: {
    parentSessionId: string;
    title: string;
    agent: string;
    model: string;
    variant: string | undefined;
    promptText: string;
    timeout: number;
    promptParts?: PromptBodyPart[];
    /** Resume an open child session after a needs_user handoff; skips create */
    continueSessionId?: string;
  }): Promise<{ text: string; sessionId: string; openSessionId?: string }> {
    const modelRef = parseModelReference(options.model);
    if (!modelRef) {
      throw new Error(`Invalid model format: ${options.model}`);
    }

    let sessionId: string | undefined;
    let keepChildSessionOpen = false;
    const isContinuation = Boolean(options.continueSessionId?.trim());

    try {
      if (isContinuation) {
        sessionId = options.continueSessionId?.trim();
        if (!sessionId) {
          throw new Error('continue_session_id was empty');
        }
      } else {
        const session = await ctx.client.session.create({
          body: {
            parentID: options.parentSessionId,
            title: options.title,
          },
          query: { directory },
        });

        if (!session.data?.id) {
          throw new Error('Failed to create session');
        }

        sessionId = session.data.id;

        recordSessionTree(
          sessionId,
          options.parentSessionId,
          options.agent,
          options.variant,
          'blocking',
        );

        if (depthTracker) {
          const registered = depthTracker.registerChild(
            options.parentSessionId,
            sessionId,
          );
          if (!registered) {
            throw new Error('Subagent depth exceeded');
          }
        }
      }

      if (!sessionId) {
        throw new Error('Failed to obtain subagent session id');
      }

      const parts: PromptBodyPart[] = options.promptParts?.length
        ? [...options.promptParts, { type: 'text', text: options.promptText }]
        : [{ type: 'text', text: options.promptText }];

      const body: PromptBody = {
        agent: options.agent,
        model: modelRef,
        tools: { task: false },
        parts,
      };

      if (options.variant) {
        body.variant = options.variant;
      }

      await promptWithTimeout(
        ctx.client,
        {
          path: { id: sessionId },
          body,
          query: { directory },
        },
        options.timeout,
      );

      const extraction = await extractAssistantTextAfterPrompt(
        ctx.client,
        sessionId,
        directory,
      );

      if (extraction.empty) {
        throw new Error('Empty response from provider');
      }

      const text = extraction.text;
      if (subagentOutputRequestsUserHandoff(text)) {
        keepChildSessionOpen = true;
        return { text, sessionId, openSessionId: sessionId };
      }

      recordSessionDone(sessionId);
      return { text, sessionId };
    } finally {
      if (sessionId && !keepChildSessionOpen) {
        try {
          await Promise.race([
            ctx.client.session.abort({ path: { id: sessionId } }),
            new Promise((r) => setTimeout(r, 2000)),
          ]);
        } catch {
          /* abort may fail if session already disposed */
        }
        if (depthTracker) {
          depthTracker.cleanup(sessionId);
        }
      }
    }
  }

  async function flushPendingBlockingFixerBatch(
    parentSessionId: string,
  ): Promise<void> {
    const batch = pendingBlockingFixerBatches.get(parentSessionId);
    if (!batch || batch.flushing) {
      return;
    }

    batch.flushing = true;
    if (batch.timer) {
      clearTimeout(batch.timer);
    }
    pendingBlockingFixerBatches.delete(parentSessionId);

    const requests = batch.requests.splice(0);
    const parallelFixerBatch = requests.length > 1;

    await Promise.all(
      requests.map(async (request) => {
        try {
          const result = await executeDelegationRequest(
            request.args,
            parentSessionId,
            { parallelBlockingFixerBatch: parallelFixerBatch },
          );
          request.resolve(result);
        } catch (error) {
          request.reject(error);
        }
      }),
    );
  }

  function queueBlockingFixerRequest(
    args: DelegationRequest,
    parentSessionId: string,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const existingBatch = pendingBlockingFixerBatches.get(parentSessionId);
      if (existingBatch) {
        existingBatch.requests.push({ args, resolve, reject });
        return;
      }

      const batch: PendingBlockingFixerBatch = {
        requests: [{ args, resolve, reject }],
        flushing: false,
      };
      batch.timer = setTimeout(() => {
        flushPendingBlockingFixerBatch(parentSessionId).catch((error) => {
          for (const request of batch.requests.splice(0)) {
            request.reject(error);
          }
        });
      }, BLOCKING_FIXER_BATCH_WINDOW_MS);
      pendingBlockingFixerBatches.set(parentSessionId, batch);
    });
  }

  async function executeDelegationRequest(
    args: DelegationRequest,
    parentSessionId: string,
    options?: { parallelBlockingFixerBatch?: boolean },
  ): Promise<string> {
    const normalizedAgentName = resolveRuntimeAgentName(
      config,
      String(args.agent),
    );
    if (
      normalizedAgentName === 'orchestrator' ||
      !subagentOptions.includes(normalizedAgentName)
    ) {
      return `Error: Unknown subagent "${String(args.agent)}". Use one of: ${subagentOptions.join(', ')}`;
    }
    const agentName = normalizedAgentName as SubagentRuntimeName;
    const variant = args.variant;
    const mode = args.mode ?? 'blocking';
    const continueSessionId = args.continue_session_id?.trim() || undefined;
    const parallelBlockingFixerBatch =
      options?.parallelBlockingFixerBatch === true;

    if (continueSessionId && mode === 'fire_forget') {
      return 'Error: continue_session_id is only valid for blocking delegate_subagent (omit mode or mode: blocking).';
    }

    if (agentName === 'steward' && mode === 'fire_forget') {
      return 'Error: @steward must always run in blocking mode. Its repo rule citations are required input for all downstream agents (@oracle, @fixer, @designer). Use mode: "blocking" (or omit mode).';
    }

    const resolvedConfig = resolveDelegatedAgentConfig(config, agentName, {
      model: args.model,
      variant,
    });
    const effectiveVariant = resolvedConfig.variant;
    const model = resolvedConfig.model;

    if (!model) {
      return `Error: No model configured for agent "${agentName}"`;
    }

    const referencedArtifactPaths = extractArtifactPathsFromPrompt(args.prompt);
    const upstreamArtifactContext = artifactStore.formatForDelegation(
      parentSessionId,
      {
        excludeChildSessionId: continueSessionId || undefined,
        targetAgent: agentName,
        explicitPaths: referencedArtifactPaths,
      },
    );
    const promptPreamble: string[] = [];
    if (
      agentName === 'fixer' &&
      (mode === 'fire_forget' || parallelBlockingFixerBatch)
    ) {
      promptPreamble.push(PARALLEL_FIXER_PROTOCOL_BLOCK);
    }
    if (upstreamArtifactContext) {
      promptPreamble.push(upstreamArtifactContext);
    }
    promptPreamble.push(args.prompt);
    const effectivePrompt = promptPreamble.join('\n\n');

    if (agentName === 'fixer' && !continueSessionId) {
      const authorizationError = validateFixerAuthorization(effectivePrompt);
      if (authorizationError) {
        return authorizationError;
      }
    }

    if (
      agentName === 'fixer' &&
      mode === 'blocking' &&
      !continueSessionId &&
      !parallelBlockingFixerBatch
    ) {
      try {
        const session = await ctx.client.session.create({
          body: {
            parentID: parentSessionId,
            title: `${agentName} (${effectiveVariant ?? 'default'})`,
          },
          query: { directory },
        });

        if (!session.data?.id) {
          return 'Error: Failed to create session';
        }

        const sessionId = session.data.id;
        recordSessionTree(
          sessionId,
          parentSessionId,
          agentName,
          effectiveVariant,
          'blocking',
        );

        if (depthTracker) {
          const registered = depthTracker.registerChild(
            parentSessionId,
            sessionId,
          );
          if (!registered) {
            return 'Error: Subagent depth exceeded';
          }
        }

        return queueBlockingFixerRequest(
          {
            ...args,
            continue_session_id: sessionId,
          },
          parentSessionId,
        );
      } catch (err) {
        return `Error launching ${agentName}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    let frameImageParts: PromptBodyPart[] = [];
    if (agentName === 'interpreter' && !continueSessionId) {
      const rawFrameParts = await extractLatestUserImageParts(
        ctx.client,
        parentSessionId,
        directory,
      );
      frameImageParts = normalizeImagePartsForChildPrompt(
        rawFrameParts,
        directory,
      );

      if (rawFrameParts.length > 0 && frameImageParts.length === 0) {
        return (
          'Error: delegate_subagent(agent: "interpreter") saw image-related parts on the latest user message but could not build a child prompt ' +
          '(no usable `url` and no resolvable `source.path` for a file attachment). ' +
          'Try saving the image into the workspace and attaching it as a file, or check OpenCode attachment storage.'
        );
      }

      if (frameImageParts.length === 0) {
        return (
          'Error: delegate_subagent(agent: "interpreter") found no image attachment parts on the latest user message. ' +
          'OpenCode stores screenshots as parts with type `file` and mime `image/*` (not type `image`). ' +
          'If the UI shows placeholders like [Image N] or “img clipboard” in text but this error appears, the session API did not receive file parts - try attaching through the image control, or check OpenCode/provider issues for clipboard vs file attachment.'
        );
      }
    }

    function partsForPrompt(promptText: string): PromptBodyPart[] {
      return frameImageParts.length > 0
        ? [...frameImageParts, { type: 'text', text: promptText }]
        : [{ type: 'text', text: promptText }];
    }

    if (mode === 'fire_forget') {
      const modelRef = parseModelReference(model);
      if (!modelRef) {
        return `Error: Invalid model format: ${model}`;
      }

      try {
        const session = await ctx.client.session.create({
          body: {
            parentID: parentSessionId,
            title: `${agentName} (${effectiveVariant ?? 'default'})`,
          },
          query: { directory },
        });

        if (!session.data?.id) {
          return 'Error: Failed to create session';
        }

        const sessionId = session.data.id;
        ensureFireForgetCompletionTracker(sessionId);
        const seededArtifact = artifactStore.seedArtifact({
          agent: agentName,
          childSessionId: sessionId,
          parentSessionId,
          model,
          variant: effectiveVariant,
          mode: 'fire_forget',
          purpose: args.prompt,
          promptText: effectivePrompt,
          referencedArtifactPaths,
        });
        artifactStore.markStatus(sessionId, 'open');

        recordSessionTree(
          sessionId,
          parentSessionId,
          agentName,
          effectiveVariant,
          'fire_forget',
        );

        if (depthTracker) {
          depthTracker.registerChild(parentSessionId, sessionId);
        }

        const promptBody: PromptBody = {
          agent: agentName,
          model: modelRef,
          tools: { task: false },
          parts: partsForPrompt(effectivePrompt),
        };

        if (effectiveVariant) {
          promptBody.variant = effectiveVariant;
        }

        ctx.client.session
          .prompt({
            path: { id: sessionId },
            body: promptBody,
            query: { directory },
          })
          .catch(() => {});

        return buildCompactEnvelope({
          agentName,
          variant: effectiveVariant,
          childSessionId: sessionId,
          artifactPath: seededArtifact.artifactPath,
          indexPath: seededArtifact.indexPath,
          summaryLine: `${buildSummaryLine(agentName, 'open', '')} Collect with delegate_collect(session_id: "${sessionId}")`,
          inlineSections: [],
        });
      } catch (err) {
        return `Error launching ${agentName}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const blockingKey = parallelBlockingFixerBatch
      ? undefined
      : buildScopedBlockingKey(parentSessionId, agentName);
    if (blockingKey) {
      await blockingMutex.acquire(blockingKey);
    }
    try {
      const runResult = await runAgentSession({
        parentSessionId,
        title: `${agentName} (${effectiveVariant ?? 'default'})`,
        agent: agentName,
        model,
        variant: effectiveVariant,
        promptText: effectivePrompt,
        timeout: 0,
        promptParts: frameImageParts.length > 0 ? frameImageParts : undefined,
        continueSessionId,
      });
      const seededArtifact = artifactStore.seedArtifact({
        agent: agentName,
        childSessionId: runResult.sessionId,
        parentSessionId,
        model,
        variant: effectiveVariant,
        mode: 'blocking',
        purpose: args.prompt,
        promptText: effectivePrompt,
        referencedArtifactPaths,
      });
      const inlineSections = collectInlineSections(agentName, runResult.text);
      const status = determineArtifactStatus(runResult.text, 'blocking');
      const artifactResult =
        artifactStore.appendTurn({
          childSessionId: runResult.sessionId,
          outputText: runResult.text,
          inlineSections,
          status,
        }) ?? seededArtifact;

      return buildCompactEnvelope({
        agentName,
        variant: effectiveVariant,
        childSessionId: runResult.sessionId,
        artifactPath: artifactResult.artifactPath,
        indexPath: artifactResult.indexPath,
        summaryLine: buildSummaryLine(agentName, status, runResult.text),
        inlineSections,
        continueSessionId: runResult.openSessionId,
      });
    } catch (err) {
      return `Error running ${agentName} (variant: ${effectiveVariant ?? 'default'}): ${
        err instanceof Error ? err.message : String(err)
      }`;
    } finally {
      if (blockingKey) {
        blockingMutex.release(blockingKey);
      }
    }
  }

  const delegateSubagent: ToolDefinition = tool({
    description:
      'Delegate a task to a specialist subagent with explicit variant control. ' +
      'Always specify variant based on task complexity. ' +
      'Blocking mode waits for the result; fire_forget returns a session_id to collect later. ' +
      'If the result includes <delegate_session_continue/>, the child session stayed open for ' +
      'continue_session_id (same transcript after user clarification).',
    args: {
      agent: tool.schema
        .enum(subagentOptions)
        .describe('Target specialist subagent'),
      prompt: tool.schema
        .string()
        .describe('Detailed task description for the subagent'),
      variant: tool.schema
        .enum(VARIANT_OPTIONS)
        .describe(
          'Reasoning depth: low (simple), medium (typical), high (complex), max (critical)',
        ),
      mode: tool.schema
        .enum(MODE_OPTIONS)
        .optional()
        .describe(
          'blocking (default) waits for result; fire_forget returns session_id immediately',
        ),
      model: tool.schema
        .string()
        .optional()
        .describe(
          'Override the subagent model. Pass for @oracle when you selected a specific model (flash vs pro).',
        ),
      continue_session_id: tool.schema
        .string()
        .optional()
        .describe(
          'Blocking only: resume the same child session after <needs_user>. Use session_id from <delegate_session_continue> in the prior delegate_subagent result (same agent, model, variant).',
        ),
    },
    execute: async (args, context) =>
      executeDelegationRequest(args, context.sessionID),
  });

  const delegateSubagents: ToolDefinition = tool({
    description:
      'Delegate multiple independent tasks to specialist subagents in one batch. ' +
      'Use this when you need true parallel fan-out inside a single tool call. ' +
      'Blocking mode waits for every child result and returns all envelopes together. ' +
      'Fire_forget launches every child and returns session ids to collect later.',
    args: {
      tasks: tool.schema
        .array(batchTaskSchema)
        .describe(
          'Independent delegation tasks. Keep scopes disjoint for fixer work; explorer/librarian read-only tasks may overlap.',
        ),
      mode: tool.schema
        .enum(MODE_OPTIONS)
        .optional()
        .describe(
          'blocking (default) waits for every task; fire_forget launches all tasks and returns session_ids immediately',
        ),
    },
    execute: async (args, context) => {
      const mode = (args.mode ?? 'blocking') as 'blocking' | 'fire_forget';
      const tasks = args.tasks as DelegationTaskInput[];

      if (tasks.length === 0) {
        return 'Error: delegate_subagents requires at least one task.';
      }
      if (tasks.length > 8) {
        return 'Error: delegate_subagents supports at most 8 tasks per batch.';
      }

      const stewardCount = tasks.filter(
        (task) =>
          resolveRuntimeAgentName(config, String(task.agent)) === 'steward',
      ).length;
      if (stewardCount > 0) {
        if (mode === 'fire_forget') {
          return 'Error: @steward must always run in blocking mode.';
        }
        if (tasks.length > 1) {
          return 'Error: @steward must run alone. Do not batch it with other subagents.';
        }
      }

      const results = await Promise.all(
        tasks.map((task) =>
          executeDelegationRequest(
            {
              ...task,
              mode,
            },
            context.sessionID,
          ),
        ),
      );

      return buildBatchEnvelope(mode, tasks.length, results);
    },
  });

  // Track already-collected sessions to prevent duplicate collection spam
  const alreadyCollected = new Set<string>();

  // Rate limit status API calls per session
  const lastCollectAttempt = new Map<string, number>();
  const COLLECT_COOLDOWN_MS = 5_000; // 5 second cooldown

  const delegateCollect: ToolDefinition = tool({
    description:
      'Collect results from a fire_forget delegation. ' +
      'Pass the session_id returned by delegate_subagent in fire_forget mode. ' +
      'By default this blocks once until the plugin sees a completion event instead of polling repeatedly. ' +
      'Set wait: false only for an explicit non-blocking probe.',
    args: {
      session_id: tool.schema
        .string()
        .describe('Session ID from delegate_subagent fire_forget'),
      wait: tool.schema
        .boolean()
        .optional()
        .describe(
          'Defaults to true. Set false only to probe without waiting for the internal completion signal.',
        ),
      timeout_ms: tool.schema
        .number()
        .optional()
        .describe(
          'Maximum time to wait when wait: true. Defaults to 15 minutes.',
        ),
    },
    execute: async (args) => {
      const existingArtifact = artifactStore.getSessionInfo(args.session_id);
      if (alreadyCollected.has(args.session_id)) {
        return 'Session was already collected. Result is available in previous turns.';
      }

      const waitForCompletion = args.wait !== false;
      let completedFromEvent = false;
      if (waitForCompletion) {
        completedFromEvent = await waitForFireForgetCompletion(
          args.session_id,
          Math.max(
            1,
            Math.trunc(args.timeout_ms ?? FIRE_FORGET_COMPLETION_TIMEOUT_MS),
          ),
        );
        if (!completedFromEvent) {
          return 'Session is still running. Waiting timed out before a completion event arrived.';
        }
      } else {
        const lastAttempt = lastCollectAttempt.get(args.session_id) ?? 0;
        const elapsed = Date.now() - lastAttempt;
        if (elapsed < COLLECT_COOLDOWN_MS) {
          return 'Session status checked recently. Wait before polling again.';
        }
        lastCollectAttempt.set(args.session_id, Date.now());
      }

      try {
        const sid = args.session_id;
        let status: string | undefined;
        if (!completedFromEvent) {
          const statusResult = await (
            ctx.client.session.status as (
              args: Record<string, unknown>,
            ) => Promise<{ data?: Record<string, unknown> }>
          )({ path: { id: sid }, query: { directory } });

          status = (statusResult.data as Record<string, unknown>)?.type as
            | string
            | undefined;
        }

        if (completedFromEvent || isTerminalSessionStatus(status)) {
          const extraction = await extractAssistantTextAfterCompletionSignal(
            ctx.client,
            args.session_id,
            directory,
          );

          if (extraction.empty) {
            return 'Session completed but produced no output.';
          }
          const artifactStatus = determineArtifactStatus(
            extraction.text,
            'fire_forget',
          );
          const agentName = existingArtifact?.agent ?? 'fixer';
          const inlineSections = collectInlineSections(
            agentName,
            extraction.text,
          );
          const artifactResult =
            artifactStore.appendTurn({
              childSessionId: args.session_id,
              outputText: extraction.text,
              inlineSections,
              status: artifactStatus,
            }) ?? artifactStore.markStatus(args.session_id, artifactStatus);

          if (!artifactResult) {
            return extraction.text;
          }

          if (artifactStatus !== 'needs_user') {
            alreadyCollected.add(args.session_id);
            recordSessionDone(args.session_id);
            clearFireForgetCompletionTracker(args.session_id);
            ctx.client.session
              .abort({ path: { id: args.session_id } })
              .catch(() => {});

            if (depthTracker) {
              depthTracker.cleanup(args.session_id);
            }
          }

          return buildCompactEnvelope({
            agentName,
            childSessionId: args.session_id,
            artifactPath: artifactResult.artifactPath,
            indexPath: artifactResult.indexPath,
            variant: existingArtifact?.variant,
            summaryLine: buildSummaryLine(
              agentName,
              artifactStatus,
              extraction.text,
            ),
            inlineSections,
            continueSessionId:
              artifactStatus === 'needs_user' ? args.session_id : undefined,
          });
        }

        return (
          'Session is still running (status: ' +
          (status ?? 'unknown') +
          '). Move on to other work and check back later - do not retry immediately.'
        );
      } catch (err) {
        return `Error collecting result: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  return {
    delegate_subagent: delegateSubagent,
    delegate_subagents: delegateSubagents,
    delegate_collect: delegateCollect,
  };
}
