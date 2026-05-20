import type { ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { normalizeSkillConfig } from '../cli/skills';
import type { PluginConfig } from '../config';
import { ALL_AGENT_NAMES } from '../config/constants';
import { getAgentOverride } from '../config/utils';
import {
  recordDelegatedSubagentSession,
  recordSessionDone,
} from '../tui-state';
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
 * Mutex for serializing blocking delegate_subagent calls.
 * OpenCode runs multiple tool calls from the same LLM turn in parallel.
 * This ensures steward->oracle->fixer ordering at the runtime level.
 * Fire-forget calls bypass the mutex and run in parallel as intended.
 */
class BlockingMutex {
  private current: Promise<void> | null = null;
  private resolveCurrent: (() => void) | null = null;

  async acquire(): Promise<void> {
    while (this.current) {
      await this.current;
    }
    this.current = new Promise<void>((resolve) => {
      this.resolveCurrent = resolve;
    });
  }

  release(): void {
    const resolve = this.resolveCurrent;
    this.current = null;
    this.resolveCurrent = null;
    resolve?.();
  }
}

const blockingMutex = new BlockingMutex();

/**
 * When true, blocking `delegate_subagent` keeps the child session open and
 * appends `<delegate_session_continue .../>` for `continue_session_id` flows.
 */
export function subagentOutputRequestsUserHandoff(text: string): boolean {
  return text.includes('<needs_user>');
}

type OpencodeClient = import('@opencode-ai/plugin').PluginInput['client'];

const VARIANT_OPTIONS = ['low', 'medium', 'high', 'max'] as const;
const MODE_OPTIONS = ['blocking', 'fire_forget'] as const;

export function createDelegateTools(
  ctx: { client: OpencodeClient; directory: string },
  config: PluginConfig | undefined,
  depthTracker: SubagentDepthTracker | undefined,
): Record<string, ToolDefinition> {
  const directory = ctx.directory;

  const subagentOptions: readonly string[] = [
    ...ALL_AGENT_NAMES.filter((name) => name !== 'orchestrator'),
  ];

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

  function buildAgentToolsHint(agentName: string, _taskPrompt: string): string {
    const override = getAgentOverride(config, agentName);
    if (!override?.skills && !override?.mcps) return '';

    const lines: string[] = [];

    // Skills hint
    if (override.skills) {
      const normalized = normalizeSkillConfig(override.skills);
      if (normalized.alwaysLoad.length > 0) {
        lines.push(
          `When relevant to the task, please use these skills first: ${normalized.alwaysLoad.join(', ')}.`,
        );
      }
    }

    // MCPs hint
    if (override.mcps) {
      const normalized = normalizeSkillConfig(override.mcps);
      if (normalized.alwaysLoad.length > 0) {
        lines.push(
          `When relevant to the task, please use these MCP tools first: ${normalized.alwaysLoad.join(', ')}.`,
        );
      }
    }

    if (lines.length === 0) return '';

    return `<skill_requirements>\n${lines.join('\n')}\n</skill_requirements>\n\n`;
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
  }): Promise<{ text: string; openSessionId?: string }> {
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

      const hint = buildAgentToolsHint(options.agent, options.promptText);
      const effectivePrompt = hint
        ? `${hint}${options.promptText}`
        : options.promptText;

      const parts: PromptBodyPart[] = options.promptParts?.length
        ? [...options.promptParts, { type: 'text', text: effectivePrompt }]
        : [{ type: 'text', text: effectivePrompt }];

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
        return { text, openSessionId: sessionId };
      }

      recordSessionDone(sessionId);
      return { text };
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
    execute: async (args, context) => {
      const parentSessionId = context.sessionID;
      const agentName = args.agent;
      const variant = args.variant;
      const mode = args.mode ?? 'blocking';
      const continueSessionId = args.continue_session_id?.trim() || undefined;

      if (continueSessionId && mode === 'fire_forget') {
        return 'Error: continue_session_id is only valid for blocking delegate_subagent (omit mode or mode: blocking).';
      }

      // Enforce steward blocking invariant
      if (agentName === 'steward' && mode === 'fire_forget') {
        return 'Error: @steward must always run in blocking mode. Its repo rule citations are required input for all downstream agents (@oracle, @fixer, @designer). Use mode: "blocking" (or omit mode).';
      }

      const agentOverride = getAgentOverride(config, agentName);
      const effectiveVariant = agentOverride?.variant ?? variant;

      let model = args.model;
      if (!model && config?.agents?.[agentName]?.model) {
        const rawModel = config.agents[agentName].model;
        model = typeof rawModel === 'string' ? rawModel : undefined;
      }

      if (!model) {
        return `Error: No model configured for agent "${agentName}"`;
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

          // Record in session tree directly
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

          const hint = buildAgentToolsHint(agentName, args.prompt);
          const effectiveFirePrompt = hint
            ? `${hint}${args.prompt}`
            : args.prompt;

          const promptBody: PromptBody = {
            agent: agentName,
            model: modelRef,
            tools: { task: false },
            parts: partsForPrompt(effectiveFirePrompt),
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

          return `Launched ${agentName} (variant: ${effectiveVariant ?? 'default'}, mode: fire_forget).\nSession ID: ${sessionId}\nCollect with delegate_collect(session_id: "${sessionId}")`;
        } catch (err) {
          return `Error launching ${agentName}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // Blocking mode - acquire serialization lock
      await blockingMutex.acquire();
      try {
        const runResult = await runAgentSession({
          parentSessionId,
          title: `${agentName} (${effectiveVariant ?? 'default'})`,
          agent: agentName,
          model,
          variant: effectiveVariant,
          promptText: args.prompt,
          timeout: 0, // no timeout - let subagents run freely
          promptParts: frameImageParts.length > 0 ? frameImageParts : undefined,
          continueSessionId,
        });

        let output = `**${agentName}** (variant: ${effectiveVariant ?? 'default'}):\n\n`;
        output += runResult.text;
        if (runResult.openSessionId) {
          output += `\n\n<delegate_session_continue session_id="${runResult.openSessionId}" agent="${agentName}" />`;
        }
        return output;
      } catch (err) {
        return `Error running ${agentName} (variant: ${effectiveVariant ?? 'default'}): ${
          err instanceof Error ? err.message : String(err)
        }`;
      } finally {
        blockingMutex.release();
      }
    },
  });

  const delegateCollect: ToolDefinition = tool({
    description:
      'Collect results from a fire_forget delegation. ' +
      'Pass the session_id returned by delegate_subagent in fire_forget mode.',
    args: {
      session_id: tool.schema
        .string()
        .describe('Session ID from delegate_subagent fire_forget'),
    },
    execute: async (args) => {
      try {
        const sid = args.session_id;
        const statusResult = await (
          ctx.client.session.status as (
            args: Record<string, unknown>,
          ) => Promise<{ data?: Record<string, unknown> }>
        )({ path: { id: sid }, query: { directory } });

        const status = (statusResult.data as Record<string, unknown>)?.type as
          | string
          | undefined;

        if (status === 'idle' || status === 'completed' || status === 'error') {
          recordSessionDone(args.session_id);

          const extraction = await extractSessionResult(
            ctx.client,
            args.session_id,
            { includeReasoning: false, directory },
          );

          ctx.client.session
            .abort({ path: { id: args.session_id } })
            .catch(() => {});

          if (depthTracker) {
            depthTracker.cleanup(args.session_id);
          }

          if (extraction.empty) {
            return 'Session completed but produced no output.';
          }

          return extraction.text;
        }

        return `Session still running (status: ${status ?? 'unknown'}). Try again shortly. Use original delegate_subagent session_id.`;
      } catch (err) {
        return `Error collecting result: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  return {
    delegate_subagent: delegateSubagent,
    delegate_collect: delegateCollect,
  };
}
