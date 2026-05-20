/**
 * Injects a /compact heads-up into the orchestrator's latest user turn when
 * sidebar-style context telemetry shows the session is near the model window.
 */
import {
  deriveSessionContextPct,
  mergedSessionUsage,
  readTuiSnapshot,
  type TuiSnapshot,
} from '../../tui-state';
import { SLIM_INTERNAL_INITIATOR_MARKER } from '../../utils';

/** Marker in the injected block; keep in sync with orchestrator prompt guidance. */
export const CONTEXT_PRESSURE_HEADING = '### Context budget (plugin telemetry)';

interface MessageInfo {
  role: string;
  agent?: string;
  sessionID?: string;
}

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

export interface ContextPressureReminderOptions {
  enabled: boolean;
  warnThresholdPct: number;
}

function buildReminderText(
  roundedPct: number,
  contextUsed: number,
  contextLimit: number,
): string {
  return [
    CONTEXT_PRESSURE_HEADING,
    '',
    `Telemetry for this orchestrator session is about **${roundedPct}%** full ` +
      `(${contextUsed.toLocaleString('en-US')} / ${contextLimit.toLocaleString('en-US')} tokens in the model context window). ` +
      'Further turns may fail with no context left.',
    '',
    'Before starting heavy new delegation or large tool payloads:',
    '1. Ask the user to run **`/compact`** (or continue the next phase in a **new session**).',
    '2. If a blocking delegation is mid-flight, finish the smallest safe step first, then compact.',
    '',
    'Do not assume unlimited context remains.',
  ].join('\n');
}

/** @internal Exported for tests */
export function applyContextPressureReminder(
  messages: MessageWithParts[],
  snapshot: TuiSnapshot,
  options: ContextPressureReminderOptions,
): void {
  if (!options.enabled || messages.length === 0) {
    return;
  }

  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === 'user') {
      lastUserMessageIndex = i;
      break;
    }
  }

  if (lastUserMessageIndex === -1) {
    return;
  }

  const lastUserMessage = messages[lastUserMessageIndex];
  const agent = lastUserMessage.info.agent;
  if (agent && agent !== 'orchestrator') {
    return;
  }

  const sessionID = lastUserMessage.info.sessionID;
  if (!sessionID) {
    return;
  }

  const textPartIndex = lastUserMessage.parts.findIndex(
    (p) => p.type === 'text' && p.text !== undefined,
  );

  if (textPartIndex === -1) {
    return;
  }

  const originalText = lastUserMessage.parts[textPartIndex].text ?? '';
  if (originalText.includes(SLIM_INTERNAL_INITIATOR_MARKER)) {
    return;
  }
  if (originalText.includes(CONTEXT_PRESSURE_HEADING)) {
    return;
  }

  const usageBySession = mergedSessionUsage(snapshot);
  const usage = usageBySession[sessionID];
  const limit = usage?.contextLimit ?? 0;
  if (!(limit > 0)) {
    return;
  }

  const used = usage?.contextUsed ?? 0;
  const roundedPct = Math.round(deriveSessionContextPct(used, limit));

  if (roundedPct < options.warnThresholdPct) {
    return;
  }

  const block = buildReminderText(roundedPct, used, limit);
  lastUserMessage.parts[textPartIndex].text =
    `${originalText}\n\n---\n\n${block}`;
}

export function createContextPressureReminderHook(
  options: ContextPressureReminderOptions,
) {
  return {
    'experimental.chat.messages.transform': async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      applyContextPressureReminder(output.messages, readTuiSnapshot(), options);
    },
  };
}
